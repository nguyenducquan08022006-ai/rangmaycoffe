-- Granular Price-Edit Permission (`can_edit_price`) controlled by Store Owner (`admin`)

alter table public.profiles
  add column if not exists can_edit_price boolean not null default false;

update public.profiles
set can_edit_price = true
where role = 'admin';

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
    if new.role is distinct from old.role
      or new.is_active is distinct from old.is_active
      or new.can_edit_price is distinct from old.can_edit_price then
      raise exception 'Unauthorized profile privilege update';
    end if;
  end if;
  if new.role = 'admin' then
    new.can_edit_price := true;
  elsif new.role <> 'manager' then
    new.can_edit_price := false;
  end if;
  return new;
end;
$$;
