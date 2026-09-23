-- Security tests for the production schema: company isolation, boss vs worker, and the
-- functions workers use. Run with supabase/tests/run.sh (see supabase/README.md).
--
-- Everything runs in one transaction that is rolled back, so it leaves no trace and can run
-- against a local Supabase that has other data. Any failed check stops the run with "FAIL: …".
--
-- Acting as someone: `reset role; select tests.login(<user>); set local role authenticated;`
-- sets the same request.jwt.claims that Supabase's API sets for a signed-in request.

begin;

create schema tests;
grant usage on schema tests to authenticated, anon;

-- Named ids created during the run, readable while acting as any user.
create table tests.ids (name text primary key, id uuid not null);
grant all on tests.ids to authenticated;
create function tests.id(p_name text) returns uuid language sql stable as $$
  select id from tests.ids where name = p_name
$$;

create function tests.login(p_user uuid) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_user,
      'role', 'authenticated',
      'email', (select email from auth.users where id = p_user)
    )::text,
    true
  );
$$;

-- The server's own requests (invitations, for instance) run with the service role.
create function tests.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role": "service_role"}', true);
$$;

create function tests.ok(p_condition boolean, p_message text) returns void
language plpgsql as $$
begin
  if p_condition is not true then
    raise exception 'FAIL: %', p_message;
  end if;
  raise notice 'ok - %', p_message;
end;
$$;

-- Runs p_sql and expects it to fail with SQLSTATE p_state.
create function tests.throws(p_sql text, p_state text, p_message text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_state then
      raise notice 'ok - %', p_message;
      return;
    end if;
    raise exception 'FAIL: % (expected SQLSTATE %, got %: %)', p_message, p_state, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL: % (expected SQLSTATE %, nothing was raised)', p_message, p_state;
end;
$$;

grant execute on all functions in schema tests to authenticated, anon;

-- ─── People ──────────────────────────────────────────────────────────────────

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'anna@alpha.test'),    -- boss of company A
  ('a0000000-0000-4000-8000-000000000002', 'walter@alpha.test'),  -- worker at company A
  ('b0000000-0000-4000-8000-000000000001', 'bella@beta.test'),    -- boss of company B
  ('c0000000-0000-4000-8000-000000000001', 'sam@nowhere.test');   -- signed up, no company yet

insert into tests.ids values
  ('anna', 'a0000000-0000-4000-8000-000000000001'),
  ('walter', 'a0000000-0000-4000-8000-000000000002'),
  ('bella', 'b0000000-0000-4000-8000-000000000001'),
  ('sam', 'c0000000-0000-4000-8000-000000000001');

-- ─── Signup: create_company ──────────────────────────────────────────────────

select tests.login(tests.id('anna'));
set local role authenticated;
insert into tests.ids select 'company_a', public.create_company('Alpha Gardens', 'Anna Boss');
select tests.ok(
  (select app_role = 'boss' and email = 'anna@alpha.test' from public.workers),
  'create_company makes the caller the boss, with the email from their login'
);
select tests.throws(
  $$select public.create_company('Second Co', 'Anna')$$, '23505',
  'create_company refuses an account that already belongs to a company'
);

reset role;
select tests.login(tests.id('bella'));
set local role authenticated;
insert into tests.ids select 'company_b', public.create_company('Beta Landscaping', 'Bella Boss');

reset role;
select tests.login(null);
set local role authenticated;
select tests.throws(
  $$select public.create_company('Ghost Co', 'Nobody')$$, '28000',
  'create_company needs a signed-in caller'
);

-- ─── Company A's data, created by its boss ───────────────────────────────────

reset role;
select tests.login(tests.id('anna'));
set local role authenticated;

with c as (insert into public.clients (name, city) values ('Harbour Offices', 'Tallinn') returning id)
insert into tests.ids select 'client_a', id from c;
insert into public.client_terms (client_id, monthly_value) values (tests.id('client_a'), 2400);

with p as (
  insert into public.projects (client_id, name, lat, lng)
  values (tests.id('client_a'), 'Harbour courtyard', 59.44, 24.75) returning id
)
insert into tests.ids select 'site_a', id from p;
with p as (
  insert into public.projects (client_id, name, lat, lng)
  values (tests.id('client_a'), 'Harbour roof garden', 59.44, 24.76) returning id
)
insert into tests.ids select 'site_a2', id from p;
insert into public.project_terms (project_id, monthly_value) values (tests.id('site_a'), 1800);

