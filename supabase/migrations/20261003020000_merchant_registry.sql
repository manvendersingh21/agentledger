-- Verified merchant registry: domain ownership proofs and delegation policy hook.

alter table public.merchants
  add column if not exists verified boolean not null default false,
  add column if not exists verified_at timestamptz;

update public.merchants as m set
  verified = true,
  verified_at = coalesce(m.verified_at, now())
where m.slug in ('acme-api', 'vectorbase');

update public.merchants as m set
  verified = false,
  verified_at = null
where m.slug = 'evil-cloud';

alter table public.delegations
  add column if not exists require_verified_merchant boolean not null default false;

grant update (
  max_amount_cents, daily_limit_cents, approval_threshold_cents, allow_recurring,
  allowed_merchants, denied_merchants, status, valid_until,
  min_trust_score, trusted_domain_overrides, price_anomaly_deny_threshold,
  price_anomaly_review_threshold, injection_kill_threshold, kill_switch_enabled,
  require_verified_merchant
) on public.delegations to authenticated;

create table public.merchant_registrations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  merchant_id uuid references public.merchants,
  company_name text not null,
  domain text not null,
  contact_email text not null,
  verification_method text not null,
  verification_token text not null,
  status text not null default 'pending',
  verified_at timestamptz,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  constraint merchant_registrations_verification_method_check
    check (verification_method in ('dns_txt', 'well_known')),
  constraint merchant_registrations_status_check
    check (status in ('pending', 'verified', 'failed', 'revoked')),
  constraint merchant_registrations_domain_hostname_check check (
    domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  )
);

create unique index merchant_registrations_domain_lower_idx
  on public.merchant_registrations (lower(domain));

create index merchant_registrations_owner_created_idx
  on public.merchant_registrations (owner_id, created_at desc);

create or replace function public.merchant_registrations_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.domain := lower(trim(new.domain));
  new.status := 'pending';
  if new.verification_token is null or btrim(new.verification_token) = '' then
    new.verification_token := encode(gen_random_bytes(32), 'hex');
  end if;
  return new;
end;
$$;

drop trigger if exists merchant_registrations_before_insert on public.merchant_registrations;
create trigger merchant_registrations_before_insert
  before insert on public.merchant_registrations
  for each row execute function public.merchant_registrations_before_insert();

create or replace function public.merchant_registrations_block_owner_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user = 'authenticated' then
    raise exception 'MERCHANT_REGISTRATION_UPDATE_FORBIDDEN';
  end if;
  return new;
end;
$$;

drop trigger if exists merchant_registrations_block_owner_update on public.merchant_registrations;
create trigger merchant_registrations_block_owner_update
  before update on public.merchant_registrations
  for each row execute function public.merchant_registrations_block_owner_update();

alter table public.merchant_registrations enable row level security;

revoke all on public.merchant_registrations from public, anon, authenticated;
grant select on public.merchant_registrations to authenticated;
grant insert (
  owner_id, company_name, domain, contact_email, verification_method
) on public.merchant_registrations to authenticated;
grant all on public.merchant_registrations to service_role;

drop policy if exists merchant_registrations_select_own on public.merchant_registrations;
create policy merchant_registrations_select_own on public.merchant_registrations
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists merchant_registrations_insert_own on public.merchant_registrations;
create policy merchant_registrations_insert_own on public.merchant_registrations
  for insert to authenticated
  with check (owner_id = (select auth.uid()));
