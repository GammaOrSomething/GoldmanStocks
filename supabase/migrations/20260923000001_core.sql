-- Production baseline, part 1 of 4: schemas, types, tables and the "who am I" helpers.
--
-- Replaces the demo schema (kept for reference in supabase/legacy-demo/). This builds a fresh
-- project; it is not meant to run on the demo database.
--
-- Shape of every tenant table:
--   * `id uuid` primary key.
--   * `company_id uuid not null default private.company_id()`: inserts from the app never pass
--     it; it's the caller's company. Row-level security (part 3) then only ever shows or accepts
--     rows of that company.
--   * `unique (id, company_id)`, so child tables can use composite foreign keys
--     `(parent_id, company_id)`. A row can therefore never point at another company's row, even
--     if someone guesses its id.

-- ─── Schemas ─────────────────────────────────────────────────────────────────
-- `private` holds helpers that the API (PostgREST) never exposes.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Postgres lets everyone execute a new function unless told otherwise, and only this global
-- default (not a per-schema one) can change that. From here on, functions are executable only
-- by the roles they are granted to: in `public`, Supabase's own defaults grant them to the API
-- roles (anon is taken off again in part 3); in `private`, nobody but explicit grants.
alter default privileges revoke execute on functions from public;

-- ─── Types ───────────────────────────────────────────────────────────────────
-- Values match the strings the app already uses, so mapping stays a plain cast.
create type public.app_role as enum ('boss', 'worker');
create type public.worker_language as enum ('ET', 'LV', 'EN');
create type public.health_status as enum ('healthy', 'attention', 'critical');
create type public.client_health as enum ('good', 'watch', 'at risk');
create type public.plant_kind as enum ('Tree', 'Hedge', 'Lawn', 'Flower bed', 'Shrub');
create type public.task_kind as enum (
  'Watering', 'Clipping', 'Mowing', 'Planting', 'Inspection', 'Feeding'
);
create type public.task_status as enum ('planned', 'done', 'skipped');
create type public.offer_status as enum ('draft', 'approved', 'dismissed');

-- True for the server (service role) and for direct database sessions (migrations, the
-- dashboard), whose `role` setting is 'none'. False for anyone reaching the database through
-- the API as a user. Read from the session's role rather than the login token, so a token that
-- is missing its role claim is treated as a user, not waved through.
create function private.is_trusted_caller() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(current_setting('role', true), 'none') in ('service_role', 'none')
$$;

-- Keeps `updated_at` current on every table that has one.
create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ─── Companies and people ────────────────────────────────────────────────────

create table public.companies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 200),
  -- Local clock for "today", reports and plan weeks; checked by private.check_timezone().
  timezone   text not null default 'Europe/Tallinn' check (length(timezone) <= 64),
  -- Last plant code handed out (PL-0001, PL-0002, …); see private.assign_plant_code().
  plant_seq  integer not null default 0 check (plant_seq >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every person who uses the app is a worker row; the boss is usually the head gardener.
-- `user_id` links the row to a login. It's null until the person has an account.
create table public.workers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  user_id     uuid unique references auth.users (id) on delete set null,
  email       text check (email is null or (length(email) <= 320 and email ~ '^[^@\s]+@[^@\s]+$')),
  name        text not null check (length(btrim(name)) between 1 and 200),
  -- shown in the UI, e.g. 'Head gardener', 'Seasonal'
  job_title   text not null default '' check (length(job_title) <= 100),
  app_role    public.app_role not null default 'worker',
  language    public.worker_language not null default 'EN',
  color       text not null default '' check (length(color) <= 32),
  invited_at  timestamptz,
  -- Workers are archived, never deleted: finished jobs keep pointing at who did them.
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, company_id)
);
create index workers_company_id_idx on public.workers (company_id);
create unique index workers_company_email_key
  on public.workers (company_id, lower(email)) where email is not null;

-- ─── "Who am I" helpers ──────────────────────────────────────────────────────
-- Read from `workers` on every call rather than from the login token, so a role change or
-- removed access takes effect on the very next request. `security definer` lets them read
-- `workers` without going through its own row-level security (which would recurse).
-- In policies, always call them as `(select private.company_id())`: Postgres then evaluates
-- them once per query instead of once per row.

create function private.company_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select w.company_id from public.workers w
  where w.user_id = auth.uid() and w.archived_at is null
$$;

create function private.worker_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select w.id from public.workers w
  where w.user_id = auth.uid() and w.archived_at is null
$$;

create function private.is_boss() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select w.app_role = 'boss' from public.workers w
     where w.user_id = auth.uid() and w.archived_at is null),
    false
  )
$$;

revoke all on function private.company_id() from public;
revoke all on function private.worker_id() from public;
revoke all on function private.is_boss() from public;
grant execute on function private.company_id() to authenticated, service_role;
grant execute on function private.worker_id() to authenticated, service_role;
grant execute on function private.is_boss() to authenticated, service_role;

alter table public.workers alter column company_id set default private.company_id();

