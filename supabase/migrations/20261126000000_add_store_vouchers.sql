-- Store Vouchers (Discount / Promo Codes) managed by Shop Manager (manager-api) and Owner (admin-api)

create table if not exists public.store_vouchers (
  code text primary key check (code ~ '^[A-Z0-9_-]{3,24}$'),
  description text not null default '' check (char_length(description) <= 160),
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  discount_value integer not null check (
    (discount_type = 'percent' and discount_value between 1 and 90) or
    (discount_type = 'fixed' and discount_value between 1000 and 2000000)
  ),
  min_order_amount integer not null default 0 check (min_order_amount between 0 and 10000000),
  max_discount_amount integer check (max_discount_amount is null or max_discount_amount between 1000 and 2000000),
  usage_limit integer not null default 100 check (usage_limit between 1 and 100000),
  used_count integer not null default 0 check (used_count >= 0),
  expires_at timestamptz,
  is_active boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists store_vouchers_updated_by_idx
  on public.store_vouchers (updated_by);

alter table public.orders
  add column if not exists subtotal_amount integer check (subtotal_amount is null or subtotal_amount > 0),
  add column if not exists voucher_code text check (voucher_code is null or char_length(voucher_code) <= 24),
  add column if not exists discount_amount integer not null default 0 check (discount_amount >= 0);

create index if not exists orders_voucher_code_idx
  on public.orders (voucher_code)
  where voucher_code is not null;

alter table public.store_vouchers enable row level security;

drop policy if exists "store_vouchers_deny_clients" on public.store_vouchers;
create policy "store_vouchers_deny_clients"
  on public.store_vouchers
  for all
  to anon, authenticated
  using (false)
  with check (false);

revoke all on public.store_vouchers from public, anon, authenticated;
revoke all on public.store_vouchers from service_role;
grant select, insert, update, delete on public.store_vouchers to service_role;

insert into public.store_vouchers (
  code, description, discount_type, discount_value, min_order_amount, max_discount_amount, usage_limit, used_count, is_active
)
values
  ('RANGMAY10', 'Giảm 10% cho đơn từ 100.000đ (tối đa 50.000đ)', 'percent', 10, 100000, 50000, 100, 0, true),
  ('MANGDEN20K', 'Giảm 20.000đ cho đơn từ 119.000đ', 'fixed', 20000, 119000, null, 50, 0, true),
  ('VIP50K', 'Giảm 50.000đ khi mua từ 2 hộp (từ 238.000đ)', 'fixed', 50000, 238000, null, 30, 0, true)
on conflict (code) do nothing;
