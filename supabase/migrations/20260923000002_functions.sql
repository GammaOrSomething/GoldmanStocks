-- Production baseline, part 2 of 4: triggers and the functions the app calls (RPCs).
--
-- Workers get no direct write access to tasks, photos or their own worker row (see part 3).
-- The few things they may change go through the functions here, each checking exactly one
-- permission. A broad UPDATE policy would let a worker rewrite any column from the browser,
-- because the browser holds the public key and the user's session.

-- ─── Triggers ────────────────────────────────────────────────────────────────

-- Plant codes: PL-0001, PL-0002, … per company. The counter lives on the company row, and the
-- UPDATE locks that row, so two plants added at the same moment can't get the same code.
-- This runs before row-level security checks the new row, so it checks the company itself
-- first: otherwise another company's row would be locked, and the error would reveal whether
-- that company exists.
create function private.assign_plant_code() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not private.is_trusted_caller()
     and new.company_id is distinct from private.company_id() then
    raise exception 'new row violates row-level security policy for table "plants"'
      using errcode = '42501';
  end if;
  update public.companies set plant_seq = plant_seq + 1
  where id = new.company_id
  returning plant_seq into n;
  if n is null then
    raise exception 'unknown company' using errcode = '23503';
  end if;
  new.code := 'PL-' || case when n < 10000 then lpad(n::text, 4, '0') else n::text end;
  return new;
end;
$$;

create trigger assign_plant_code before insert on public.plants
for each row execute function private.assign_plant_code();

-- Once handed out, a plant's code is its label in the field; it never changes.
create function private.keep_plant_code() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.code := old.code;
  return new;
end;
$$;

create trigger keep_plant_code before update on public.plants
for each row execute function private.keep_plant_code();

-- Rules for worker rows that row-level security can't express:
--   * Users can't link or unlink a login (`user_id`), move a worker to another company, or
--     change the email of someone who already has an account. Invites and removed access run
--     on the server with the service role, which this doesn't restrict.
--   * A company always keeps at least one active boss.
create function private.guard_worker_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_trusted_caller() then
    if new.user_id is distinct from old.user_id then
      raise exception 'a login can only be linked by invitation' using errcode = '42501';
    end if;
    if new.company_id <> old.company_id then
      raise exception 'workers cannot move between companies' using errcode = '42501';
    end if;
    if old.user_id is not null and new.email is distinct from old.email then
      raise exception 'this worker has an account; their email is their login'
        using errcode = '42501';
    end if;
  end if;

  if old.app_role = 'boss' and old.archived_at is null
     and (new.app_role <> 'boss' or new.archived_at is not null) then
    -- Lock the company so two bosses can't demote each other at the same moment.
    perform 1 from public.companies where id = old.company_id for update;
    if not exists (
      select 1 from public.workers w
      where w.company_id = old.company_id and w.id <> old.id
        and w.app_role = 'boss' and w.archived_at is null
    ) then
      raise exception 'a company needs at least one boss' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger guard_worker_update before update on public.workers
for each row execute function private.guard_worker_update();

-- ─── Signup ──────────────────────────────────────────────────────────────────

-- Called once after signing up: creates the company and makes the caller its boss.
-- Reads the caller's id and email from their login, never from anything they send, and refuses
-- if the login already belongs to a company.
create function public.create_company(company_name text, full_name text) returns uuid
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

  insert into public.workers (company_id, user_id, email, name, job_title, app_role)
  values (new_company, me, auth.jwt() ->> 'email', btrim(full_name), 'Owner', 'boss');

  return new_company;
end;
$$;

-- ─── Worker actions ──────────────────────────────────────────────────────────

