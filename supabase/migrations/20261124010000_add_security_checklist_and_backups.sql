-- Security Center persistence: periodic security checklist state & SHA-256 verified backup snapshot registry

create table if not exists public.security_checklists (
  id text primary key default 'default' check (id = 'default'),
  checked_items text[] not null default '{}',
  updated_by uuid references auth.users(id) on delete set null,
  updated_by_email text,
  updated_at timestamptz not null default now()
);

create table if not exists public.backup_snapshots (
  id uuid primary key default gen_random_uuid(),
  filename text not null check (char_length(filename) between 10 and 128),
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  record_counts jsonb not null default '{}'::jsonb,
  size_bytes integer not null check (size_bytes >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now()
);

create index if not exists security_checklists_updated_by_idx
  on public.security_checklists (updated_by);

create index if not exists backup_snapshots_created_by_idx
  on public.backup_snapshots (created_by);

create index if not exists backup_snapshots_created_at_idx
  on public.backup_snapshots (created_at desc);

alter table public.security_checklists enable row level security;
alter table public.backup_snapshots enable row level security;

drop policy if exists "security_checklists_deny_clients" on public.security_checklists;
create policy "security_checklists_deny_clients"
  on public.security_checklists
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "backup_snapshots_deny_clients" on public.backup_snapshots;
create policy "backup_snapshots_deny_clients"
  on public.backup_snapshots
  for all
  to anon, authenticated
  using (false)
  with check (false);

revoke all on public.security_checklists, public.backup_snapshots from public, anon, authenticated;
revoke all on public.security_checklists, public.backup_snapshots from service_role;

grant select, insert, update on public.security_checklists to service_role;
grant select, insert on public.backup_snapshots to service_role;

insert into public.security_checklists (id, checked_items)
values ('default', array['daily_uptime', 'daily_backup', 'monthly_ssl'])
on conflict (id) do nothing;
