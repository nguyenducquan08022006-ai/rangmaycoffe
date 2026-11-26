-- Auth, RBAC (customer / staff / admin), workflow columns, rate limiting, and audit logs

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '' check (char_length(full_name) <= 100),
  phone text check (phone is null or char_length(phone) <= 16),
  default_address text check (default_address is null or char_length(default_address) <= 500),
  role text not null default 'customer' check (role in ('customer', 'staff', 'admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 100),
    'customer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set email = coalesce(new.email, ''),
      updated_at = now()
  where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function public.handle_user_email_sync();

create or replace function public.prevent_profile_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  if coalesce(auth.role(), '') <> 'service_role' then
    if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
      raise exception 'Unauthorized profile privilege update';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_profile_privilege_escalation on public.profiles;
create trigger trg_prevent_profile_privilege_escalation
  before update on public.profiles
  for each row execute function public.prevent_profile_privilege_escalation();

-- Backfill profiles for any existing auth.users rows created prior to migration
insert into public.profiles (id, email, full_name, role)
select
  id,
  coalesce(email, ''),
  left(coalesce(raw_user_meta_data ->> 'full_name', ''), 100),
  'customer'
from auth.users
on conflict (id) do nothing;

alter table public.orders
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists internal_note text check (internal_note is null or char_length(internal_note) <= 1000);

create index if not exists orders_user_id_created_at_idx
  on public.orders (user_id, created_at desc);

create index if not exists orders_status_created_at_idx
  on public.orders (status, created_at desc);

alter table public.contact_messages
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists status text not null default 'new' check (status in ('new', 'in_progress', 'resolved')),
  add column if not exists handled_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists contact_messages_status_created_at_idx
  on public.contact_messages (status, created_at desc);

create table if not exists public.security_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  actor_role text,
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  ip_hash text,
  created_at timestamptz not null default now()
);

create index if not exists security_audit_logs_created_at_idx
  on public.security_audit_logs (created_at desc);

create table if not exists public.rate_limit_events (
  id bigint generated always as identity primary key,
  bucket text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_events_bucket_created_at_idx
  on public.rate_limit_events (bucket, created_at desc);

create or replace function public.check_rate_limit(
  p_bucket text,
  p_max_requests integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_window_start timestamptz;
  v_count integer;
begin
  if p_bucket is null or char_length(p_bucket) = 0 or p_max_requests <= 0 or p_window_seconds <= 0 then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_bucket));

  v_window_start := v_now - make_interval(secs => p_window_seconds);

  delete from public.rate_limit_events
  where bucket = p_bucket
    and created_at < v_window_start;

  select count(*) into v_count
  from public.rate_limit_events
  where bucket = p_bucket
    and created_at >= v_window_start;

  if v_count >= p_max_requests then
    return false;
  end if;

  insert into public.rate_limit_events (bucket, created_at)
  values (p_bucket, v_now);

  return true;
end;
$$;

alter table public.profiles enable row level security;
alter table public.security_audit_logs enable row level security;
alter table public.rate_limit_events enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own"
  on public.orders
  for select
  to authenticated
  using (auth.uid() = user_id);

revoke all on public.profiles from public, anon, authenticated;
revoke all on public.security_audit_logs from public, anon, authenticated;
revoke all on public.rate_limit_events from public, anon, authenticated;
revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;

grant all on public.profiles to service_role;
grant all on public.security_audit_logs to service_role;
grant all on public.rate_limit_events to service_role;
grant usage, select on sequence public.security_audit_logs_id_seq to service_role;
grant usage, select on sequence public.rate_limit_events_id_seq to service_role;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