-- Finish a task with photo proof, in one transaction: record the photo, mark the task done,
-- and add the work to the plant's history. Allowed for the worker the task is assigned to, or
-- a boss. The photo must already be uploaded, into this task's folder of this company.
--
-- Proven photos are what client_stats counts as hours worked, so the times sent in are held
-- to the company's "today" (±1 day, for a phone that was offline or near midnight), a weekly
-- task gets at most one proof per week, and a finished one-off task can't be finished again.
-- The weekly proof isn't tied to the task's weekday, so a job done a day late still counts.
create function public.complete_task(
  p_task_id uuid,
  p_photo_path text,
  p_taken_at timestamptz,
  p_lat double precision,
  p_lng double precision,
  p_local_date date
) returns public.task_photos
language plpgsql security definer set search_path = '' as $$
declare
  my_company uuid := private.company_id();
  zone text;
  today date;
  photo_day date;
  t public.tasks;
  photo public.task_photos;
begin
  if my_company is null then
    raise exception 'not a member of a company' using errcode = '42501';
  end if;

  select * into t from public.tasks
  where id = p_task_id and company_id = my_company
  for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  if not private.is_boss() and t.worker_id is distinct from private.worker_id() then
    raise exception 'this task is assigned to someone else' using errcode = '42501';
  end if;

  if p_photo_path is null
     or p_photo_path !~ ('^' || my_company::text || '/tasks/' || p_task_id::text
                         || '/[A-Za-z0-9_-]+\.(jpe?g|png|webp|heic)$') then
    raise exception 'that photo was not uploaded for this task' using errcode = '22023';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'task-photos' and o.name = p_photo_path
  ) then
    raise exception 'photo not found, upload it first' using errcode = 'P0002';
  end if;

  -- A retried request (same photo) is not an error, and changes nothing the second time.
  select * into photo from public.task_photos where storage_path = p_photo_path;
  if found then
    return photo;
  end if;

  select c.timezone into zone from public.companies c where c.id = my_company;
  today := (now() at time zone zone)::date;
  photo_day := (p_taken_at at time zone zone)::date;
  if p_taken_at is null or p_taken_at > now() + interval '5 minutes' or photo_day < today - 1 then
    raise exception 'the photo must have been taken today' using errcode = '22023';
  end if;
  if p_local_date is null or p_local_date not between today - 1 and today + 1 then
    raise exception 'the work date must be today' using errcode = '22023';
  end if;
  if t.date is not null and t.status = 'done' then
    raise exception 'this task is already done' using errcode = '23505';
  end if;
  if t.date is null and exists (
    select 1 from public.task_photos tp
    where tp.task_id = p_task_id
      and date_trunc('week', (tp.taken_at at time zone zone)::date)
          = date_trunc('week', photo_day)
  ) then
    raise exception 'this weekly task already has photo proof for that week'
      using errcode = '23505';
  end if;

  insert into public.task_photos (company_id, task_id, storage_path, taken_at, lat, lng)
  values (my_company, p_task_id, p_photo_path, p_taken_at, p_lat, p_lng)
  returning * into photo;

  update public.tasks set status = 'done' where id = p_task_id;

  if t.plant_id is not null then
    insert into public.care_events (company_id, plant_id, task_id, worker_id, date, action, done)
    values (my_company, t.plant_id, p_task_id, t.worker_id, p_local_date, t.title, true);
    update public.plants
    set last_care = greatest(coalesce(last_care, p_local_date), p_local_date)
    where id = t.plant_id;
  end if;

  return photo;
end;
$$;

-- Skip a job, or put it back to planned. "Done" only comes from complete_task, with a photo.
-- Only a boss can take a finished one-off task back out of "done": complete_task refuses to
-- finish it twice, and reopening it would get round that. A weekly task's status carries over
-- from week to week, so its worker may still change it; its proof is limited per week instead.
create function public.set_task_status(p_task_id uuid, p_status public.task_status)
returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  if p_status = 'done' then
    raise exception 'finish a task with a photo instead' using errcode = '22023';
  end if;
  select * into t from public.tasks
  where id = p_task_id and company_id = private.company_id();
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  if not private.is_boss() then
    if t.worker_id is distinct from private.worker_id() then
      raise exception 'this task is assigned to someone else' using errcode = '42501';
    end if;
    if t.status = 'done' and t.date is not null then
      raise exception 'only a boss can reopen a finished task' using errcode = '42501';
    end if;
  end if;
  update public.tasks set status = p_status where id = p_task_id;