with w as (insert into public.workers (name, email) values ('Walter Worker', 'walter@alpha.test') returning id)
insert into tests.ids select 'worker_row_a', id from w;
insert into tests.ids select 'anna_row', id from public.workers where user_id = tests.id('anna');

select tests.throws(
  format($$update public.workers set user_id = %L where id = %L$$, tests.id('sam'), tests.id('worker_row_a')),
  '42501', 'a boss cannot link a login to a worker (only an invitation can)'
);
select tests.throws(
  format($$insert into public.workers (name, user_id) values ('Sneaky', %L)$$, tests.id('sam')),
  '42501', 'a boss cannot add a worker with a login already attached'
);

select public.set_project_crew(tests.id('site_a'), array[tests.id('worker_row_a')], tests.id('anna_row'));
select tests.ok(
  (select count(*) = 2 and count(*) filter (where is_lead) = 1
   from public.project_workers where project_id = tests.id('site_a')),
  'set_project_crew adds the crew plus the lead, with exactly one lead'
);

with pl as (
  insert into public.plants (project_id, common, kind) values (tests.id('site_a'), 'Linden', 'Tree') returning id
)
insert into tests.ids select 'plant_a1', id from pl;
insert into public.plants (project_id, common, kind) values (tests.id('site_a'), 'Box hedge', 'Hedge');
select tests.ok(
  (select array_agg(code order by code) = array['PL-0001', 'PL-0002'] from public.plants),
  'plant codes count up per company from PL-0001'
);
update public.plants set code = 'PL-9999' where id = tests.id('plant_a1');
select tests.ok(
  (select code = 'PL-0001' from public.plants where id = tests.id('plant_a1')),
  'a plant code never changes once handed out'
);

with t as (
  insert into public.tasks (title, project_id, plant_id, worker_id, day, start, duration, kind)
  values ('Water the linden', tests.id('site_a'), tests.id('plant_a1'), tests.id('worker_row_a'), 0, 8, 1.5, 'Watering')
  returning id
)
insert into tests.ids select 'task_walter', id from t;
with t as (
  insert into public.tasks (title, project_id, worker_id, day, start, duration, kind)
  values ('Inspect the roof', tests.id('site_a2'), tests.id('anna_row'), 1, 9, 2, 'Inspection')
  returning id
)
insert into tests.ids select 'task_anna', id from t;

insert into public.offers (client_id, project_id, what, value, due_date, subject, body)
values (tests.id('client_a'), tests.id('site_a'), 'Hedge clipping', 750, '2026-10-01', 'Hedges', 'Hello');

-- ─── The worker's login is linked (what an invitation does, with the service role) ─────

reset role;
select tests.as_service();
update public.workers set user_id = tests.id('walter') where id = tests.id('worker_row_a');

-- ─── Company B sees nothing of company A ─────────────────────────────────────

select tests.login(tests.id('bella'));
set local role authenticated;

select tests.ok((select count(*) = 1 from public.companies), 'B sees only its own company');
select tests.ok((select count(*) = 1 from public.workers), 'B sees only its own workers');
select tests.ok(
  (select count(*) from public.clients) + (select count(*) from public.client_terms)
  + (select count(*) from public.projects) + (select count(*) from public.project_terms)
  + (select count(*) from public.project_workers) + (select count(*) from public.plants)
  + (select count(*) from public.tasks) + (select count(*) from public.offers) = 0,
  'B sees none of A''s clients, money, sites, crews, plants, tasks or offers'
);
select tests.throws(
  format($$insert into public.clients (company_id, name) values (%L, 'Planted')$$, tests.id('company_a')),
  '42501', 'B cannot insert a row into A''s company'
);
select tests.throws(
  format($$insert into public.projects (client_id, name, lat, lng) values (%L, 'Hijack', 0, 0)$$, tests.id('client_a')),
  '23503', 'B cannot hang its own site under A''s client (composite foreign key)'
);
update public.tasks set status = 'done' where id = tests.id('task_walter');
select tests.throws(
  format($$select public.complete_task(%L, 'x', now(), null, null, current_date)$$, tests.id('task_walter')),
  'P0002', 'B cannot complete A''s task'
);

