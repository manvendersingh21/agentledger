-- Merchant Network: API credentials, merchant-published catalogs, and applications.

create table public.merchant_api_keys (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.merchant_registrations on delete cascade,
  owner_id uuid not null references auth.users on delete cascade,
  key_prefix text not null check (char_length(key_prefix) = 12),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index merchant_api_keys_registration_created_idx
  on public.merchant_api_keys (registration_id, created_at desc);
create index merchant_api_keys_owner_created_idx
  on public.merchant_api_keys (owner_id, created_at desc);

alter table public.merchant_api_keys enable row level security;

revoke all on public.merchant_api_keys from public, anon, authenticated;
grant select on public.merchant_api_keys to authenticated;
grant all on public.merchant_api_keys to service_role;

create policy merchant_api_keys_select_own on public.merchant_api_keys
  for select to authenticated
  using (owner_id = (select auth.uid()));

alter table public.products
  add column source text not null default 'catalog'
    check (source in ('catalog', 'merchant_feed', 'external')),
  add column external_url text,
  add column published_by_registration uuid
    references public.merchant_registrations on delete set null;

alter table public.products
  add constraint products_merchant_feed_registration_check
  check (source <> 'merchant_feed' or published_by_registration is not null),
  add constraint products_merchant_feed_sku_check
  check (
    source <> 'merchant_feed'
    or nullif(btrim(metadata ->> 'sku'), '') is not null
  );

create index products_published_registration_idx
  on public.products (published_by_registration, created_at desc)
  where published_by_registration is not null;

-- The binding adds no products.sku column. Keep the merchant SKU in metadata and
-- enforce its registration-scoped identity for merchant-feed rows.
create unique index products_merchant_feed_registration_sku_uidx
  on public.products (published_by_registration, (metadata ->> 'sku'))
  where source = 'merchant_feed';

create table public.merchant_applications (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  domain text not null,
  contact_name text not null,
  contact_email text not null,
  message text not null,
  status text not null default 'new'
    check (status in ('new', 'contacted')),
  created_at timestamptz not null default now()
);

create index merchant_applications_status_created_idx
  on public.merchant_applications (status, created_at desc);

alter table public.merchant_applications enable row level security;

revoke all on public.merchant_applications from public, anon, authenticated;
grant all on public.merchant_applications to service_role;

-- Atomic, registration-scoped catalog upsert. The HTTP route validates the
-- request first; these checks are defense in depth for future server callers.
create or replace function public.upsert_merchant_feed_products(
  p_registration_id uuid,
  p_products jsonb
)
returns setof public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_merchant_id uuid;
begin
  if jsonb_typeof(p_products) <> 'array'
    or jsonb_array_length(p_products) < 1
    or jsonb_array_length(p_products) > 100 then
    raise exception 'INVALID_MERCHANT_FEED';
  end if;

  select r.merchant_id
    into v_merchant_id
  from public.merchant_registrations as r
  where r.id = p_registration_id
    and r.status = 'verified';

  if v_merchant_id is null then
    raise exception 'MERCHANT_NOT_VERIFIED';
  end if;

  return query
  insert into public.products as product (
    merchant_id,
    name,
    description,
    price_cents,
    currency,
    recurring,
    metadata,
    active,
    category,
    attributes,
    market_price_cents,
    source,
    external_url,
    published_by_registration
  )
  select
    v_merchant_id,
    feed.name,
    feed.description,
    feed.price_cents,
    feed.currency,
    feed.recurring,
    jsonb_build_object('sku', feed.sku),
    true,
    feed.category,
    coalesce(feed.attributes, '{}'::jsonb),
    feed.market_price_cents,
    'merchant_feed',
    null,
    p_registration_id
  from jsonb_to_recordset(p_products) as feed(
    sku text,
    name text,
    description text,
    price_cents integer,
    currency text,
    recurring boolean,
    category text,
    attributes jsonb,
    market_price_cents integer
  )
  on conflict (published_by_registration, (metadata ->> 'sku'))
    where source = 'merchant_feed'
  do update set
    merchant_id = excluded.merchant_id,
    name = excluded.name,
    description = excluded.description,
    price_cents = excluded.price_cents,
    currency = excluded.currency,
    recurring = excluded.recurring,
    metadata = excluded.metadata,
    active = true,
    category = excluded.category,
    attributes = excluded.attributes,
    market_price_cents = excluded.market_price_cents,
    external_url = null
  returning product.*;
end;
$$;

revoke execute on function public.upsert_merchant_feed_products(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_merchant_feed_products(uuid, jsonb)
  to service_role;
