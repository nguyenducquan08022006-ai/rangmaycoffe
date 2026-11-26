create sequence if not exists public.order_number_seq;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default (
    'RM-' || to_char(now() at time zone 'UTC', 'YYYYMMDD') || '-' ||
    lpad(nextval('public.order_number_seq')::text, 6, '0')
  ),
  customer_name text not null check (char_length(customer_name) between 2 and 100),
  customer_phone text not null check (char_length(customer_phone) between 10 and 13),
  customer_email text check (customer_email is null or char_length(customer_email) <= 254),
  shipping_address text not null check (char_length(shipping_address) between 5 and 500),
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  total_amount integer not null check (total_amount > 0),
  payment_method text not null check (payment_method = 'COD'),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'shipped', 'completed', 'cancelled')),
  gift_message text check (gift_message is null or char_length(gift_message) <= 1000),
  created_at timestamptz not null default now()
);

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  email text not null check (char_length(email) <= 254),
  phone text check (phone is null or char_length(phone) <= 16),
  message text not null check (char_length(message) between 2 and 2000),
  created_at timestamptz not null default now()
);

alter table public.orders enable row level security;
alter table public.contact_messages enable row level security;

revoke all on public.orders from anon, authenticated;
revoke all on public.contact_messages from anon, authenticated;
revoke all on sequence public.order_number_seq from anon, authenticated;
grant all on public.orders to service_role;
grant all on public.contact_messages to service_role;
grant usage, select on sequence public.order_number_seq to service_role;
