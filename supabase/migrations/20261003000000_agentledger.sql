-- AgentLedger: privileged writes, tenant reads, and database-enforced transitions.
create type public.intent_status as enum (
  'proposed', 'evaluating', 'denied', 'awaiting_approval', 'approved',
  'executing', 'executed', 'failed', 'expired', 'duplicate'
);
create type public.policy_decision_kind as enum ('deny', 'auto_approve', 'require_approval');
create type public.approval_status as enum ('pending', 'approved', 'denied', 'expired');
create type public.execution_status as enum ('pending', 'succeeded', 'failed');
create type public.delegation_status as enum ('active', 'disabled', 'revoked');
create type public.agent_status as enum ('active', 'disabled');

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  name text not null,
  description text,
  agent_type text not null default 'claude',
  status public.agent_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.merchants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  trusted boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants,
  name text not null,
  description text not null,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'usd',
  recurring boolean not null default false,
  metadata jsonb not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.delegations (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references auth.users on delete cascade,
  agent_id uuid not null references public.agents on delete cascade,
  action_type text not null default 'purchase' check (action_type = 'purchase'),
  max_amount_cents integer not null check (max_amount_cents > 0),
  daily_limit_cents integer not null check (daily_limit_cents > 0),
  approval_threshold_cents integer not null check (approval_threshold_cents >= 0),
  allow_recurring boolean not null default false,
  allowed_merchants text[] not null default '{}',
  denied_merchants text[] not null default '{}',
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  status public.delegation_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.action_intents (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references auth.users on delete cascade,
  agent_id uuid not null references public.agents,
  delegation_id uuid references public.delegations,
  action_type text not null default 'purchase',
  status public.intent_status not null default 'proposed',
  payload jsonb not null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null,
  merchant_slug text not null,
  product_id uuid references public.products,
  recurring boolean not null,
  idempotency_key text not null,
  risk_level text not null default 'low' check (risk_level in ('low', 'medium', 'high', 'critical')),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (principal_id, idempotency_key)
);

create table public.policy_decisions (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null references public.action_intents on delete cascade,
  principal_id uuid not null,
  decision public.policy_decision_kind not null,
  rules_evaluated jsonb not null,
  violations jsonb not null default '[]',
  approval_required boolean not null,
  policy_version text not null,
  created_at timestamptz not null default now()
);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null unique references public.action_intents on delete cascade,
  principal_id uuid not null,
  status public.approval_status not null default 'pending',
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_reason text
);

create table public.executions (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null unique references public.action_intents on delete cascade,
  principal_id uuid not null,
  idempotency_key text not null unique,
  status public.execution_status not null default 'pending',
  provider text not null,
  provider_operation_id text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  result jsonb,
  error jsonb
);

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null unique references public.action_intents on delete cascade,
  execution_id uuid not null unique references public.executions on delete cascade,
  principal_id uuid not null,
  provider text not null,
  provider_reference text not null,
  amount_cents integer not null,
  currency text not null,
  receipt_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Deliberately no user/intent FK: audit history survives removal of source records.
create table public.audit_events (
  id uuid primary key,
  principal_id uuid not null,
  agent_id uuid,
  intent_id uuid,
  event_type text not null,
  event_data jsonb not null default '{}',
  previous_hash text not null,
  event_hash text not null unique,
  created_at timestamptz not null,
  unique (principal_id, previous_hash)
);

create index agents_owner_created_idx on public.agents (owner_id, created_at desc);
create index products_merchant_idx on public.products (merchant_id);
create index delegations_principal_created_idx on public.delegations (principal_id, created_at desc);
create index delegations_agent_idx on public.delegations (agent_id);
create index intents_principal_created_idx on public.action_intents (principal_id, created_at desc);
create index intents_agent_idx on public.action_intents (agent_id);
create index intents_delegation_idx on public.action_intents (delegation_id);
create index decisions_principal_created_idx on public.policy_decisions (principal_id, created_at desc);
create index decisions_intent_idx on public.policy_decisions (intent_id);
create index approvals_principal_requested_idx on public.approvals (principal_id, requested_at desc);
create index executions_principal_started_idx on public.executions (principal_id, started_at desc);
create index receipts_principal_created_idx on public.receipts (principal_id, created_at desc);
create index audit_principal_created_idx on public.audit_events (principal_id, created_at desc);
create index audit_intent_idx on public.audit_events (intent_id);
-- Unique constraints already index intent_id on approvals, executions and receipts.

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger agents_updated_at before update on public.agents
for each row execute function public.touch_updated_at();
create trigger delegations_updated_at before update on public.delegations
for each row execute function public.touch_updated_at();
create trigger intents_updated_at before update on public.action_intents
for each row execute function public.touch_updated_at();

