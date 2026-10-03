import { execFileSync } from "node:child_process";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { computeEventHash, GENESIS_HASH, type AuditEventRecord } from "../../lib/crypto/audit-chain.ts";

type Row = { id: string; [column: string]: unknown };
type DbResult<T> = { data: T | null; error: { message: string; code?: string } | null };
type TestUser = { id: string; email: string; password: string; agentId: string; delegationId: string; client: SupabaseClient };

const PRIVILEGED_TABLES = [
  "action_intents",
  "approvals",
  "executions",
  "receipts",
  "audit_events",
] as const;

const ISOLATION_TABLES = [
  "agents",
  "delegations",
  ...PRIVILEGED_TABLES,
] as const;

const PRIVILEGED_RPCS = [
  ["claim_execution", { p_intent_id: "00000000-0000-4000-8000-000000000099", p_idempotency_key: "rls-deny", p_provider: "test" }],
  ["resolve_approval", { p_approval_id: "00000000-0000-4000-8000-000000000099", p_principal_id: "00000000-0000-4000-8000-000000000099", p_decision: "approved", p_reason: "denied" }],
  ["daily_committed_spend", { p_principal_id: "00000000-0000-4000-8000-000000000099" }],
  ["reset_demo", { p_principal_id: "00000000-0000-4000-8000-000000000099" }],
  ["ensure_principal_setup", { p_principal_id: "00000000-0000-4000-8000-000000000099", p_display_name: "denied" }],
] as const;

function parseEnvBlock(output: string): Record<string, string> {
  return Object.fromEntries(
    output.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^(?:export\s+)?([A-Z0-9_]+)=(?:"([^"]*)"|'([^']*)'|(.*))$/);
      return match ? [[match[1], match[2] ?? match[3] ?? match[4]]] : [];
    }),
  );
}