end;
$$;

-- The one thing workers change about themselves: the language they speak.
create function public.update_my_profile(p_language public.worker_language) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.workers set language = p_language
  where user_id = auth.uid() and archived_at is null;
  if not found then
    raise exception 'not a member of a company' using errcode = '42501';
  end if;
end;
$$;

-- ─── Boss actions ────────────────────────────────────────────────────────────

-- Replace a site's crew in one go. Runs with the caller's own rights, so the boss-only rules
-- on project_workers apply; the lead, if there is one, is always part of the crew.
create function public.set_project_crew(
  p_project_id uuid,
  p_worker_ids uuid[],
  p_lead_id uuid
) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if not private.is_boss() then
    raise exception 'only a boss can change a crew' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'site not found' using errcode = 'P0002';
  end if;
  if cardinality(p_worker_ids) > 100 then
    raise exception 'a crew has at most 100 people' using errcode = '22023';
  end if;
  delete from public.project_workers where project_id = p_project_id;
  insert into public.project_workers (project_id, worker_id, is_lead)
  select p_project_id, w, coalesce(w = p_lead_id, false)
  from (
    select distinct unnest(coalesce(p_worker_ids, '{}') || p_lead_id) as w
  ) crew
  where w is not null;
end;
$$;

-- Count one use of a metered feature (e.g. an AI call) for the caller's company today.
-- Returns false once today's count is over that feature's limit in private.usage_limits.
-- Every metered feature is boss-only today, so a worker can't use up the company's allowance.
create function public.bump_usage(p_kind text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  my_company uuid := private.company_id();
  daily_limit integer;
  n integer;
begin
  if my_company is null or not private.is_boss() then
    raise exception 'only a boss can use this feature' using errcode = '42501';
  end if;
  select l.daily_limit into daily_limit from private.usage_limits l where l.kind = p_kind;
  if not found then
    raise exception 'unknown feature: %', p_kind using errcode = '22023';
  end if;
  insert into public.usage_counters (company_id, kind, day, count)
  values (my_company, p_kind, current_date, 1)
  on conflict (company_id, kind, day)
    do update set count = public.usage_counters.count + 1
  returning count into n;
  return n <= daily_limit;
end;
$$;

-- Per-client counts for the clients page, worked out in the database so no row limit can cut
-- them short. Hours are the durations of tasks proven with a photo in [p_from, p_to), counted
-- once per task per local day (the company's time zone). Runs with the caller's rights.
create function public.client_stats(p_from timestamptz, p_to timestamptz)
returns table (client_id uuid, sites integer, plants integer, hours numeric)
language sql stable security invoker set search_path = '' as $$
  with tz as (
    select coalesce(
      (select c.timezone from public.companies c where c.id = private.company_id()),
      'UTC'
    ) as zone
  ),
  visits as (
    select distinct p.client_id, tp.task_id, (tp.taken_at at time zone tz.zone)::date, t.duration
    from public.task_photos tp
    join public.tasks t on t.id = tp.task_id
    join public.projects p on p.id = t.project_id
    cross join tz
    where tp.taken_at >= p_from and tp.taken_at < p_to
  )
  select
    c.id,
    (select count(*) from public.projects p where p.client_id = c.id)::integer,
    (select count(*) from public.plants pl
       join public.projects p on p.id = pl.project_id
     where p.client_id = c.id)::integer,
    coalesce((select sum(v.duration) from visits v where v.client_id = c.id), 0)
  from public.clients c
$$;

-- ─── Who may call what ───────────────────────────────────────────────────────
-- Functions are executable by everyone by default; these are for signed-in users only.

do $$
declare f text;
begin
  foreach f in array array[
    'public.create_company(text, text)',
    'public.complete_task(uuid, text, timestamptz, double precision, double precision, date)',
    'public.set_task_status(uuid, public.task_status)',
    'public.update_my_profile(public.worker_language)',
    'public.set_project_crew(uuid, uuid[], uuid)',
    'public.bump_usage(text)',
    'public.client_stats(timestamptz, timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
