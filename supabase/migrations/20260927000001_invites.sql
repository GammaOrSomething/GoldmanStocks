-- Worker invitations (D2).
--
-- The invitation itself runs on the server with the service role: it sends Supabase's invite
-- email and links the new login to the worker row, which guard_worker_update allows only the
-- server to do. This migration adds what the boss's own session needs around it.

-- Invitations send email from our domain to any address the boss types, so they are metered
-- like the AI features. A resend counts too.
insert into private.usage_limits (kind, daily_limit) values ('invite', 20);

-- Which of the company's workers have a login, and whether it has been confirmed. Opening the
-- invite link confirms the email, so a linked but unconfirmed login is an invitation not yet
-- accepted. Boss-only; `auth.users` is out of everyone else's reach, hence security definer.
create function public.worker_logins()
returns table (worker_id uuid, confirmed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select w.id, u.email_confirmed_at
  from public.workers w
  join auth.users u on u.id = w.user_id
  where w.company_id = private.company_id()
    and private.is_boss()
$$;

revoke all on function public.worker_logins() from public, anon;
grant execute on function public.worker_logins() to authenticated, service_role;
