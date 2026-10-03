import Link from "next/link";
import { ensureSetup, getAuditEvents, getAuditVerification } from "@/lib/data/queries";
import { RealtimeRefresh } from "@/components/dashboard/realtime-refresh";
import { IntegrityPanel } from "@/components/audit/integrity-badge";
import { Badge } from "@/components/ui/badge";
import { Eyebrow } from "@/components/brand/eyebrow";
import { LocalTime } from "@/components/local-time";

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
    <div className="space-y-10">
      <RealtimeRefresh userId={principal.id} tables={["audit_events"]} />

      <header className="space-y-4">
        <Eyebrow>Audit</Eyebrow>
        <h1 className="font-display text-[44px] font-semibold leading-[0.95] tracking-[-0.045em] text-ink md:text-[56px]">
          Tamper-evident <span className="text-accent">audit chain</span>
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-ink-2">
          Hash-linked events for your principal. Each row includes the previous event hash for
          tamper detection.
        </p>
      </header>

      <IntegrityPanel initial={verification} />

      <div className="overflow-hidden rounded-[6px] border border-line bg-surface">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-6 py-5">
          <h2 className="font-display text-xl font-semibold tracking-[-0.03em] text-ink">Events</h2>
          <p className="font-mono text-xs text-ink-3">Newest first · {events.length} loaded</p>
        </div>
        {events.length === 0 ? (
          <p className="px-6 py-16 text-center text-[15px] text-ink-2">
            No audit events yet.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {events.map((event) => (
              <li
                key={event.id}
                className="flex flex-col gap-2 px-6 py-4 transition-colors hover:bg-canvas/50 sm:flex-row sm:items-start sm:gap-6"
              >
                  <LocalTime iso={event.created_at} className="w-20 shrink-0 pt-0.5 font-mono text-xs tabular-nums text-ink-3" />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={eventVariant(event.event_type)} className="shrink-0">
                      {event.event_type.replaceAll("_", " ")}
                    </Badge>
                    <span className="text-sm text-ink">
                      {summarizeEventData(event.event_data)}
                    </span>
                  </div>
                  {event.intent_id ? (
                    <Link
                      href={`/dashboard/transactions/${event.intent_id}`}
                      className="inline-block font-mono text-xs text-accent hover:text-accent-hover hover:underline"
                    >
                      intent {event.intent_id.slice(0, 8)}…
                    </Link>
                  ) : null}
                </div>
                <p
                  className="shrink-0 rounded-[4px] bg-canvas px-2 py-1 font-mono text-[11px] tabular-nums text-ink-2 sm:text-right"
                  title={`prev ${event.previous_hash} → ${event.event_hash}`}
                >
                  <span className="text-ink-3">{abbreviateHash(event.previous_hash)}</span>
                  <span className="px-1 text-accent">→</span>
                  <span className="text-ink">{abbreviateHash(event.event_hash)}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