-- ─── Clients and sites ───────────────────────────────────────────────────────

create table public.clients (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.company_id()
             references public.companies (id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 200),
  city       text not null default '' check (length(city) <= 200),
  contact    text not null default '' check (length(contact) <= 1000),
  health     public.client_health not null default 'good',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id)
);
create index clients_company_id_idx on public.clients (company_id);

-- Money lives apart from the client so workers can read clients but never see what they pay.
create table public.client_terms (
  client_id      uuid primary key,
  company_id     uuid not null default private.company_id(),
  monthly_value  numeric(12, 2) not null default 0 check (monthly_value >= 0),
  contract_until date,
  updated_at     timestamptz not null default now(),
  foreign key (client_id, company_id)
    references public.clients (id, company_id) on delete cascade
);
create index client_terms_company_id_idx on public.client_terms (company_id);

-- A work site. Called "project" in the code and "site" in the UI.
create table public.projects (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null default private.company_id(),
  client_id        uuid not null,
  name             text not null check (length(btrim(name)) between 1 and 200),
  city             text not null default '' check (length(city) <= 200),
  address          text not null default '' check (length(address) <= 500),
  lat              double precision not null check (lat between -90 and 90),
  lng              double precision not null check (lng between -180 and 180),
  zones            text[] not null default '{}'
                   check (cardinality(zones) <= 100 and length(array_to_string(zones, '')) <= 10000),
  visits_per_month integer not null default 0 check (visits_per_month >= 0),
  status           public.health_status not null default 'healthy',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, company_id),
  foreign key (client_id, company_id)
    references public.clients (id, company_id) on delete cascade
);
create index projects_company_id_idx on public.projects (company_id);
create index projects_client_id_idx on public.projects (client_id);

create table public.project_terms (
  project_id     uuid primary key,
  company_id     uuid not null default private.company_id(),
  monthly_value  numeric(12, 2) not null default 0 check (monthly_value >= 0),
  contract_until date,
  updated_at     timestamptz not null default now(),
  foreign key (project_id, company_id)
    references public.projects (id, company_id) on delete cascade
);
create index project_terms_company_id_idx on public.project_terms (company_id);

-- Who works at which site; replaces the demo's `worker_ids text[]` and `lead_worker_id`.
create table public.project_workers (
  project_id uuid not null,
  worker_id  uuid not null,
  company_id uuid not null default private.company_id(),
  is_lead    boolean not null default false,
  primary key (project_id, worker_id),
  foreign key (project_id, company_id)
    references public.projects (id, company_id) on delete cascade,
  foreign key (worker_id, company_id)
    references public.workers (id, company_id) on delete cascade
);
create unique index project_workers_one_lead
  on public.project_workers (project_id) where is_lead;
create index project_workers_worker_id_idx on public.project_workers (worker_id);
create index project_workers_company_id_idx on public.project_workers (company_id);

-- ─── Plants ──────────────────────────────────────────────────────────────────

create table public.plants (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.company_id(),
  -- Readable, per company: PL-0001, PL-0002, … Set on insert, never changed.
  code       text not null,
  project_id uuid not null,
  species    text not null default '' check (length(species) <= 200),
  common     text not null check (length(btrim(common)) between 1 and 200),
  kind       public.plant_kind not null,
  -- area within the site, e.g. 'North courtyard'
  zone       text not null default '' check (length(zone) <= 200),
  status     public.health_status not null default 'healthy',
  last_care  date,
  next_care  date,
  next_task  text check (length(next_task) <= 200),
  -- Position on the site plan in percent; lat/lng when registered with GPS.
  x          numeric(6, 3) not null default 50 check (x between 0 and 100),
  y          numeric(6, 3) not null default 50 check (y between 0 and 100),
  lat        double precision check (lat between -90 and 90),
  lng        double precision check (lng between -180 and 180),
  photo_path text,  -- object in the task-photos bucket, under <company_id>/plants/
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id),
  unique (company_id, code),
  -- A plain file name, so a path can't climb out of the folder with '..'.
  check (
    photo_path is null
    or photo_path ~ ('^' || company_id::text || '/plants/[A-Za-z0-9_-]+\.(jpe?g|png|webp|heic)$')
  ),
  foreign key (project_id, company_id)
    references public.projects (id, company_id) on delete cascade
);
create index plants_project_id_idx on public.plants (project_id);

-- ─── Work ────────────────────────────────────────────────────────────────────

