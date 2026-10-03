-- Allowed websites: delegation may restrict purchases to specific merchant hostnames.

alter table public.delegations
  add column if not exists allowed_domains text[] not null default '{}';

grant update (
  max_amount_cents, daily_limit_cents, approval_threshold_cents, allow_recurring,
  allowed_merchants, denied_merchants, status, valid_until,
  min_trust_score, trusted_domain_overrides, price_anomaly_deny_threshold,
  price_anomaly_review_threshold, injection_kill_threshold, kill_switch_enabled,
  require_verified_merchant, allowed_domains
) on public.delegations to authenticated;

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
    allowed_domains = '{}'
    where principal_id = p_principal_id;
  update public.agents set status = 'active', suspended_at = null, suspended_reason = null
    where owner_id = p_principal_id and suspended_at is not null;
  perform set_config('agentledger.allow_reset', coalesce(v_previous_reset, 'off'), true);
end;
$$;