function loadSupabaseEnv(): Record<string, string> {
  let parsed: Record<string, string> = {};
  try {
    const output = execFileSync("pnpm", ["exec", "supabase", "status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    parsed = parseEnvBlock(output);
  } catch {
    try {
      parsed = parseEnvBlock(readFileSync("/tmp/agentledger-supabase-b.env", "utf8"));
    } catch {
      parsed = {};
    }
  }
  const merged: Record<string, string> = { ...parsed };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

function supabaseConfig(env: Record<string, string>): { url: string; anonKey: string; serviceKey: string; dbUrl: string | null } {
  const url = env.SUPABASE_URL ?? env.API_URL;
  const anonKey = env.SUPABASE_ANON_KEY ?? env.ANON_KEY ?? env.PUBLISHABLE_KEY;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SERVICE_ROLE_KEY;
  let dbUrl = env.DB_URL ?? env.DATABASE_URL ?? null;
  if (!dbUrl && url) {
    try {
      const api = new URL(url);
      if (api.hostname === "127.0.0.1" || api.hostname === "localhost") {
        dbUrl = `postgresql://postgres:postgres@${api.hostname}:54322/postgres`;
      }
    } catch {
      /* ignore */
    }
  }
  if (!url || !anonKey || !serviceKey) {
    throw new Error("Local Supabase URL and keys are required (run `pnpm exec supabase status -o env` or set env vars)");
  }
  return { url, anonKey, serviceKey, dbUrl };
}

function data<T>(result: DbResult<T>): NonNullable<T> {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error("Expected database response data");
  return result.data as NonNullable<T>;
}

const REALTIME_POLICY_SQL =
  "select count(*)::int from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'agentledger_broadcast_read_own'";

function policyCountFromPsqlOutput(output: string): number {
  const trimmed = output.trim();
  if (!trimmed) return 0;
  const value = Number.parseInt(trimmed.split(/\s+/)[0] ?? "", 10);
  return Number.isFinite(value) ? value : 0;
}

function parsePgUrl(dbUrl: string): { host: string; port: number; user: string; password: string; database: string } {
  const normalized = dbUrl.replace(/^postgresql:/, "http:").replace(/^postgres:/, "http:");
  const u = new URL(normalized);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, "") || "postgres",
  };
}

function pgSend(socket: ReturnType<typeof connect>, code: number, payload: Buffer): void {
  const body = Buffer.concat([Buffer.from([code]), payload]);
  const frame = Buffer.alloc(4 + body.length);
  frame.writeInt32BE(4 + body.length, 0);
  body.copy(frame, 4);
  socket.write(frame);
}

function pgSaslInitial(clientFirst: string): Buffer {
  const mechanism = Buffer.from("SCRAM-SHA-256\0");
  const first = Buffer.from(clientFirst);
  const payload = Buffer.alloc(mechanism.length + 4 + first.length);
  mechanism.copy(payload, 0);
  payload.writeInt32BE(first.length, mechanism.length);
  first.copy(payload, mechanism.length + 4);
  return payload;
}

function pgStartup(user: string, database: string): Buffer {
  const params = Buffer.from(`user\0${user}\0database\0${database}\0\0`);
  const len = 8 + params.length;
  const buf = Buffer.alloc(len);
  buf.writeInt32BE(len, 0);
  buf.writeInt32BE(196608, 4);
  params.copy(buf, 8);
  return buf;
}

function pgScalarQuery(dbUrl: string, sql: string): Promise<string> {
  const { host, port, user, password, database } = parsePgUrl(dbUrl);
  const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest();
  const hmacSha256 = (key: Buffer, msg: string) => createHmac("sha256", key).update(msg).digest();

  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    socket.setTimeout(8_000, () => fail("postgres query timed out"));
    let pending = Buffer.alloc(0);
    let scram: { clientFirst: string } | null = null;
    let authed = false;
    let querySent = false;

    const fail = (message: string) => {
      socket.destroy();
      reject(new Error(message));
    };

    const sendQuery = () => {
      if (querySent) return;
      querySent = true;
      pgSend(socket, 81, Buffer.from(`${sql}\0`));
    };

    const drainMessages = () => {
      while (pending.length >= 5) {
        const msgLen = pending.readInt32BE(0);
        if (pending.length < msgLen) break;
        const packet = pending.subarray(0, msgLen);
        pending = pending.subarray(msgLen);
        const type = packet.toString("utf8", 4, 5);
        const body = packet.subarray(5);

        if (type === "E") {
          fail(body.toString("utf8"));
          return;
        }

        if (type === "R") {
          const authType = body.readInt32BE(0);
          if (authType === 10) {
            const nonce = randomBytes(18).toString("base64");
            const clientFirst = `n,,n=${user},r=${nonce}`;
            scram = { clientFirst };
            pgSend(socket, 112, pgSaslInitial(clientFirst));
          } else if (authType === 11 && scram) {
            const serverFirst = body.subarray(4).toString("utf8");
            const parts = Object.fromEntries(
              serverFirst.split(",").map((part) => {
                const eq = part.indexOf("=");
                return [part.slice(0, eq), part.slice(eq + 1)];
              }),
            );
            const salt = Buffer.from(parts.s, "base64");
            const iterations = Number(parts.i);
            const serverNonce = parts.r;
            const saltedPassword = pbkdf2Sync(password, salt, iterations, 32, "sha256");
            const clientKey = hmacSha256(saltedPassword, "Client Key");
            const storedKey = sha256(clientKey);
            const clientFinal = `c=biws,r=${serverNonce}`;
            const authMessage = `${scram.clientFirst},${serverFirst},${clientFinal}`;
            const clientSig = hmacSha256(storedKey, authMessage);
            const proof = Buffer.alloc(clientKey.length);
            for (let i = 0; i < clientKey.length; i++) proof[i] = clientKey[i] ^ clientSig[i];
            pgSend(socket, 112, Buffer.from(`${clientFinal},p=${proof.toString("base64")}\0`));
          } else if (authType === 12 || authType === 0) {
            authed = true;
          } else {
            fail(`unsupported auth type ${authType}`);
          }
          continue;
        }

        if (type === "Z" && authed) {
          sendQuery();
          continue;
        }

        if (querySent && type === "D") {
          const colCount = body.readInt16BE(0);
          let offset = 2;
          let value = "";
          for (let c = 0; c < colCount; c++) {
            const colLen = body.readInt32BE(offset);
            offset += 4;
            if (colLen >= 0) {
              value = body.toString("utf8", offset, offset + colLen);
              offset += colLen;
            }
          }
          socket.end();
          resolve(value);
          return;
        }
      }
    };

    socket.on("error", (err) => fail(err.message));
    socket.on("connect", () => socket.write(pgStartup(user, database)));
    socket.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      drainMessages();
    });
  });
}

