-- Stripe webhook idempotency log (service-role writes only).
create table public.stripe_events (
  id text primary key,
  type text not null,
  payment_intent_id text,
  received_at timestamptz not null default now(),
  payload jsonb not null
);

create index if not exists stripe_events_payment_intent_id_idx
  on public.stripe_events (payment_intent_id);

alter table public.stripe_events enable row level security;

revoke all on public.stripe_events from public, anon, authenticated;
grant all on public.stripe_events to service_role;
