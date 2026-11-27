-- Allow users to register with any Gmail / email address and sign in immediately
-- without being blocked by Supabase free-tier SMTP confirmation limits.

update auth.users
set
  email_confirmed_at = coalesce(email_confirmed_at, now()),
  updated_at = now()
where email_confirmed_at is null;
