export const CHATGPT_DECISION_WIDGET_URI = "ui://widget/agentledger-decision.html";
export const CHATGPT_APPROVALS_URL =
  "https://agentledger-cyan.vercel.app/dashboard/approvals";

export type ChatGptDecision = "ALLOWED" | "WAITING FOR YOU" | "BLOCKED";

export interface ChatGptPurchaseStructuredContent {
  status: string;
  amount: string;
  merchant: string;
  decision: ChatGptDecision;
  violations: string[];
  approvalLink: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function purchaseStructuredContent(
  value: unknown,
): ChatGptPurchaseStructuredContent {
  const result = isRecord(value) ? value : {};
  const authoritative = isRecord(result.authoritative)
    ? result.authoritative
    : {};
  const external = isRecord(result.external) ? result.external : {};
  const status = stringValue(result.status) ?? "unknown";

  const amount =
    stringValue(authoritative.amount_display) ??
    (typeof result.amount === "number"
      ? `$${(result.amount / 100).toFixed(2)}`
      : typeof external.claimed_price_cents === "number"
        ? `$${(external.claimed_price_cents / 100).toFixed(2)}`
        : "Unavailable");
  const merchant =
    stringValue(authoritative.merchant_name) ??
    stringValue(authoritative.merchant) ??
    stringValue(external.domain) ??
    "Unknown merchant";
  const violations = [
    ...stringList(result.reasons),
    ...stringList(result.violations),
  ].filter((item, index, items) => items.indexOf(item) === index);

  let decision: ChatGptDecision = "BLOCKED";
  if (status === "awaiting_approval") {
    decision = "WAITING FOR YOU";
  } else if (status === "executed" || status === "duplicate") {
    decision = "ALLOWED";
  }

  return {
    status,
    amount,
    merchant,
    decision,
    violations,
    approvalLink: CHATGPT_APPROVALS_URL,
  };
}

const DECISION_WIDGET_HTML = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; background: transparent; color: #0a0a0a; }
      .card { border: 1px solid #e4e4e4; border-radius: 8px; background: #fff; padding: 16px; }
      .top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .brand { font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      .badge { border-radius: 4px; padding: 5px 8px; font-size: 11px; font-weight: 800; letter-spacing: .06em; }
      .allowed { color: #007a3d; background: #e3f7ec; }
      .waiting { color: #b25e00; background: #fff2de; }
      .blocked { color: #e5002b; background: #ffe9ec; }
      .details { display: grid; grid-template-columns: 1fr auto; gap: 8px 16px; margin-top: 16px; }
      .label { color: #8a8a8a; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
      .value { font-size: 14px; font-weight: 650; text-align: right; }
      ul { margin: 14px 0 0; padding: 12px 12px 12px 28px; border-radius: 4px; background: #f7f7f7; color: #5c5c5c; font-size: 12px; line-height: 1.45; }
      a { display: none; margin-top: 14px; border-radius: 4px; background: #0000ff; color: white; padding: 10px 12px; text-align: center; text-decoration: none; font-size: 12px; font-weight: 700; }
      a.visible { display: block; }
    </style>
  </head>
  <body>
    <main class="card">
      <div class="top">
        <div class="brand">AgentLedger decision</div>
        <div id="decision" class="badge blocked">BLOCKED</div>
      </div>
      <div class="details">
        <div class="label">Merchant</div><div id="merchant" class="value">Unknown merchant</div>
        <div class="label">Amount</div><div id="amount" class="value">Unavailable</div>
      </div>
      <ul id="violations" hidden></ul>
      <a id="approval" href="https://agentledger-cyan.vercel.app/dashboard/approvals" target="_blank" rel="noopener noreferrer">Review in AgentLedger</a>
    </main>
    <script>
      function render(output) {
        var data = output && typeof output === "object" ? output : {};
        var decision = typeof data.decision === "string" ? data.decision : "BLOCKED";
        var badge = document.getElementById("decision");
        badge.textContent = decision;
        badge.className = "badge " + (decision === "ALLOWED" ? "allowed" : decision === "WAITING FOR YOU" ? "waiting" : "blocked");
        document.getElementById("merchant").textContent = typeof data.merchant === "string" ? data.merchant : "Unknown merchant";
        document.getElementById("amount").textContent = typeof data.amount === "string" ? data.amount : "Unavailable";

        var list = document.getElementById("violations");
        list.replaceChildren();
        var violations = Array.isArray(data.violations) ? data.violations : [];
        violations.forEach(function (reason) {
          if (typeof reason !== "string") return;
          var item = document.createElement("li");
          item.textContent = reason;
          list.appendChild(item);
        });
        list.hidden = violations.length === 0;

        var approval = document.getElementById("approval");
        approval.className = decision === "WAITING FOR YOU" ? "visible" : "";
      }

      render(window.openai && window.openai.toolOutput);
      window.addEventListener("openai:set_globals", function () {
        render(window.openai && window.openai.toolOutput);
      });
    </script>
  </body>
</html>`;

export const CHATGPT_DECISION_RESOURCE = {
  uri: CHATGPT_DECISION_WIDGET_URI,
  name: "agentledger-decision",
  title: "AgentLedger purchase decision",
  description:
    "Compact policy decision card for AgentLedger purchase proposals.",
  mimeType: "text/html+skybridge",
  _meta: {
    "openai/widgetDescription":
      "Shows whether AgentLedger allowed, blocked, or needs human approval for a purchase.",
    "openai/widgetPrefersBorder": true,
    "openai/widgetCSP": {
      connect_domains: [],
      resource_domains: [],
    },
  },
} as const;

export function readChatGptDecisionResource() {
  return {
    uri: CHATGPT_DECISION_RESOURCE.uri,
    mimeType: CHATGPT_DECISION_RESOURCE.mimeType,
    text: DECISION_WIDGET_HTML,
    _meta: CHATGPT_DECISION_RESOURCE._meta,
  };
}
