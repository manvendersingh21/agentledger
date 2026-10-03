-- Grocery autopilot: household lists, weekly settings, principal defaults, and realtime updates.

create table public.grocery_settings (
  principal_id uuid primary key references auth.users on delete cascade,
  weekly_budget_cents integer not null default 8000 check (weekly_budget_cents > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.grocery_lists (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references auth.users on delete cascade,
  item_name text not null check (length(btrim(item_name)) between 1 and 100),
  quantity integer not null default 1 check (quantity between 1 and 50),
  unit text not null default 'item' check (length(btrim(unit)) between 1 and 30),
  staple boolean not null default false,
  frequency_days integer not null default 7 check (frequency_days between 1 and 365),
  last_bought_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (principal_id, item_name)
);

create index grocery_lists_principal_idx on public.grocery_lists (principal_id);

alter table public.grocery_settings enable row level security;
alter table public.grocery_lists enable row level security;

revoke all on public.grocery_settings, public.grocery_lists from public, anon, authenticated;
grant select, insert, update, delete on public.grocery_settings, public.grocery_lists to authenticated;
grant all on public.grocery_settings, public.grocery_lists to service_role;

create policy grocery_settings_read_own on public.grocery_settings for select to authenticated
  using (principal_id = (select auth.uid()));
create policy grocery_settings_insert_own on public.grocery_settings for insert to authenticated
  with check (principal_id = (select auth.uid()));
create policy grocery_settings_update_own on public.grocery_settings for update to authenticated
  using (principal_id = (select auth.uid()))
  with check (principal_id = (select auth.uid()));
create policy grocery_settings_delete_own on public.grocery_settings for delete to authenticated
  using (principal_id = (select auth.uid()));

create policy grocery_lists_read_own on public.grocery_lists for select to authenticated
  using (principal_id = (select auth.uid()));
create policy grocery_lists_insert_own on public.grocery_lists for insert to authenticated
  with check (principal_id = (select auth.uid()));
create policy grocery_lists_update_own on public.grocery_lists for update to authenticated
  using (principal_id = (select auth.uid()))
  with check (principal_id = (select auth.uid()));
create policy grocery_lists_delete_own on public.grocery_lists for delete to authenticated
  using (principal_id = (select auth.uid()));

create trigger grocery_settings_touch_updated_at before update on public.grocery_settings
for each row execute function public.touch_updated_at();
create trigger grocery_lists_touch_updated_at before update on public.grocery_lists
for each row execute function public.touch_updated_at();

create trigger grocery_settings_broadcast after insert or update on public.grocery_settings
for each row execute function public.broadcast_principal_change();
create trigger grocery_lists_broadcast after insert or update on public.grocery_lists
for each row execute function public.broadcast_principal_change();

create or replace function public.seed_principal_groceries(
  p_principal_id uuid,
  p_reset boolean default false
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_reset then
    delete from public.grocery_lists where principal_id = p_principal_id;
    delete from public.grocery_settings where principal_id = p_principal_id;
  end if;

  insert into public.grocery_settings (principal_id, weekly_budget_cents)
  values (p_principal_id, 8000)
  on conflict (principal_id) do nothing;

  insert into public.grocery_lists (
    principal_id, item_name, quantity, unit, staple, frequency_days
  ) values
    (p_principal_id, 'Milk', 1, 'gallon', true, 7),
    (p_principal_id, 'Eggs', 1, 'dozen', true, 7),
    (p_principal_id, 'Bread', 1, 'loaf', true, 7),
    (p_principal_id, 'Bananas', 1, 'bunch', true, 7),
    (p_principal_id, 'Apples', 1, 'bag', true, 10),
    (p_principal_id, 'Coffee', 1, 'bag', true, 21),
    (p_principal_id, 'Yogurt', 1, 'tub', true, 7),
    (p_principal_id, 'Spinach', 1, 'bag', true, 7),
    (p_principal_id, 'Laundry detergent', 1, 'bottle', true, 30)
  on conflict (principal_id, item_name) do nothing;
end;
$$;

create or replace function public.ensure_principal_setup(p_principal_id uuid, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_agent_id uuid;
begin
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
  if not exists (select 1 from public.inventory_items as i where i.principal_id = p_principal_id) then
    perform public.seed_principal_inventory(p_principal_id);
  end if;
  perform public.seed_principal_groceries(p_principal_id, false);
  return v_agent_id;
end;
$$;

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
    injection_kill_threshold = 0.9, kill_switch_enabled = true,
    allowed_domains = '{}',
    allowed_categories = '{}',
    blocked_categories = array['crypto', 'gift_card', 'wire_transfer'],
    market_price_tolerance = 1.5,
    scenario = 'software'
    where principal_id = p_principal_id;
  update public.agents set status = 'active', suspended_at = null, suspended_reason = null
    where owner_id = p_principal_id and suspended_at is not null;
  perform public.seed_principal_inventory(p_principal_id);
  perform public.seed_principal_groceries(p_principal_id, true);
  perform set_config('agentledger.allow_reset', coalesce(v_previous_reset, 'off'), true);
end;
$$;

revoke execute on function public.seed_principal_groceries(uuid, boolean) from public, anon, authenticated;
grant execute on function public.seed_principal_groceries(uuid, boolean) to service_role;