with c as (
  insert into public.clients (name) values ('Beta client') returning id
), pl as (
  insert into public.projects (client_id, name, lat, lng)
  select c.id, 'Beta site', 58.38, 24.5 from c
  returning id
)
insert into tests.ids select 'site_b', id from pl;
insert into public.plants (project_id, common, kind) values (tests.id('site_b'), 'Rose bed', 'Flower bed');
select tests.ok(
  (select code = 'PL-0001' from public.plants),
  'B''s first plant is PL-0001 too: codes are per company'
);

-- ─── Worker Walter at company A ──────────────────────────────────────────────

reset role;
select tests.ok(
  (select status = 'planned' from public.tasks where id = tests.id('task_walter')),
  'B''s update of A''s task changed nothing'
);
select tests.login(tests.id('walter'));
set local role authenticated;

select tests.ok((select count(*) = 2 from public.tasks), 'a worker sees the company''s tasks');
select tests.ok((select count(*) = 1 from public.clients), 'a worker sees the company''s clients');
select tests.ok(
  (select count(*) from public.client_terms) + (select count(*) from public.project_terms)
  + (select count(*) from public.offers) = 0,
  'a worker sees no money and no offers'
);

update public.tasks set status = 'done', duration = 9 where id = tests.id('task_walter');
update public.workers set app_role = 'boss' where user_id = tests.id('walter');
update public.plants set status = 'critical';
delete from public.clients;
reset role;
select tests.ok(
  (select status = 'planned' and duration = 1.5 from public.tasks where id = tests.id('task_walter'))
  and (select app_role = 'worker' from public.workers where id = tests.id('worker_row_a'))
  and (select count(*) = 0 from public.plants where status = 'critical')
  and (select count(*) = 2 from public.clients),
  'a worker''s direct writes to tasks, their own role, plants and clients change nothing'
);
select tests.login(tests.id('walter'));
set local role authenticated;

select tests.throws(
  $$insert into public.clients (name) values ('Side business')$$,
  '42501', 'a worker cannot add clients'
);
select tests.throws(
  format($$select public.set_project_crew(%L, '{}', null)$$, tests.id('site_a')),
  '42501', 'a worker cannot change a crew'
);

insert into public.plants (project_id, common, kind) values (tests.id('site_a'), 'New shrub', 'Shrub');
select tests.ok(
  (select count(*) = 3 from public.plants),
  'a worker registers a plant at a site they work on'
);
select tests.throws(
  format($$insert into public.plants (project_id, common, kind) values (%L, 'Elsewhere', 'Shrub')$$, tests.id('site_a2')),
  '42501', 'a worker cannot register a plant at a site they don''t work on'
);

select public.set_task_status(tests.id('task_walter'), 'skipped');
select tests.ok(
  (select status = 'skipped' from public.tasks where id = tests.id('task_walter')),
  'a worker can skip their own task'
);
select public.set_task_status(tests.id('task_walter'), 'planned');
select tests.throws(
  format($$select public.set_task_status(%L, 'skipped')$$, tests.id('task_anna')),
  '42501', 'a worker cannot skip someone else''s task'
);
select tests.throws(
  format($$select public.set_task_status(%L, 'done')$$, tests.id('task_walter')),
  '22023', '"done" only comes with a photo'
);

select public.update_my_profile('LV');
select tests.ok(
  (select language = 'LV' from public.workers where user_id = tests.id('walter')),
  'a worker can change the language they speak'
);

-- ─── Photo storage ───────────────────────────────────────────────────────────

insert into storage.objects (bucket_id, name)
values ('task-photos', tests.id('company_a') || '/tasks/' || tests.id('task_walter') || '/p1.jpg');
insert into storage.objects (bucket_id, name)
values ('task-photos', tests.id('company_a') || '/plants/new-shrub.jpg');
select tests.ok(true, 'a worker uploads proof for their own task, and a plant picture');

select tests.throws(
  format($$insert into storage.objects (bucket_id, name) values ('task-photos', %L)$$,
    tests.id('company_a') || '/tasks/' || tests.id('task_anna') || '/p.jpg'),
  '42501', 'a worker cannot upload proof for someone else''s task'
);
select tests.throws(
  format($$insert into storage.objects (bucket_id, name) values ('task-photos', %L)$$,
    tests.id('company_b') || '/plants/p.jpg'),
  '42501', 'a worker cannot upload into another company''s folder'
);
select tests.throws(
  format($$insert into storage.objects (bucket_id, name) values ('task-photos', %L)$$,
    tests.id('company_a') || '/p.jpg'),
  '42501', 'uploads must go into a tasks/ or plants/ folder'
);