-- A task without `date` is a weekly template that repeats on `day`; with `date` it's a one-off.
create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null default private.company_id(),
  title        text not null check (length(btrim(title)) between 1 and 200),
  project_id   uuid not null,
  zone         text not null default '' check (length(zone) <= 200),
  plant_id     uuid,
  worker_id    uuid not null,
  day          smallint not null check (day between 0 and 6),  -- 0 = Monday
  date         date,
  start        smallint not null check (start between 0 and 23),  -- hour, 24h
  duration     numeric(4, 2) not null check (duration > 0 and duration <= 24),  -- hours
  kind         public.task_kind not null,
  weather_note text check (length(weather_note) <= 1000),
  status       public.task_status not null default 'planned',
  approved_at  timestamptz,  -- when the boss approved the day's plan
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, company_id),
  foreign key (project_id, company_id)
    references public.projects (id, company_id) on delete cascade,
  foreign key (plant_id, company_id)
    references public.plants (id, company_id) on delete set null (plant_id),
  foreign key (worker_id, company_id)
    references public.workers (id, company_id) on delete restrict
);
create index tasks_company_day_idx on public.tasks (company_id, day);
create index tasks_project_id_idx on public.tasks (project_id);
create index tasks_worker_id_idx on public.tasks (worker_id);
create index tasks_plant_id_idx on public.tasks (plant_id);
create index tasks_date_idx on public.tasks (date);

create table public.care_events (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.company_id(),
  plant_id   uuid not null,
  task_id    uuid,
  worker_id  uuid,
  date       date not null,
  action     text not null check (length(action) <= 200),
  done       boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (plant_id, company_id)
    references public.plants (id, company_id) on delete cascade,
  foreign key (task_id, company_id)
    references public.tasks (id, company_id) on delete set null (task_id),
  foreign key (worker_id, company_id)
    references public.workers (id, company_id) on delete set null (worker_id)
);
create index care_events_plant_id_idx on public.care_events (plant_id);
create index care_events_task_id_idx on public.care_events (task_id);
create index care_events_company_id_idx on public.care_events (company_id);

-- Photo proof of finished work. The object lives in the private `task-photos` bucket under
-- `<company_id>/tasks/<task_id>/`, and the check below keeps the row and the file together.
create table public.task_photos (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null default private.company_id(),
  task_id      uuid not null,
  storage_path text not null unique,
  taken_at     timestamptz not null,
  lat          double precision check (lat between -90 and 90),
  lng          double precision check (lng between -180 and 180),
  created_at   timestamptz not null default now(),
  check (
    storage_path
      ~ ('^' || company_id::text || '/tasks/' || task_id::text || '/[A-Za-z0-9_-]+\.(jpe?g|png|webp|heic)$')
  ),
  foreign key (task_id, company_id)
    references public.tasks (id, company_id) on delete cascade
);
create index task_photos_task_id_idx on public.task_photos (task_id);
create index task_photos_company_taken_idx on public.task_photos (company_id, taken_at);

-- Repeat-work offers drafted by the AI. Nothing is ever sent without the boss approving it.
create table public.offers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null default private.company_id(),
  client_id   uuid not null,
  project_id  uuid not null,
  what        text not null check (length(what) <= 200),
  value       numeric(12, 2) not null check (value >= 0),
  due_date    date not null,
  subject     text not null check (length(subject) <= 200),
  body        text not null check (length(body) <= 20000),
  status      public.offer_status not null default 'draft',
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (client_id, company_id)
    references public.clients (id, company_id) on delete cascade,
  foreign key (project_id, company_id)
    references public.projects (id, company_id) on delete cascade
);
create index offers_company_status_idx on public.offers (company_id, status);
create index offers_client_id_idx on public.offers (client_id);
create index offers_project_id_idx on public.offers (project_id);

-- ─── Shared and bookkeeping tables ───────────────────────────────────────────

-- Forecasts are the same for everyone at a place, so this cache is global, not per company.
-- Only the server (service role) reads and writes it; see part 3.
create table public.weather_cache (
  key        text primary key,  -- 'lat,lng' rounded to 2 dp
  fetched_at timestamptz not null default now(),
  payload    jsonb not null
);

-- The metered features and how many uses a company gets per day. Kept in the database so no
-- caller can pick their own limit; bump_usage() refuses any kind not listed here.
create table private.usage_limits (
  kind        text primary key,
  daily_limit integer not null check (daily_limit >= 0)
);
insert into private.usage_limits (kind, daily_limit) values
  ('ai_plan', 50),      -- AI week planning
  ('ai_outreach', 50);  -- AI repeat-work offers

-- Daily call counts, to cap how much each company can spend on the AI features.
create table public.usage_counters (
  company_id uuid not null references public.companies (id) on delete cascade,
  kind       text not null references private.usage_limits (kind) on update cascade,
  day        date not null,
  count      integer not null default 0 check (count >= 0),
  primary key (company_id, kind, day)
);

-- ─── Triggers ────────────────────────────────────────────────────────────────

-- A bad time zone name would break every date the app works out for the company.
create function private.check_timezone() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'unknown time zone: %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger check_timezone before insert or update of timezone on public.companies
for each row execute function private.check_timezone();

do $$
declare t text;
begin
  foreach t in array array[
    'companies', 'workers', 'clients', 'client_terms', 'projects', 'project_terms',
    'plants', 'tasks', 'offers'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I
       for each row execute function private.set_updated_at()', t
    );
  end loop;
end $$;
