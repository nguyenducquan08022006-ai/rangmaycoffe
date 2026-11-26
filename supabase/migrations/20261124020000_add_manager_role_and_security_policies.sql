-- Add Shop Manager RBAC role, persistent security policies, and encrypted backup metadata

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('customer', 'staff', 'manager', 'admin'));

create table if not exists public.security_policies (
  id text primary key default 'default' check (id = 'default'),
  require_admin_mfa boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_by_email text,
  updated_at timestamptz not null default now()
);

create index if not exists security_policies_updated_by_idx
  on public.security_policies (updated_by);

alter table public.security_policies enable row level security;

drop policy if exists "security_policies_deny_clients" on public.security_policies;
create policy "security_policies_deny_clients"
  on public.security_policies
  for all
  to anon, authenticated
  using (false)
  with check (false);

revoke all on public.security_policies from public, anon, authenticated;
revoke all on public.security_policies from service_role;
grant select, insert, update on public.security_policies to service_role;

insert into public.security_policies (id, require_admin_mfa)
values ('default', false)
on conflict (id) do nothing;

alter table public.backup_snapshots
  add column if not exists is_encrypted boolean not null default false,
  add column if not exists encryption_alg text;