create function public.enforce_intent_transition() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.status = new.status then return new; end if;
  if (old.status = 'proposed' and new.status = 'evaluating')
    or (old.status = 'evaluating' and new.status in ('denied', 'awaiting_approval', 'approved'))
    or (old.status = 'awaiting_approval' and new.status in ('approved', 'denied', 'expired'))
    or (old.status = 'approved' and new.status in ('executing', 'denied'))
    or (old.status = 'executing' and new.status in ('executed', 'failed')) then
    return new;
  end if;
  raise exception 'INVALID_STATE_TRANSITION % -> %', old.status, new.status;
end;
$$;

create trigger enforce_intent_transition before update of status on public.action_intents
for each row execute function public.enforce_intent_transition();

create function public.enforce_audit_append_only() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_setting('agentledger.allow_reset', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'AUDIT_APPEND_ONLY';
end;
$$;

create trigger audit_append_only before update or delete on public.audit_events
for each row execute function public.enforce_audit_append_only();

alter table public.profiles enable row level security;
alter table public.agents enable row level security;
alter table public.merchants enable row level security;
alter table public.products enable row level security;
alter table public.delegations enable row level security;
alter table public.action_intents enable row level security;
alter table public.policy_decisions enable row level security;
alter table public.approvals enable row level security;
alter table public.executions enable row level security;
alter table public.receipts enable row level security;
alter table public.audit_events enable row level security;

-- Supabase defaults can grant table-wide writes: revoke first, then grant narrowly.
revoke all on public.profiles, public.agents, public.merchants, public.products,
  public.delegations, public.action_intents, public.policy_decisions, public.approvals,
  public.executions, public.receipts, public.audit_events from public, anon, authenticated;
grant select on public.profiles, public.agents, public.merchants, public.products,
  public.delegations, public.action_intents, public.policy_decisions, public.approvals,
  public.executions, public.receipts, public.audit_events to authenticated;
grant select on public.merchants, public.products to anon;
grant all on public.profiles, public.agents, public.merchants, public.products,
  public.delegations, public.action_intents, public.policy_decisions, public.approvals,
  public.executions, public.receipts, public.audit_events to service_role;
grant update (max_amount_cents, daily_limit_cents, approval_threshold_cents, allow_recurring,
  allowed_merchants, denied_merchants, status, valid_until) on public.delegations to authenticated;

create policy profiles_read_own on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy agents_read_own on public.agents for select to authenticated using (owner_id = (select auth.uid()));
create policy merchants_read on public.merchants for select to anon, authenticated using (true);
create policy products_read on public.products for select to anon, authenticated using (true);
create policy delegations_read_own on public.delegations for select to authenticated using (principal_id = (select auth.uid()));
create policy delegations_update_own on public.delegations for update to authenticated
  using (principal_id = (select auth.uid())) with check (principal_id = (select auth.uid()));
create policy intents_read_own on public.action_intents for select to authenticated using (principal_id = (select auth.uid()));
create policy decisions_read_own on public.policy_decisions for select to authenticated using (principal_id = (select auth.uid()));
create policy approvals_read_own on public.approvals for select to authenticated using (principal_id = (select auth.uid()));
create policy executions_read_own on public.executions for select to authenticated using (principal_id = (select auth.uid()));
create policy receipts_read_own on public.receipts for select to authenticated using (principal_id = (select auth.uid()));
create policy audit_read_own on public.audit_events for select to authenticated using (principal_id = (select auth.uid()));

create function public.claim_execution(p_intent_id uuid, p_idempotency_key text, p_provider text)
returns table(claimed boolean, execution_id uuid, execution_status public.execution_status, intent_status public.intent_status)
language plpgsql security definer set search_path = public as $$
declare
  v_principal_id uuid;
  v_execution_id uuid;
begin
  -- Concurrent updates serialize on the intent; the WHERE clause is rechecked.
  update public.action_intents as i set status = 'executing'
    where i.id = p_intent_id and i.status = 'approved'
    returning i.principal_id into v_principal_id;
  if found then
    insert into public.executions (intent_id, principal_id, idempotency_key, provider)
      values (p_intent_id, v_principal_id, p_idempotency_key, p_provider)
      returning id into v_execution_id;
    return query select true, v_execution_id, 'pending'::public.execution_status, 'executing'::public.intent_status;
  else
    return query
      select false, e.id, e.status, i.status
      from (select p_intent_id as id) as requested
      left join public.action_intents as i on i.id = requested.id
      left join public.executions as e on e.intent_id = i.id;
  end if;
end;
$$;

create function public.resolve_approval(p_approval_id uuid, p_principal_id uuid, p_decision text, p_reason text)
returns table(resolved boolean, approval_status public.approval_status, intent_id uuid, intent_status public.intent_status)
language plpgsql security definer set search_path = public as $$
declare
  v_approval public.approvals%rowtype;
  v_intent_status public.intent_status;
begin
  if p_decision is null or p_decision not in ('approved', 'denied') then
    raise exception 'INVALID_APPROVAL_DECISION';
  end if;
  select a.* into v_approval from public.approvals as a where a.id = p_approval_id for update;
  if not found or v_approval.principal_id is distinct from p_principal_id then
    raise exception 'NOT_AUTHORIZED';
  end if;
  select i.status into v_intent_status from public.action_intents as i where i.id = v_approval.intent_id;
  if v_approval.status <> 'pending' then
    return query select false, v_approval.status, v_approval.intent_id, v_intent_status;
    return;
  end if;
  update public.action_intents as i set status = p_decision::public.intent_status
    where i.id = v_approval.intent_id and i.principal_id = p_principal_id and i.status = 'awaiting_approval'
    returning i.status into v_intent_status;
  if not found then
    raise exception 'INVALID_STATE_TRANSITION approval requires awaiting_approval intent';
  end if;
  update public.approvals as a set status = p_decision::public.approval_status,
    resolved_at = now(), resolution_reason = p_reason where a.id = p_approval_id;
  return query select true, p_decision::public.approval_status, v_approval.intent_id, v_intent_status;
end;
$$;

create function public.daily_committed_spend(p_principal_id uuid, p_exclude_intent uuid default null)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(sum(i.amount_cents), 0)::bigint
  from public.action_intents as i
  where i.principal_id = p_principal_id
    and i.status in ('awaiting_approval', 'approved', 'executing', 'executed')
    and i.created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
    and (p_exclude_intent is null or i.id <> p_exclude_intent);
$$;

create function public.ensure_principal_setup(p_principal_id uuid, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_agent_id uuid;
begin
  -- Lock an existing parent row so simultaneous first sign-ins remain idempotent.
  perform 1 from auth.users as u where u.id = p_principal_id for update;
  if not found then raise exception 'NOT_AUTHORIZED'; end if;
  insert into public.profiles (id, display_name) values (p_principal_id, p_display_name)
    on conflict (id) do nothing;
  select a.id into v_agent_id from public.agents as a
    where a.owner_id = p_principal_id and a.name = 'Claude Purchasing Agent' and a.agent_type = 'claude'
    order by a.created_at, a.id limit 1;
  if v_agent_id is null then
    insert into public.agents (owner_id, name, description, agent_type)
      values (p_principal_id, 'Claude Purchasing Agent', 'Makes purchases within your delegated policy.', 'claude')
      returning id into v_agent_id;
  end if;
  if not exists (select 1 from public.delegations as d where d.principal_id = p_principal_id and d.agent_id = v_agent_id) then
    insert into public.delegations (principal_id, agent_id, max_amount_cents, daily_limit_cents,
      approval_threshold_cents, allow_recurring, allowed_merchants, denied_merchants, status, valid_from, valid_until)
    values (p_principal_id, v_agent_id, 2000, 5000, 1000, false,
      array['acme-api', 'vectorbase', 'devhost'], '{}', 'active', now() - interval '1 day', null);
  end if;
  return v_agent_id;
end;
$$;

create function public.reset_demo(p_principal_id uuid)
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
    status = 'active', valid_from = now() - interval '1 day', valid_until = null
    where principal_id = p_principal_id;
  perform set_config('agentledger.allow_reset', coalesce(v_previous_reset, 'off'), true);
end;
$$;

create function public.broadcast_principal_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform realtime.broadcast_changes(
    'user:' || new.principal_id::text, tg_op, tg_op, tg_table_name, tg_table_schema, new, old
  );
  return null;
end;
$$;

create trigger intents_broadcast after insert or update on public.action_intents
for each row execute function public.broadcast_principal_change();
create trigger approvals_broadcast after insert or update on public.approvals
for each row execute function public.broadcast_principal_change();
create trigger executions_broadcast after insert or update on public.executions
for each row execute function public.broadcast_principal_change();
create trigger receipts_broadcast after insert or update on public.receipts
for each row execute function public.broadcast_principal_change();
create trigger audit_broadcast after insert on public.audit_events
for each row execute function public.broadcast_principal_change();

-- Supabase owns this table and already enables RLS on it.
create policy agentledger_broadcast_read_own on realtime.messages for select to authenticated
using (realtime.topic() = 'user:' || (select auth.uid())::text);

revoke execute on function public.claim_execution(uuid, text, text),
  public.resolve_approval(uuid, uuid, text, text), public.daily_committed_spend(uuid, uuid),
  public.reset_demo(uuid), public.ensure_principal_setup(uuid, text),
  public.touch_updated_at(), public.enforce_intent_transition(), public.enforce_audit_append_only(),
  public.broadcast_principal_change() from public, anon, authenticated;
grant execute on function public.claim_execution(uuid, text, text),
  public.resolve_approval(uuid, uuid, text, text), public.daily_committed_spend(uuid, uuid),
  public.reset_demo(uuid), public.ensure_principal_setup(uuid, text) to service_role;
