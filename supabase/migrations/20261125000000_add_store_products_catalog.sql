-- Live Store Product Catalog managed by Shop Manager (manager-api) and Owner (admin-api)

create table if not exists public.store_products (
  id text primary key check (char_length(id) between 2 and 64),
  sku text not null unique check (char_length(sku) between 2 and 64),
  name text not null check (char_length(name) between 2 and 120),
  price integer not null check (price between 10000 and 5000000),
  stock_quantity integer not null check (stock_quantity between 0 and 10000),
  is_available boolean not null default true,
  badge_text text not null default '' check (char_length(badge_text) <= 120),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists store_products_updated_by_idx
  on public.store_products (updated_by);

alter table public.store_products enable row level security;

drop policy if exists "store_products_deny_clients" on public.store_products;
create policy "store_products_deny_clients"
  on public.store_products
  for all
  to anon, authenticated
  using (false)
  with check (false);

revoke all on public.store_products from public, anon, authenticated;
revoke all on public.store_products from service_role;
grant select, insert, update on public.store_products to service_role;

insert into public.store_products (id, sku, name, price, stock_quantity, is_available, badge_text)
values (
  'drip-pack-001',
  'RM-DRIP-001',
  'Cà phê phin giấy Rang Mây',
  119000,
  50,
  true,
  'Phin giấy tiện lợi, minh bạch lô sản xuất'
)
on conflict (id) do nothing;
