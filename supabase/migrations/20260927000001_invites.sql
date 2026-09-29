-- Worker invitations (D2).
--
-- The invitation itself runs on the server with the service role: it sends Supabase's invite
-- email and links the new login to the worker row, which only the server may do.
--
-- Being invited is not agreeing to join. A linked login counts as a member only once it has
-- accepted (`accepted_at`), which again only the server records, after checking that the
-- session is the invited login. Until then it sees nothing of the company. Without this, any
-- boss could invite a stranger's address, and the stranger would land in that company the
-- first time they signed up or reset a password.

alter table public.workers add column accepted_at timestamptz;

-- Addresses are compared in lowercase everywhere (Supabase lowercases logins), so they are
-- stored that way.
alter table public.workers add constraint workers_email_normalised
  check (email is null or email = lower(btrim(email)));

-- ─── Membership counts only once accepted ────────────────────────────────────
-- Every policy and storage rule goes through these three.

create or replace function private.company_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select w.company_id from public.workers w
  where w.user_id = auth.uid() and w.archived_at is null and w.accepted_at is not null
$$;

create or replace function private.worker_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select w.id from public.workers w
  where w.user_id = auth.uid() and w.archived_at is null and w.accepted_at is not null
$$;

create or replace function private.is_boss() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select w.app_role = 'boss' from public.workers w
     where w.user_id = auth.uid() and w.archived_at is null and w.accepted_at is not null),
    false
  )
$$;

-- The same rules as before, plus: only the server records an acceptance, and a boss who hasn't
-- accepted doesn't count toward keeping one.
create or replace function private.guard_worker_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_trusted_caller() then
    if new.user_id is distinct from old.user_id then
      raise exception 'a login can only be linked by invitation' using errcode = '42501';
    end if;
    if new.accepted_at is distinct from old.accepted_at then
      raise exception 'only the invited person can accept an invitation' using errcode = '42501';
    end if;
    if new.company_id <> old.company_id then
      raise exception 'workers cannot move between companies' using errcode = '42501';
    end if;
    if old.user_id is not null and new.email is distinct from old.email then
      raise exception 'this worker has an account; their email is their login'
        using errcode = '42501';
    end if;
  end if;

  if old.app_role = 'boss' and old.archived_at is null and old.accepted_at is not null
     and (new.app_role <> 'boss' or new.archived_at is not null or new.accepted_at is null) then
    -- Lock the company so two bosses can't demote each other at the same moment.
    perform 1 from public.companies where id = old.company_id for update;
    if not exists (
      select 1 from public.workers w
      where w.company_id = old.company_id and w.id <> old.id
        and w.app_role = 'boss' and w.archived_at is null and w.accepted_at is not null
    ) then
      raise exception 'a company needs at least one boss' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

-- As before, and the person creating the company has joined it.
create or replace function public.create_company(company_name text, full_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  new_company uuid;
begin
  if me is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  if length(btrim(coalesce(company_name, ''))) not between 1 and 200
     or length(btrim(coalesce(full_name, ''))) not between 1 and 200 then
    raise exception 'company name and your name are required' using errcode = '22023';
  end if;
  if exists (select 1 from public.workers where user_id = me) then
    raise exception 'this account already belongs to a company' using errcode = '23505';
  end if;

  insert into public.companies (name, created_by)
  values (btrim(company_name), me)
  returning id into new_company;

  insert into public.workers (company_id, user_id, email, name, job_title, app_role, accepted_at)
  values (
    new_company, me, lower(btrim(auth.jwt() ->> 'email')), btrim(full_name), 'Owner', 'boss',
    now()
  );

  return new_company;
end;
$$;

-- A worker changes the language they speak; members only.
create or replace function public.update_my_profile(p_language public.worker_language)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.workers set language = p_language where id = private.worker_id();
  if not found then
    raise exception 'not a member of a company' using errcode = '42501';
  end if;
end;
$$;

-- ─── Invitations ─────────────────────────────────────────────────────────────

-- The caller's invitation that is waiting for an answer, if any: which worker row and which
-- company. The /join page shows it. Security definer, because a login that hasn't accepted
-- can't read the company through row-level security.
create function public.my_invitation()
returns table (worker_id uuid, company_name text)
language sql stable security definer set search_path = '' as $$
  select w.id, c.name
  from public.workers w
  join public.companies c on c.id = w.company_id
  where w.user_id = auth.uid() and w.archived_at is null and w.accepted_at is null
$$;

-- The login that holds an address, for the server deciding whether it may invite it: an
-- address that is confirmed, or linked to any company, is taken; an unconfirmed, unlinked one
-- is a signup nobody finished, which the server deletes before inviting, so that no password
-- chosen by whoever started it survives. Server only: it would tell anyone else which
-- addresses have accounts.
create function public.login_for_email(p_email text)
returns table (user_id uuid, confirmed boolean, linked boolean)
language sql stable security definer set search_path = '' as $$
  select
    u.id,
    u.email_confirmed_at is not null,
    exists (select 1 from public.workers w where w.user_id = u.id)
  from auth.users u
  where lower(u.email) = lower(btrim(p_email))
$$;

-- Invitations send email from our domain to any address the boss types, so they are metered
-- like the AI features. A resend counts too.
insert into private.usage_limits (kind, daily_limit) values ('invite', 20);

revoke all on function public.my_invitation() from public, anon;
grant execute on function public.my_invitation() to authenticated, service_role;
revoke all on function public.login_for_email(text) from public, anon, authenticated;
grant execute on function public.login_for_email(text) to service_role;
