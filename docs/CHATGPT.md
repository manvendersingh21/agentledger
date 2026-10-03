# ChatGPT integration

AgentLedger supports two ChatGPT integration paths:

1. **ChatGPT app / custom MCP connector** — recommended. It exposes all AgentLedger MCP tools and renders a compact purchase decision card.
2. **Custom GPT Actions** — fallback for GPTs that use OpenAPI Actions. It exposes product search, purchase proposals, and action status.

Both paths authenticate the human with Supabase OAuth. A model never supplies principal identity, authoritative prices, or policy decisions.

## ChatGPT app / custom connector

Connector URL:

```text
https://lxxzfaitasfjsqcrhven.supabase.co/functions/v1/mcp
```

Setup:

1. In ChatGPT settings, enable **Developer mode**.
2. Open **Apps / Connectors** and choose the option to add a custom connector.
3. Paste the hosted connector URL above.
4. Complete the Supabase OAuth sign-in and AgentLedger consent flow.
5. Start a new chat, enable AgentLedger, and ask it to search for a product or propose a purchase.

Developer mode and custom MCP connectors require an eligible ChatGPT plan and may be controlled by a workspace administrator. If the add-connector option is absent, check the account plan and workspace settings.

The connector advertises read-only annotations for discovery/status tools and an AgentLedger decision widget for `propose_purchase` and `propose_external_purchase`. Purchase results are shown as:

- **ALLOWED** — policy passed and execution completed.
- **WAITING FOR YOU** — policy passed but human approval is required. Review at <https://agentledger-cyan.vercel.app/dashboard/approvals>.
- **BLOCKED** — policy denied or the request could not be evaluated safely.

## Custom GPT Actions fallback

OpenAPI schema:

```text
https://agentledger-cyan.vercel.app/api/gpt/openapi.json
```

The schema exposes:

- `searchProducts` → `POST /api/gpt/searchProducts`
- `proposePurchase` → `POST /api/gpt/proposePurchase`
- `getActionStatus` → `POST /api/gpt/getActionStatus`

Setup:

1. Create or edit a GPT, then open **Configure → Actions → Create new action**.
2. Import the OpenAPI schema URL above.
3. In Supabase Authentication, create/register an OAuth client for the GPT and retain its client ID and secret.
4. Configure the Action authentication as OAuth with:

   ```text
   Authorization URL: https://lxxzfaitasfjsqcrhven.supabase.co/auth/v1/oauth/authorize
   Token URL:         https://lxxzfaitasfjsqcrhven.supabase.co/auth/v1/oauth/token
   ```

5. Copy the callback URL shown by the GPT editor into the allowed redirect URLs for that Supabase OAuth client.
6. Save the Action and test `searchProducts` before testing `proposePurchase`.

The Actions API requires a Supabase access token in `Authorization: Bearer <token>`. It derives the user from that token, provisions the same AgentLedger principal/agent context as MCP, and calls the shared functions in `lib/domain/pipeline.ts`.

## Safety guarantees

- `proposePurchase` always runs the deterministic delegation, guardrail, approval, execution, receipt, and audit pipeline.
- Product price, merchant, currency, and recurring terms are loaded from AgentLedger's database.
- Merchant descriptions remain untrusted data and cannot alter policy.
- Invalid or unavailable policy inputs fail closed.
- External website proposals remain MCP-only and always require human approval when policy otherwise passes.

## Deployment

After changing the shared MCP registry or widget:

1. Redeploy the Supabase `mcp` edge function.
2. Deploy the Next.js app so the GPT Actions and OpenAPI routes are live.
3. In ChatGPT, refresh/recreate the connector so it fetches the latest tool and resource metadata.
4. Verify OAuth sign-in, `tools/list`, `resources/list`, purchase card rendering, Action schema import, and an approval-required proposal.
