import Link from "next/link";
import { ensureSetup, getAuditEvents, getAuditVerification } from "@/lib/data/queries";
import { RealtimeRefresh } from "@/components/dashboard/realtime-refresh";
import { IntegrityPanel } from "@/components/audit/integrity-badge";
import { Badge } from "@/components/ui/badge";
import { formatTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

function abbreviateHash(hash: string): string {
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 4)}…${hash.slice(-4)}`;
}

function eventVariant(eventType: string): "neutral" | "red" | "amber" | "emerald" | "sky" | "violet" {
  if (
    eventType.includes("DENIED") ||
    eventType.includes("BLOCKED") ||
    eventType === "PAYMENT_FAILED" ||
    eventType === "EVALUATION_FAILED_CLOSED" ||
    eventType === "PARAMETER_TAMPERING_DETECTED"
  ) {
    return "red";
  }
  if (eventType.includes("APPROVAL") && !eventType.includes("AUTO")) return "amber";
  if (eventType === "DUPLICATE_EXECUTION_BLOCKED" || eventType === "REPLAY_ATTEMPT_BLOCKED") {
    return "violet";
  }
  if (
    eventType.includes("EXECUT") ||
    eventType === "PAYMENT_SUCCEEDED" ||
    eventType === "RECEIPT_CREATED"
  ) {
    return "emerald";
  }
  if (eventType.includes("AUTO_APPROVED") || eventType === "HUMAN_APPROVED") return "sky";
  return "neutral";
}

function summarizeEventData(data: Record<string, unknown>): string {
  const product = typeof data.product_name === "string" ? data.product_name : null;
  const merchant = typeof data.merchant_name === "string" ? data.merchant_name : null;
  const amount =
    typeof data.amount_cents === "number" ? `$${(data.amount_cents / 100).toFixed(2)}` : null;
  const query = typeof data.query === "string" ? data.query : null;
  if (product && amount) return `${product} · ${amount}`;
  if (product) return product;
  if (merchant) return merchant;
  if (amount) return amount;
  if (query) return `query: ${query}`;
  const keys = Object.keys(data);
  if (keys.length === 0) return "—";
  if (keys.length <= 2) {
    return keys
      .map((k) => {
        const v = data[k];
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          return `${k}: ${String(v)}`;
        }
        return k;
      })
      .join(" · ");
  }
  return `${keys.length} fields`;
}

export default async function AuditPage() {
  const { principal } = await ensureSetup();
  const [verification, events] = await Promise.all([
    getAuditVerification(),
    getAuditEvents(300),
  ]);

  return (
    <div className="space-y-6">
      <RealtimeRefresh userId={principal.id} tables={["audit_events"]} />

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Audit trail</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Hash-linked events for your principal. Each row includes the previous event hash for
          tamper detection.
        </p>
      </header>

      <IntegrityPanel initial={verification} />

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Events</h2>
          <p className="text-xs text-muted-foreground">Newest first · {events.length} loaded</p>
        </div>
        {events.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No audit events yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((event) => (
              <li
                key={event.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-4"
              >
                <time
                  className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground"
                  dateTime={event.created_at}
                >
                  {formatTime(event.created_at)}
                </time>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={eventVariant(event.event_type)} className="shrink-0">
                      {event.event_type.replaceAll("_", " ")}
                    </Badge>
                    <span className="text-sm text-foreground/90">
                      {summarizeEventData(event.event_data)}
                    </span>
                  </div>
                  {event.intent_id ? (
                    <Link
                      href={`/dashboard/transactions/${event.intent_id}`}
                      className="inline-block font-mono text-xs text-sky-400 hover:underline"
                    >
                      intent {event.intent_id.slice(0, 8)}…
                    </Link>
                  ) : null}
                </div>
                <p
                  className="shrink-0 font-mono text-[10px] text-muted-foreground sm:text-right"
                  title={`prev ${event.previous_hash} → ${event.event_hash}`}
                >
                  {abbreviateHash(event.previous_hash)} → {abbreviateHash(event.event_hash)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