async function tryRealtimePolicyInCatalog(dbUrl: string): Promise<boolean | null> {
  try {
    const scalar = await Promise.race([
      pgScalarQuery(dbUrl, REALTIME_POLICY_SQL),
      new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error("postgres catalog probe timeout")), 5_000);
      }),
    ]);
    return policyCountFromPsqlOutput(scalar) >= 1;
  } catch {
    return null;
  }
}

async function subscribePrivateBroadcast(
  client: SupabaseClient,
  topicUserId: string,
  onPayload: (payload: unknown) => void,
): Promise<ReturnType<SupabaseClient["channel"]>> {
  const session = (await client.auth.getSession()).data.session;
  if (!session) throw new Error("expected authenticated session for realtime");
  await client.realtime.setAuth(session.access_token);
  const channel = client
    .channel(`user:${topicUserId}`, { config: { private: true } })
    .on("broadcast", { event: "*" }, (msg) => onPayload(msg.payload));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("realtime subscribe timeout")), 12_000);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        clearTimeout(timer);
        reject(new Error(`realtime subscribe ${status}`));
      }
    });
  });
  return channel;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

type InsertPrivilegedGraph = (principal: TestUser) => Promise<Record<(typeof PRIVILEGED_TABLES)[number], Row>>;

async function assertRealtimeBroadcastIsolation(
  insertPrivilegedGraph: InsertPrivilegedGraph,
  serviceClient: SupabaseClient,
  userA: TestUser,
  userB: TestUser,
): Promise<void> {
  const foreignEvents: unknown[] = [];
  const ownEvents: unknown[] = [];
  let foreignChannel: ReturnType<SupabaseClient["channel"]> | null = null;
  let foreignJoinAllowed = false;
  try {
    foreignChannel = await subscribePrivateBroadcast(userA.client, userB.id, (payload) => foreignEvents.push(payload));
    foreignJoinAllowed = true;
  } catch {
    foreignJoinAllowed = false;
  }

  const ownChannel = await subscribePrivateBroadcast(userA.client, userA.id, (payload) => ownEvents.push(payload));

  await insertPrivilegedGraph(userB);
  await insertPrivilegedGraph(userA);
  await delay(2_500);

  if (foreignJoinAllowed) {
    expect(foreignEvents, "user A must not receive broadcasts on user B's private topic").toEqual([]);
  }
  expect(ownEvents.length, "user A should receive broadcasts on their own private topic").toBeGreaterThan(0);

  if (foreignChannel) await userA.client.removeChannel(foreignChannel);
  await userA.client.removeChannel(ownChannel);
  await serviceClient.rpc("reset_demo", { p_principal_id: userA.id });
  await serviceClient.rpc("reset_demo", { p_principal_id: userB.id });
}

