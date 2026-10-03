-- Scenario catalog: product categories, delegation scenario fields, inventory, intent_hash on approvals.

alter table public.products
  add column if not exists category text not null default 'software',
  add column if not exists attributes jsonb not null default '{}',
  add column if not exists market_price_cents integer,
  add column if not exists image_emoji text;

alter table public.delegations
  add column if not exists allowed_categories text[] not null default '{}',
  add column if not exists blocked_categories text[] not null default '{crypto,gift_card,wire_transfer}',
  add column if not exists market_price_tolerance numeric not null default 1.5,
  add column if not exists scenario text not null default 'software';

alter table public.approvals
  add column if not exists intent_hash text;

grant update (
  max_amount_cents, daily_limit_cents, approval_threshold_cents, allow_recurring,
  allowed_merchants, denied_merchants, status, valid_until,
  min_trust_score, trusted_domain_overrides, price_anomaly_deny_threshold,
  price_anomaly_review_threshold, injection_kill_threshold, kill_switch_enabled,
  require_verified_merchant, allowed_domains,
  allowed_categories, blocked_categories, market_price_tolerance, scenario
) on public.delegations to authenticated;

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references auth.users on delete cascade,
  name text not null,
  unit text not null,
  on_hand numeric not null,
  par_level numeric not null,
  reorder_point numeric not null,
  preferred_category text not null,
  search_query text not null,
  reorder_qty integer not null default 1,
  last_ordered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index inventory_items_principal_idx on public.inventory_items (principal_id);

alter table public.inventory_items enable row level security;

revoke all on public.inventory_items from public, anon, authenticated;
grant select on public.inventory_items to authenticated;
grant update (on_hand, par_level, reorder_point) on public.inventory_items to authenticated;
grant all on public.inventory_items to service_role;

create policy inventory_items_read_own on public.inventory_items for select to authenticated
  using (principal_id = (select auth.uid()));

create policy inventory_items_update_own on public.inventory_items for update to authenticated
  using (principal_id = (select auth.uid()))
  with check (principal_id = (select auth.uid()));

create trigger inventory_items_touch_updated_at before update on public.inventory_items
for each row execute function public.touch_updated_at();

create trigger inventory_items_broadcast after insert or update on public.inventory_items
for each row execute function public.broadcast_principal_change();

create or replace function public.seed_principal_inventory(p_principal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.inventory_items where principal_id = p_principal_id;
  insert into public.inventory_items (
    principal_id, name, unit, on_hand, par_level, reorder_point, preferred_category, search_query, reorder_qty
  ) values
    (p_principal_id, 'Frying oil', 'lb', 28, 35, 18, 'restaurant_food', 'frying oil', 1),
    (p_principal_id, 'All-purpose flour', 'lb', 42, 50, 25, 'restaurant_food', 'flour', 1),
    (p_principal_id, 'Napkins', 'case', 4, 8, 3, 'restaurant_supplies', 'napkins', 1),
    (p_principal_id, 'To-go boxes', 'case', 6, 12, 4, 'restaurant_supplies', 'to-go boxes', 1),
    (p_principal_id, 'Tomatoes', 'case', 5, 10, 3, 'restaurant_food', 'tomatoes', 1),
    (p_principal_id, 'Mozzarella cheese', 'lb', 14, 20, 8, 'restaurant_food', 'mozzarella', 1),
    (p_principal_id, 'Nitrile gloves', 'case', 2, 4, 1, 'restaurant_supplies', 'nitrile gloves', 1),
    (p_principal_id, 'Dish soap', 'gal', 3, 6, 2, 'restaurant_supplies', 'dish soap', 1);
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
  perform set_config('agentledger.allow_reset', coalesce(v_previous_reset, 'off'), true);
end;
$$;

revoke execute on function public.seed_principal_inventory(uuid) from public, anon, authenticated;
grant execute on function public.seed_principal_inventory(uuid) to service_role;