-- ─── complete_task ───────────────────────────────────────────────────────────

select tests.throws(
  format($$select public.complete_task(%L, %L, now(), null, null, current_date)$$,
    tests.id('task_anna'), tests.id('company_a') || '/tasks/' || tests.id('task_anna') || '/p.jpg'),
  '42501', 'a worker cannot complete someone else''s task'
);
select tests.throws(
  format($$select public.complete_task(%L, %L, now(), null, null, current_date)$$,
    tests.id('task_walter'), tests.id('company_a') || '/plants/new-shrub.jpg'),
  '22023', 'complete_task refuses a photo from another folder'
);
select tests.throws(
  format($$select public.complete_task(%L, %L, now(), null, null, current_date)$$,
    tests.id('task_walter'), tests.id('company_a') || '/tasks/' || tests.id('task_walter') || '/missing.jpg'),
  'P0002', 'complete_task refuses a photo that was never uploaded'
);

select public.complete_task(
  tests.id('task_walter'),
  tests.id('company_a') || '/tasks/' || tests.id('task_walter') || '/p1.jpg',
  '2026-09-21T08:15:00+03:00', 59.44, 24.75, '2026-09-21'
);
select public.complete_task(
  tests.id('task_walter'),
  tests.id('company_a') || '/tasks/' || tests.id('task_walter') || '/p1.jpg',
  '2026-09-21T08:15:00+03:00', 59.44, 24.75, '2026-09-21'
);
select tests.ok(
  (select status = 'done' from public.tasks where id = tests.id('task_walter'))
  and (select count(*) = 1 from public.task_photos)
  and (select count(*) = 1 from public.care_events)
  and (select last_care = '2026-09-21' from public.plants where id = tests.id('plant_a1')),
  'complete_task records the photo, marks the task done and updates the plant''s history; a retry changes nothing'
);

-- ─── Everything else ─────────────────────────────────────────────────────────

select tests.throws(
  $$insert into public.weather_cache (key, payload) values ('59.44,24.75', '{}')$$,
  '42501', 'signed-in users cannot write the shared weather cache'
);
select tests.ok((select count(*) = 0 from public.usage_counters), 'usage counters are not readable directly');

reset role;
select tests.login(tests.id('anna'));
set local role authenticated;

select tests.ok(
  (select sites = 2 and plants = 3 and hours = 1.5 from public.client_stats(
     '2026-09-01T00:00:00+03:00', '2026-10-01T00:00:00+03:00'
   ) where client_id = tests.id('client_a')),
  'client_stats counts sites, plants and proven hours (one visit per task per day)'
);
select tests.ok(
  public.bump_usage('ai', 2) and public.bump_usage('ai', 2) and not public.bump_usage('ai', 2),
  'bump_usage allows the daily limit, then says no'
);
select tests.ok((select count(*) = 1 from public.task_photos), 'the boss sees the company''s photo proof');
select tests.ok(
  (select count(*) = 2 from storage.objects where bucket_id = 'task-photos'),
  'the boss sees the company''s stored photos'
);
select tests.throws(
  format($$update public.workers set app_role = 'worker' where id = %L$$, tests.id('anna_row')),
  '23514', 'the last boss cannot demote themselves'
);
select tests.throws(
  format($$update public.workers set archived_at = now() where id = %L$$, tests.id('anna_row')),
  '23514', 'the last boss cannot archive themselves'
);
update public.workers set app_role = 'boss' where id = tests.id('worker_row_a');
update public.workers set app_role = 'worker' where id = tests.id('anna_row');
select tests.ok(
  (select app_role = 'worker' from public.workers where id = tests.id('anna_row')),
  'with a second boss in place, the first can step down'
);

reset role;
select tests.login(tests.id('sam'));
set local role authenticated;
select tests.ok(
  (select count(*) from public.companies) + (select count(*) from public.workers)
  + (select count(*) from public.clients) + (select count(*) from storage.objects) = 0,
  'an account with no company sees nothing'
);
select tests.throws(
  $$insert into public.clients (name) values ('Orphan')$$,
  '42501', 'an account with no company cannot create data'
);

reset role;
select tests.login(null);
set local role anon;
select tests.ok(
  (select count(*) from public.companies) + (select count(*) from public.clients) = 0,
  'signed-out visitors see nothing'
);

reset role;
\warn 'All row-level security tests passed.'
rollback;
