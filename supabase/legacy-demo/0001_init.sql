-- 0001_init.sql — Rootline initial schema (step 0 of docs/backend-tasks.md).
--
-- This file + src/lib/types.ts are the contract between track A and track B.
-- Column names mirror the TypeScript types (snake_case here, camelCase there).
-- Changing a column after step 0 means telling the other track first.
--
-- Ids are text so the mock data in src/lib/rootline-data.ts seeds as-is ("p1", "PL-0142", "t1").
-- Tables that only the backend creates rows for (photos, offers, care events) use uuids.

-- ─── Core entities ───────────────────────────────────────────────────────────

create table companies (
  id         text primary key,
  name       text not null,
  created_at timestamptz not null default now()
);

create table workers (
  id         text primary key,
  company_id text not null references companies (id) on delete cascade,
  name       text not null,
  role       text not null,  -- job title shown in the UI, e.g. 'Head gardener', 'Seasonal'
  language   text not null,  -- 'ET' | 'LV' | 'EN'
  color      text not null,
  -- auth (track A, A5)
  app_role   text not null default 'worker' check (app_role in ('boss', 'worker')),
  user_id    uuid unique references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table clients (
  id               text primary key,
  company_id       text not null references companies (id) on delete cascade,
  name             text not null,
  city             text not null,
  sites            int not null default 0,
  plants           int not null default 0,
  contact          text not null,
  hours_this_month numeric not null default 0,
  monthly_value    numeric not null default 0,
  contract_until   date,
  health           text not null default 'good' check (health in ('good', 'watch', 'at risk')),
  created_at       timestamptz not null default now()
);

create table projects (
  id               text primary key,
  client_id        text not null references clients (id) on delete cascade,
  name             text not null,
  city             text not null,
  address          text not null,
  lat              double precision not null,  -- weather lookup + route ordering between sites
  lng              double precision not null,
  zones            text[] not null default '{}',
  lead_worker_id   text references workers (id) on delete set null,
  worker_ids       text[] not null default '{}',
  visits_per_month int not null default 0,
  monthly_value    numeric not null default 0,
  contract_until   date,
  status           text not null default 'healthy' check (status in ('healthy', 'attention', 'critical')),
  created_at       timestamptz not null default now()
);

create table plants (
  id         text primary key,
  project_id text not null references projects (id) on delete cascade,
  species    text not null,
  common     text not null,
  kind       text not null check (kind in ('Tree', 'Hedge', 'Lawn', 'Flower bed', 'Shrub')),
  site       text not null,  -- zone within the project, e.g. 'North courtyard'
  status     text not null default 'healthy' check (status in ('healthy', 'attention', 'critical')),
  last_care  date,
  next_care  date,
  next_task  text,
  x          numeric not null check (x between 0 and 100),  -- % of the site plan (PlantMap)
  y          numeric not null check (y between 0 and 100),
  created_at timestamptz not null default now()
);

create table tasks (
  id           text primary key,
  title        text not null,
  project_id   text not null references projects (id) on delete cascade,
  site         text not null,
  plant_id     text references plants (id) on delete set null,  -- location within the site for the planner
  worker_id    text not null references workers (id),
  day          smallint not null check (day between 0 and 6),  -- 0 = Monday
  start        smallint not null check (start between 0 and 23),  -- hour, 24h
  duration     numeric not null check (duration > 0),  -- hours
  kind         text not null check (kind in ('Watering', 'Clipping', 'Mowing', 'Planting', 'Inspection', 'Feeding')),
  weather_note text,  -- e.g. 'Skipped — 9 mm rain overnight'
  status       text not null default 'planned' check (status in ('planned', 'done', 'skipped')),
  approved_at  timestamptz,  -- set when the boss approves the day's plan
  created_at   timestamptz not null default now()
);

create table care_events (
  id         uuid primary key default gen_random_uuid(),
  plant_id   text not null references plants (id) on delete cascade,
  task_id    text references tasks (id) on delete set null,
  worker_id  text references workers (id) on delete set null,
  date       date not null,
  action     text not null,
  done       boolean not null default false,
  created_at timestamptz not null default now()
);

-- ─── Track B: photo proof, weather, outreach ─────────────────────────────────

create table task_photos (
  id           uuid primary key default gen_random_uuid(),
  task_id      text not null references tasks (id) on delete cascade,
  storage_path text not null unique,  -- object path in the task-photos bucket
  taken_at     timestamptz not null,
  lat          double precision,
  lng          double precision,
  created_at   timestamptz not null default now()
);

create table weather_cache (
  key        text primary key,  -- 'lat,lng' rounded to 2 dp
  fetched_at timestamptz not null default now(),
  payload    jsonb not null  -- raw Open-Meteo response
);

create table offers (
  id          uuid primary key default gen_random_uuid(),
  client_id   text not null references clients (id) on delete cascade,
  project_id  text not null references projects (id) on delete cascade,
  what        text not null,
  value       numeric not null,
  due_date    date not null,
  subject     text not null,
  body        text not null,
  -- drafted by the LLM; nothing is ever sent without the boss approving it
  status      text not null default 'draft' check (status in ('draft', 'approved', 'dismissed')),
  created_at  timestamptz not null default now(),
  approved_at timestamptz
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

create index plants_project_id_idx on plants (project_id);
create index tasks_project_id_idx on tasks (project_id);
create index tasks_worker_day_idx on tasks (worker_id, day);
create index care_events_plant_id_idx on care_events (plant_id);
create index task_photos_task_id_idx on task_photos (task_id);
create index offers_client_status_idx on offers (client_id, status);

-- ─── Row level security ──────────────────────────────────────────────────────
-- On everywhere, no policies yet: the anon key can read nothing. Server functions use the
-- service-role client, which bypasses RLS. Track A adds policies with auth (A5) if the
-- browser client needs direct access.

alter table companies enable row level security;
alter table workers enable row level security;
alter table clients enable row level security;
alter table projects enable row level security;
alter table plants enable row level security;
alter table tasks enable row level security;
alter table care_events enable row level security;
alter table task_photos enable row level security;
alter table weather_cache enable row level security;
alter table offers enable row level security;

-- ─── Storage ─────────────────────────────────────────────────────────────────
-- Private bucket for task completion photos; uploads go through signed upload URLs (B5).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-photos',
  'task-photos',
  false,
  10485760,  -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;
