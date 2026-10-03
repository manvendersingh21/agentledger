-- AgentLedger guardrails: merchant trust, delegation thresholds, agent suspension, Jev cache.

alter table public.merchants
  add column if not exists domain text,
  add column if not exists trust_score numeric(5, 2),
  add column if not exists trust_score_source text not null default 'unavailable',
  add column if not exists trust_scored_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'merchants_trust_score_source_check'
  ) then
    alter table public.merchants
      add constraint merchants_trust_score_source_check
      check (trust_score_source in ('scamadvisor', 'fixture', 'unavailable'));
  end if;
end $$;

update public.merchants as m set
  domain = v.domain,
  trust_score = v.trust_score,
  trust_score_source = 'fixture',
  trust_scored_at = now()
from (values
  ('acme-api', 'acme-api.dev', 98::numeric),
  ('vectorbase', 'vectorbase.io', 97::numeric),
  ('devhost', 'devhost.app', 96::numeric),
  ('cheapcompute', 'cheapcompute.net', 91::numeric),
  ('evil-cloud', 'evil-cloud-deals.xyz', 12::numeric)
) as v(slug, domain, trust_score)
where m.slug = v.slug;

alter table public.delegations
  add column if not exists min_trust_score integer not null default 95,
  add column if not exists trusted_domain_overrides text[] not null default '{}',
  add column if not exists price_anomaly_deny_threshold numeric not null default 0.8,
  add column if not exists price_anomaly_review_threshold numeric not null default 0.5,
  add column if not exists injection_kill_threshold numeric not null default 0.9,
  add column if not exists kill_switch_enabled boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'delegations_min_trust_score_check'
  ) then
    alter table public.delegations
      add constraint delegations_min_trust_score_check
      check (min_trust_score between 0 and 100);
  end if;
end $$;

grant update (
  max_amount_cents, daily_limit_cents, approval_threshold_cents, allow_recurring,
  allowed_merchants, denied_merchants, status, valid_until,
  min_trust_score, trusted_domain_overrides, price_anomaly_deny_threshold,
  price_anomaly_review_threshold, injection_kill_threshold, kill_switch_enabled
) on public.delegations to authenticated;

alter type public.agent_status add value if not exists 'suspended';

alter table public.agents
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_reason text;

grant update (status) on public.agents to authenticated;

drop policy if exists agents_update_own_status on public.agents;
create policy agents_update_own_status on public.agents for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create table if not exists public.risk_assessments (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references auth.users on delete cascade,
  intent_id uuid,
  product_id uuid not null references public.products,
  provider text not null,
  model text not null,
  prompt_injection numeric not null,
  crypto_exfiltration numeric not null,
  price_anomaly numeric not null,
  content_hash text not null,
  raw jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists risk_assessments_product_hash_idx
  on public.risk_assessments (product_id, content_hash);
create index if not exists risk_assessments_principal_created_idx
  on public.risk_assessments (principal_id, created_at desc);

alter table public.risk_assessments enable row level security;

revoke all on public.risk_assessments from public, anon, authenticated;
grant select on public.risk_assessments to authenticated;
grant all on public.risk_assessments to service_role;

drop policy if exists risk_assessments_read_own on public.risk_assessments;
create policy risk_assessments_read_own on public.risk_assessments for select to authenticated
  using (principal_id = (select auth.uid()));

create function public.broadcast_agent_owner_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform realtime.broadcast_changes(
    'user:' || new.owner_id::text, tg_op, tg_op, tg_table_name, tg_table_schema, new, old
  );
  return null;
end;
$$;

drop trigger if exists agents_broadcast on public.agents;
create trigger agents_broadcast after insert or update on public.agents
for each row execute function public.broadcast_agent_owner_change();

drop trigger if exists risk_assessments_broadcast on public.risk_assessments;
create trigger risk_assessments_broadcast after insert on public.risk_assessments
for each row execute function public.broadcast_principal_change();

create or replace function public.reset_demo(p_principal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_previous_reset text := current_setting('agentledger.allow_reset', true);
begin
  perform 1 from auth.users as u where u.id = p_principal_id for update;
  if not found then raise exception 'NOT_AUTHORIZED'; end if;
  perform set_config('agentledger.allow_reset', 'on', true);
  delete from public.receipts where principal_id = p_principal_id;
  delete from public.executions where principal_id = p_principal_id;
  delete from public.approvals where principal_id = p_principal_id;
  delete from public.policy_decisions where principal_id = p_principal_id;
  delete from public.action_intents where principal_id = p_principal_id;
  delete from public.audit_events where principal_id = p_principal_id;
  update public.delegations set max_amount_cents = 2000, daily_limit_cents = 5000,
    approval_threshold_cents = 1000, allow_recurring = false,
    allowed_merchants = array['acme-api', 'vectorbase', 'devhost'], denied_merchants = '{}',
    status = 'active', valid_from = now() - interval '1 day', valid_until = null,
    min_trust_score = 95, trusted_domain_overrides = '{}',
    price_anomaly_deny_threshold = 0.8, price_anomaly_review_threshold = 0.5,
    injection_kill_threshold = 0.9, kill_switch_enabled = true
    where principal_id = p_principal_id;
  update public.agents set status = 'active', suspended_at = null, suspended_reason = null
    where owner_id = p_principal_id and suspended_at is not null;
  perform set_config('agentledger.allow_reset', coalesce(v_previous_reset, 'off'), true);
end;
$$;

revoke execute on function public.broadcast_agent_owner_change() from public, anon, authenticated;