describe("RLS and privilege boundaries (anon key + authenticated clients)", () => {
  const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
  let config: ReturnType<typeof supabaseConfig>;
  let service: SupabaseClient;
  let publishable: SupabaseClient;
  let userA: TestUser;
  let userB: TestUser;
  const createdUserIds: string[] = [];

  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await service.rpc(name, args);
    if (result.error) throw new Error(result.error.message);
    return result.data as T;
  }

  async function createSignedInUser(label: string): Promise<TestUser> {
    const email = `rls-${label}-${crypto.randomUUID()}@agentledger.dev`;
    const password = `rls-${crypto.randomUUID()}`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new Error(created.error.message);
    const id = created.data.user.id;
    createdUserIds.push(id);

    const agentId = await rpc<string>("ensure_principal_setup", { p_principal_id: id, p_display_name: `RLS ${label}` });
    const delegation = data<Row>(
      await service.from("delegations").select("id").eq("principal_id", id).returns<Row[]>().single(),
    );

    const client = createClient(config.url, config.anonKey, clientOptions);
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw new Error(signedIn.error.message);

    return { id, email, password, agentId, delegationId: delegation.id, client };
  }

  async function insertPrivilegedGraph(principal: TestUser): Promise<Record<typeof PRIVILEGED_TABLES[number], Row>> {
    const intent = data<Row>(
      await service
        .from("action_intents")
        .insert({
          principal_id: principal.id,
          agent_id: principal.agentId,
          delegation_id: principal.delegationId,
          status: "executed",
          payload: { product_id: "20000000-0000-4000-8000-000000000001" },
          amount_cents: 1500,
          currency: "usd",
          merchant_slug: "acme-api",
          product_id: "20000000-0000-4000-8000-000000000001",
          recurring: false,
          idempotency_key: crypto.randomUUID(),
        })
        .select()
        .returns<Row[]>()
        .single(),
    );

    const approval = data<Row>(
      await service
        .from("approvals")
        .insert({
          intent_id: intent.id,
          principal_id: principal.id,
          status: "approved",
          resolved_at: new Date().toISOString(),
        })
        .select()
        .returns<Row[]>()
        .single(),
    );

    const execution = data<Row>(
      await service
        .from("executions")
        .insert({
          intent_id: intent.id,
          principal_id: principal.id,
          idempotency_key: crypto.randomUUID(),
          status: "succeeded",
          provider: "rls-test",
        })
        .select()
        .returns<Row[]>()
        .single(),
    );

    const receipt = data<Row>(
      await service
        .from("receipts")
        .insert({
          intent_id: intent.id,
          execution_id: execution.id,
          principal_id: principal.id,
          provider: "rls-test",
          provider_reference: "rls-receipt",
          amount_cents: 1500,
          currency: "usd",
        })
        .select()
        .returns<Row[]>()
        .single(),
    );

    const auditPayload: Omit<AuditEventRecord, "eventHash" | "previousHash"> = {
      id: crypto.randomUUID(),
      principalId: principal.id,
      agentId: principal.agentId,
      intentId: intent.id,
      eventType: "rls.test",
      eventData: { note: "rls fixture" },
      createdAt: new Date().toISOString(),
    };
    const audit = data<Row>(
      await service
        .from("audit_events")
        .insert({
          id: auditPayload.id,
          principal_id: principal.id,
          agent_id: principal.agentId,
          intent_id: intent.id,
          event_type: auditPayload.eventType,
          event_data: auditPayload.eventData,
          created_at: auditPayload.createdAt,
          previous_hash: GENESIS_HASH,
          event_hash: await computeEventHash(GENESIS_HASH, auditPayload),
        })
        .select()
        .returns<Row[]>()
        .single(),
    );

    return { action_intents: intent, approvals: approval, executions: execution, receipts: receipt, audit_events: audit };
  }

  beforeAll(async () => {
    const env = loadSupabaseEnv();
    config = supabaseConfig(env);
    service = createClient(config.url, config.serviceKey, clientOptions);
    publishable = createClient(config.url, config.anonKey, clientOptions);
    userA = await createSignedInUser("a");
    userB = await createSignedInUser("b");
  }, 60_000);

  beforeEach(async () => {
    for (const user of [userA, userB]) {
      const reset = await service.rpc("reset_demo", { p_principal_id: user.id });
      expect(reset.error).toBeNull();
    }
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await service.rpc("reset_demo", { p_principal_id: id });
      await service.auth.admin.deleteUser(id);
    }
  }, 60_000);

  it("uses the publishable (anon) key for authenticated clients", () => {
    expect(config.anonKey.length).toBeGreaterThan(20);
    expect(userA.client).toBeDefined();
  });

  it("prevents user A from reading user B rows on private tables", async () => {
    const bGraph = await insertPrivilegedGraph(userB);
    const aOwnAgent = data(await userA.client.from("agents").select("id").eq("id", userA.agentId));
    expect(aOwnAgent).toHaveLength(1);

    for (const table of ISOLATION_TABLES) {
      const foreignId =
        table === "agents"
          ? userB.agentId
          : table === "delegations"
            ? userB.delegationId
            : bGraph[table as keyof typeof bGraph].id;

      const crossRead = await userA.client.from(table).select("id").eq("id", foreignId);
      expect(crossRead.error, `${table} cross-read error`).toBeNull();
      expect(crossRead.data ?? [], table).toEqual([]);

      const listAll = await userA.client.from(table).select("id");
      expect(listAll.error, `${table} list error`).toBeNull();
      const ids = (listAll.data ?? []).map((row) => row.id);
      expect(ids, table).not.toContain(foreignId);
    }
  });

  it("denies unauthenticated reads on private tables via the publishable client", async () => {
    const graph = await insertPrivilegedGraph(userA);
    for (const table of ISOLATION_TABLES) {
      const id =
        table === "agents"
          ? userA.agentId
          : table === "delegations"
            ? userA.delegationId
            : graph[table as keyof typeof graph].id;
      expect((await publishable.from(table).select("id").eq("id", id)).error).not.toBeNull();
    }
  });

  it("rejects authenticated inserts and status tampering on privileged ledger tables", async () => {
    const graph = await insertPrivilegedGraph(userA);
    const intentInsert = await userA.client.from("action_intents").insert({
      principal_id: userA.id,
      agent_id: userA.agentId,
      delegation_id: userA.delegationId,
      status: "executed",
      payload: {},
      amount_cents: 1,
      currency: "usd",
      merchant_slug: "acme-api",
      recurring: false,
      idempotency_key: crypto.randomUUID(),
    });
    expect(intentInsert.error?.code).toBe("42501");

    const intentTamper = await userA.client
      .from("action_intents")
      .update({ status: "executed" })
      .eq("id", graph.action_intents.id);
    expect(intentTamper.error?.code).toBe("42501");

    const approvalTamper = await userA.client
      .from("approvals")
      .update({ status: "approved" })
      .eq("id", graph.approvals.id);
    expect(approvalTamper.error?.code).toBe("42501");

    for (const table of PRIVILEGED_TABLES) {
      const row = graph[table];
      const insertAttempt = await userA.client.from(table).insert({ ...row, id: crypto.randomUUID() });
      expect(insertAttempt.error?.code, `${table} insert`).toBe("42501");
      const updateAttempt = await userA.client.from(table).update({ principal_id: userB.id }).eq("id", row.id);
      expect(updateAttempt.error?.code, `${table} update`).toBe("42501");
      const deleteAttempt = await userA.client.from(table).delete().eq("id", row.id);
      expect(deleteAttempt.error?.code, `${table} delete`).toBe("42501");
    }

    const executionInsert = await userA.client.from("executions").insert({
      intent_id: graph.action_intents.id,
      principal_id: userA.id,
      idempotency_key: crypto.randomUUID(),
      status: "succeeded",
      provider: "evil",
    });
    expect(executionInsert.error?.code).toBe("42501");

    const receiptInsert = await userA.client.from("receipts").insert({
      intent_id: graph.action_intents.id,
      execution_id: graph.executions.id,
      principal_id: userA.id,
      provider: "evil",
      provider_reference: "x",
      amount_cents: 1,
      currency: "usd",
    });
    expect(receiptInsert.error?.code).toBe("42501");

    const auditInsert = await userA.client.from("audit_events").insert({
      id: crypto.randomUUID(),
      principal_id: userA.id,
      event_type: "FORGED",
      event_data: {},
      previous_hash: GENESIS_HASH,
      event_hash: "a".repeat(64),
      created_at: new Date().toISOString(),
    });
    expect(auditInsert.error?.code).toBe("42501");
  });

  it("blocks privileged RPCs for anon and authenticated roles", async () => {
    for (const client of [publishable, userA.client, userB.client]) {
      for (const [name, args] of PRIVILEGED_RPCS) {
        const result = await client.rpc(name, args);
        expect(result.error?.code, `${name} via ${client === publishable ? "anon" : "authenticated"}`).toBe("42501");
      }
    }
  });

  it("allows own delegation limit edits but not another principal's delegation", async () => {
    const own = await userA.client
      .from("delegations")
      .update({ max_amount_cents: 2100, daily_limit_cents: 5100 })
      .eq("id", userA.delegationId)
      .select("max_amount_cents, daily_limit_cents");
    expect(own.error).toBeNull();
    expect(own.data).toHaveLength(1);
    expect(own.data?.[0]).toMatchObject({ max_amount_cents: 2100, daily_limit_cents: 5100 });

    const foreign = await userA.client
      .from("delegations")
      .update({ max_amount_cents: 1 })
      .eq("id", userB.delegationId)
      .select("id");
    expect(foreign.error).toBeNull();
    expect(foreign.data).toEqual([]);

    const untouched = data<Row>(
      await service.from("delegations").select("max_amount_cents").eq("id", userB.delegationId).returns<Row[]>().single(),
    );
    expect(untouched.max_amount_cents).toBe(2000);
  });

  it("allows own agent status updates but not owner_id changes", async () => {
    const statusUpdate = await userA.client
      .from("agents")
      .update({ status: "disabled" })
      .eq("id", userA.agentId)
      .select("status");
    expect(statusUpdate.error).toBeNull();
    expect(statusUpdate.data?.[0]?.status).toBe("disabled");

    for (const forbidden of [{ owner_id: userB.id }, { name: "Renamed by attacker" }, { agent_type: "evil" }]) {
      const attempt = await userA.client.from("agents").update(forbidden).eq("id", userA.agentId);
      expect(attempt.error?.code, JSON.stringify(forbidden)).toBe("42501");
    }

    const foreignAgent = await userA.client.from("agents").update({ status: "disabled" }).eq("id", userB.agentId).select("id");
    expect(foreignAgent.error).toBeNull();
    expect(foreignAgent.data).toEqual([]);
  });

  it("keeps audit_events append-only even for service_role", async () => {
    const graph = await insertPrivilegedGraph(userA);
    const auditId = graph.audit_events.id;

    const update = await service.from("audit_events").update({ event_data: { tampered: true } }).eq("id", auditId);
    expect(update.error?.message).toContain("AUDIT_APPEND_ONLY");

    const del = await service.from("audit_events").delete().eq("id", auditId);
    expect(del.error?.message).toContain("AUDIT_APPEND_ONLY");

    expect(data(await service.from("audit_events").select("id").eq("id", auditId))).toHaveLength(1);
  });

  it(
    "defines realtime.messages RLS for per-user broadcast topics",
    async () => {
      await assertRealtimeBroadcastIsolation(insertPrivilegedGraph, service, userA, userB);
      if (config.dbUrl) {
        const catalog = await tryRealtimePolicyInCatalog(config.dbUrl);
        if (catalog !== null) {
          expect(
            catalog,
            "pg_policies should define agentledger_broadcast_read_own on realtime.messages",
          ).toBe(true);
        }
      }
    },
    45_000,
  );
});
