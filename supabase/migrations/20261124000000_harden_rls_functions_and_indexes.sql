-- Security hardening: private trigger schema, search_path='', optimized RLS, least-privilege grants, FK indexes

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    pg_catalog.left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 100),
    'customer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

drop function if exists public.handle_new_user();

create or replace function private.handle_user_email_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set email = coalesce(new.email, ''),
      updated_at = pg_catalog.now()
  where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function private.handle_user_email_sync();

drop function if exists public.handle_user_email_sync();

create or replace function private.prevent_profile_privilege_escalation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  if current_user not in ('postgres', 'supabase_admin', 'service_role')
    and coalesce(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
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
  for each row execute function private.prevent_profile_privilege_escalation();

drop function if exists public.prevent_profile_privilege_escalation();

revoke all on function private.handle_new_user() from public, anon, authenticated;
revoke all on function private.handle_user_email_sync() from public, anon, authenticated;
revoke all on function private.prevent_profile_privilege_escalation() from public, anon, authenticated;

create or replace function public.check_rate_limit(
  p_bucket text,
  p_max_requests integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_window_start timestamptz;
  v_count integer;
begin
  if p_bucket is null or pg_catalog.char_length(p_bucket) = 0 or p_max_requests <= 0 or p_window_seconds <= 0 then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_bucket));

  v_window_start := v_now - pg_catalog.make_interval(secs => p_window_seconds);

  delete from public.rate_limit_events
  where created_at < v_now - interval '24 hours'
     or (bucket = p_bucket and created_at < v_window_start);

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

revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

-- Optimized and anonymous-safe RLS policies
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (
    (select auth.uid()) = id
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  );

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (
    (select auth.uid()) = id
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  )
  with check (
    (select auth.uid()) = id
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  );

drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own"
  on public.orders
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  );

drop policy if exists "contact_messages_select_own" on public.contact_messages;
create policy "contact_messages_select_own"
  on public.contact_messages
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  );

drop policy if exists "security_audit_logs_deny_clients" on public.security_audit_logs;
create policy "security_audit_logs_deny_clients"
  on public.security_audit_logs
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "rate_limit_events_deny_clients" on public.rate_limit_events;
create policy "rate_limit_events_deny_clients"
  on public.rate_limit_events
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- Least-privilege grants (replaces overly broad grant all)
revoke all on public.orders, public.contact_messages, public.profiles, public.security_audit_logs, public.rate_limit_events from public, anon, authenticated;
revoke all on sequence public.order_number_seq, public.security_audit_logs_id_seq, public.rate_limit_events_id_seq from public, anon, authenticated;

revoke all on public.orders, public.contact_messages, public.profiles, public.security_audit_logs, public.rate_limit_events from service_role;
grant select, insert, update on public.orders to service_role;
grant select, insert, update on public.contact_messages to service_role;
grant select, insert, update on public.profiles to service_role;
grant select, insert on public.security_audit_logs to service_role;
grant select, insert, delete on public.rate_limit_events to service_role;
grant usage, select on sequence public.order_number_seq, public.security_audit_logs_id_seq, public.rate_limit_events_id_seq to service_role;

-- Missing foreign-key indexes
create index if not exists contact_messages_user_id_idx
  on public.contact_messages (user_id);

create index if not exists orders_updated_by_idx
  on public.orders (updated_by);

create index if not exists contact_messages_handled_by_idx
  on public.contact_messages (handled_by);

create index if not exists security_audit_logs_actor_id_idx
  on public.security_audit_logs (actor_id);
