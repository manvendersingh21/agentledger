# Deploying AgentLedger (hosted Supabase + Vercel)

This guide covers a **test-mode** deployment: Stripe test keys only, demo catalog seeds, and the MCP edge function for agent clients.

## Prerequisites

- A [Supabase](https://supabase.com) project (note the **project ref** and database password).
- A [Supabase access token](https://supabase.com/dashboard/account/tokens) for the CLI (`SUPABASE_ACCESS_TOKEN`).
- A [Vercel](https://vercel.com) project connected to this repository.
- Stripe **test** credentials and a Jev API key for guardrail signals.

Validate local env before deploying:

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$HOME/.local/bin:$PATH
cp .env.example .env.local   # fill in values
pnpm exec tsx scripts/check-env.ts
```

## 1. Backend: Supabase

### One-shot deploy script

From the repo root, with secrets in the environment (never commit them):

```bash
export SUPABASE_PROJECT_REF=your_project_ref
export SUPABASE_DB_PASSWORD=your_db_password
export SUPABASE_ACCESS_TOKEN=your_access_token
export STRIPE_SECRET_KEY=sk_test_...
export JEV_API_KEY=...
export PAYMENT_PROVIDER=stripe

chmod +x scripts/deploy-hosted.sh
./scripts/deploy-hosted.sh
```

Preview commands without running them:

```bash
./scripts/deploy-hosted.sh --dry-run
```

The script:

1. Links the CLI to the hosted project.
2. Runs `supabase db push` (migrations).
3. Applies `supabase/seed.sql` and `supabase/seed-fixtures.sql` via `supabase db query --linked -f` (or `db execute` on older CLIs).
4. Sets edge secrets: `STRIPE_SECRET_KEY`, `JEV_API_KEY`, `PAYMENT_PROVIDER`.
5. Deploys edge functions `mcp` and `stripe-webhook` with `--no-verify-jwt` (the MCP function still validates the user JWT in code).

**MCP URL after deploy:**

```text
https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/mcp
```

If seed application fails (CLI too old), run the two SQL files manually in **SQL Editor** in the Supabase dashboard.

### Auth URL configuration (required)

In **Authentication → URL configuration**:

| Setting | Value |
|--------|--------|
| **Site URL** | Your production app URL, e.g. `https://your-app.vercel.app` |
| **Redirect URLs** | Same origin paths used by the app, including `/oauth/consent` |

For local dev alongside hosted auth, add `http://127.0.0.1:3000` and `http://localhost:3000` redirect URLs.

### OAuth server (required for MCP clients)

In **Authentication → OAuth Server** (or equivalent in your dashboard version):

- Enable the **OAuth 2.1 / OAuth server** for the project.
- Enable **dynamic client registration** so Claude Code / Cursor can register as MCP OAuth clients.

The Next.js app serves protected-resource metadata at `/.well-known/oauth-protected-resource` using `NEXT_PUBLIC_APP_URL`.

### Edge function secrets

Hosted MCP reads:

| Secret | Purpose |
|--------|---------|
| `STRIPE_SECRET_KEY` | Test-mode PaymentIntents (`sk_test_` / `rk_test_` only) |
| `JEV_API_KEY` | Guardrail risk signals |
| `PAYMENT_PROVIDER` | `stripe` (default) or `demo` |

Set manually if needed:

```bash
pnpm exec supabase secrets set STRIPE_SECRET_KEY=sk_test_... JEV_API_KEY=... PAYMENT_PROVIDER=stripe
```

## 2. Frontend: Vercel

Add these **environment variables** in the Vercel project (Production and Preview as appropriate):

| Variable | Notes |
|----------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project_ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Anon/publishable key from Supabase **API** settings |
| `SUPABASE_SECRET_KEY` | Service-role secret; **server only** |
| `NEXT_PUBLIC_APP_URL` | Canonical app URL, e.g. `https://your-app.vercel.app` |
| `STRIPE_SECRET_KEY` | Same test secret as edge (`sk_test_` / `rk_test_`) |
| `JEV_API_KEY` | Same as edge |
| `PAYMENT_PROVIDER` | `stripe` |
| `OPENAI_API_KEY` | Optional; enables playground agent |
| `NEXT_PUBLIC_DEMO_MODE` | `true` only if you want demo reset in that environment |

Redeploy after changing env vars. Run `pnpm exec tsx scripts/check-env.ts` locally with the same values in `.env.local` to catch missing keys before pushing.

## 3. Stripe webhooks (test mode)

In the [Stripe Dashboard](https://dashboard.stripe.com/test/webhooks) (test mode):

1. **Add endpoint**
2. URL: `https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/stripe-webhook`
3. Select events your `stripe-webhook` function handles (payment intents, etc., per function implementation).
4. Copy the **signing secret** into Vercel as `STRIPE_WEBHOOK_SECRET` if the app verifies webhooks server-side.

Use test cards only; live keys are refused by `StripePaymentProvider`.

## 4. Connect MCP clients

### Claude Code

```bash
claude mcp add --transport http agentledger \
  "https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/mcp"
```

Complete the Supabase OAuth flow when prompted. The signed-in user is the **principal** for delegations and purchases.

### Cursor

1. Open MCP settings and add an **HTTP** MCP server with the same URL.
2. Use OAuth against your Supabase project (site URL and redirects must match § Auth URL configuration).

Tools: `list_delegations`, `search_products`, `propose_purchase`, `get_action_status`, `get_receipt`.

### Smoke test

Locally against the Next route:

```bash
pnpm exec tsx scripts/mcp-smoke.ts
```

Against hosted MCP, point `NEXT_PUBLIC_APP_URL` / OAuth at production and run the same flow with the hosted MCP URL after OAuth is configured.

## 5. Security notes

- Never commit `.env.local` or paste service-role keys into client-side code.
- `--no-verify-jwt` on edge functions disables the **gateway** JWT check; MCP still validates tokens in application code.
- Hosted seeds include a **local-only** demo user in `seed.sql`; do not rely on that account in production without understanding the seed contents.
- Keep `NEXT_PUBLIC_DEMO_MODE` off in production unless you intend to expose demo reset.

## Troubleshooting

| Issue | Check |
|-------|--------|
| OAuth redirect error | Site URL and redirect URLs in Supabase Auth |
| MCP 401 | User token, OAuth server enabled, correct MCP URL |
| Payments fail | `STRIPE_SECRET_KEY` is test mode; edge secrets set |
| Guardrails always require approval | `JEV_API_KEY` on edge and Vercel |
| `check-env` fails | Missing `NEXT_PUBLIC_APP_URL` or invalid Stripe key prefix |

CLI reference: `pnpm exec supabase --help`, `pnpm exec supabase db query --help`.

## Vercel (CLI link + env sync)

### Link the repository

1. Install the [Vercel CLI](https://vercel.com/docs/cli) and sign in (`npx vercel login`).
2. From the repo root, link to an existing Vercel project (creates `.vercel/`):

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$HOME/.local/bin:$PATH
npx vercel link
```

3. Connect the Git repository in the Vercel dashboard if it is not already connected. The repo ships `vercel.json` with `pnpm install` / `pnpm build` so Vercel uses pnpm without extra dashboard settings.

### Hosted Supabase keys in `.env.local`

Keep **local** Supabase values in `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_SECRET_KEY` for `pnpm dev`. For deployment, store the **hosted** project credentials under separate names (not committed):

| `.env.local` key (source) | Vercel Production name |
|---------------------------|-------------------------|
| `SUPABASE_HOSTED_URL` | `NEXT_PUBLIC_SUPABASE_URL` |
| `SUPABASE_HOSTED_PUBLISHABLE_KEY` | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| `SUPABASE_HOSTED_API_KEY` | `SUPABASE_SECRET_KEY` |

### Push Production env vars

`scripts/vercel-env.sh` reads `.env.local` and runs `npx vercel env add … production` for each name. Values are passed on stdin and are **never** printed.

```bash
chmod +x scripts/vercel-env.sh
./scripts/vercel-env.sh https://your-app.vercel.app
```

Preview names only:

```bash
./scripts/vercel-env.sh --dry-run https://your-app.vercel.app
```

The script sets `NEXT_PUBLIC_APP_URL` from the URL argument and copies `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`, `JEV_API_KEY`, `AGENT_MODEL`, `PAYMENT_PROVIDER`, and `NEXT_PUBLIC_DEMO_MODE` when those keys exist in `.env.local`. Redeploy Production after syncing env vars.

### Production build check

Before pushing:

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$HOME/.local/bin:$PATH
pnpm build
pnpm lint
pnpm typecheck
```

`next.config.ts` keeps TypeScript errors enabled during `next build` (`ignoreBuildErrors: false`).
