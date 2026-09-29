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
grant usage on schema tests to authenticated, anon, service_role;

-- Named ids created during the run, readable while acting as any user.
create table tests.ids (name text primary key, id uuid not null);
grant all on tests.ids to authenticated, service_role;
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

-- A token without a role claim. Nothing Supabase issues looks like this, but the rules must
-- still hold if one ever does.
create function tests.login_without_role(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
$$;

-- "Today" where company A works (Europe/Tallinn), as complete_task sees it.
create function tests.today_a() returns date language sql stable as $$
  select (now() at time zone 'Europe/Tallinn')::date
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

grant execute on all functions in schema tests to authenticated, anon, service_role;

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
select tests.ok(
  (select accepted_at is not null from public.workers),
  'the company''s creator has joined it'
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

reset role;
select tests.login_without_role(tests.id('anna'));
set local role authenticated;
select tests.throws(
  format($$update public.workers set user_id = %L where id = %L$$, tests.id('sam'), tests.id('worker_row_a')),
  '42501', 'the login-linking rule holds even for a token without a role claim'
);
reset role;
select tests.login(tests.id('anna'));
set local role authenticated;

-- The company row: a boss may rename it and change its time zone, nothing else.
select tests.throws(
  $$update public.companies set plant_seq = 0$$,
  '42501', 'a boss cannot reset the plant code counter'
);
select tests.throws(
  format($$update public.companies set created_by = %L$$, tests.id('sam')),
  '42501', 'a boss cannot change who created the company'
);
select tests.throws(
  $$update public.companies set timezone = 'Mars/Olympus_Mons'$$,
  '22023', 'a company''s time zone must be a real one'
);
update public.companies set name = 'Alpha Gardens Ltd', timezone = 'Europe/Riga';
update public.companies set timezone = 'Europe/Tallinn';
select tests.ok(
  (select name = 'Alpha Gardens Ltd' and timezone = 'Europe/Tallinn' from public.companies),
  'a boss can rename the company and change its time zone'
);

select public.set_project_crew(tests.id('site_a'), array[tests.id('worker_row_a')], tests.id('anna_row'));
select tests.ok(
  (select count(*) = 2 and count(*) filter (where is_lead) = 1
   from public.project_workers where project_id = tests.id('site_a')),
  'set_project_crew adds the crew plus the lead, with exactly one lead'
);
select public.set_project_crew(tests.id('site_a2'), array[tests.id('anna_row')], null);
select tests.ok(
  (select count(*) = 1 and count(*) filter (where is_lead) = 0
   from public.project_workers where project_id = tests.id('site_a2')),
  'set_project_crew accepts a crew with no lead'
);
select tests.throws(
  format($$select public.set_project_crew(%L, '{}', null)$$, gen_random_uuid()),
  'P0002', 'set_project_crew refuses a site that doesn''t exist'
);
select tests.throws(
  format($$select public.set_project_crew(%L, %L, null)$$,
    tests.id('site_a'), (select array_agg(gen_random_uuid()) from generate_series(1, 101))),
  '22023', 'set_project_crew refuses an oversized crew'
);
select tests.ok(
  (select count(*) = 2 from public.project_workers where project_id = tests.id('site_a')),
  'a refused crew change leaves the crew as it was'
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

-- A one-off job for Walter, today.
with t as (
  insert into public.tasks (title, project_id, worker_id, day, date, start, duration, kind)
  values ('Plant the bulbs', tests.id('site_a'), tests.id('worker_row_a'),
          extract(isodow from tests.today_a())::int - 1, tests.today_a(), 10, 1, 'Planting')
  returning id
)
insert into tests.ids select 'task_walter_once', id from t;

-- Free text has length limits.
select tests.throws(
  format($$insert into public.clients (name, contact) values ('Wordy', %L)$$, repeat('x', 5000)),
  '23514', 'a client''s contact has a length limit'
);
select tests.throws(
  format($$insert into public.projects (client_id, name, lat, lng, zones) values (%L, 'Maze', 0, 0, %L)$$,
    tests.id('client_a'), (select array_agg('zone ' || i) from generate_series(1, 101) i)),
  '23514', 'a site''s list of zones has a length limit'
);
select tests.throws(
  format($$update public.plants set species = %L where id = %L$$, repeat('x', 1000), tests.id('plant_a1')),
  '23514', 'a plant''s species has a length limit'
);
select tests.throws(
  format($$update public.offers set body = %L$$, repeat('x', 20001)),
  '23514', 'an offer''s text has a length limit'
);

-- Plant pictures must be a plain file in the company's plants/ folder.
select tests.throws(
  format($$update public.plants set photo_path = %L where id = %L$$,
    tests.id('company_a') || '/plants/../tasks/x.jpg', tests.id('plant_a1')),
  '23514', 'a plant''s photo path cannot climb out of its folder'
);
select tests.throws(
  format($$update public.plants set photo_path = %L where id = %L$$,
    tests.id('company_a') || '/plants/', tests.id('plant_a1')),
  '23514', 'a plant''s photo path needs a file name'
);
update public.plants set photo_path = tests.id('company_a') || '/plants/linden-1.jpg'
where id = tests.id('plant_a1');

-- ─── Walter is invited (the server links his login), then accepts ────────────

reset role;
select tests.as_service();
set local role service_role;
update public.workers set user_id = tests.id('walter'), invited_at = now()
where id = tests.id('worker_row_a');
reset role;

-- Until he accepts, the link gives him nothing: being invited is not agreeing to join.
select tests.login(tests.id('walter'));
set local role authenticated;
select tests.ok(
  (select count(*) from public.companies) + (select count(*) from public.workers)
  + (select count(*) from public.tasks) + (select count(*) from storage.objects) = 0,
  'an invited login that has not accepted sees nothing of the company'
);
select tests.ok(
  (select company_name = 'Alpha Gardens Ltd' and worker_id = tests.id('worker_row_a')
   from public.my_invitation()),
  'an invited login sees which company invited it'
);
select tests.throws(
  $$select public.update_my_profile('LV')$$,
  '42501', 'an invited login is no member until it accepts'
);
update public.workers set accepted_at = now() where id = tests.id('worker_row_a');
reset role;
select tests.ok(
  (select accepted_at is null from public.workers where id = tests.id('worker_row_a')),
  'an invited login cannot accept through the API'
);

select tests.login(tests.id('anna'));
set local role authenticated;
select tests.throws(
  format($$update public.workers set accepted_at = now() where id = %L$$, tests.id('worker_row_a')),
  '42501', 'a boss cannot accept an invitation on the worker''s behalf'
);
reset role;

-- Accepting runs on the server, after it has checked the session is the invited login.
select tests.as_service();
set local role service_role;
update public.workers set accepted_at = now() where id = tests.id('worker_row_a');
reset role;
select tests.login(tests.id('walter'));
set local role authenticated;
select tests.ok(
  not exists (select 1 from public.my_invitation()),
  'once accepted, no invitation is left'
);
reset role;

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
select tests.throws(
  format($$insert into public.plants (company_id, project_id, common, kind) values (%L, %L, 'Cuckoo', 'Tree')$$,
    tests.id('company_a'), tests.id('site_b')),
  '42501', 'B cannot add a plant under A''s company'
);
select tests.throws(
  format($$insert into public.plants (company_id, project_id, common, kind) values (%L, %L, 'Probe', 'Tree')$$,
    gen_random_uuid(), tests.id('site_b')),
  '42501', 'adding a plant under a made-up company fails the same way, so it reveals nothing'
);

-- ─── Worker Walter at company A ──────────────────────────────────────────────

reset role;
select tests.ok(
  (select status = 'planned' from public.tasks where id = tests.id('task_walter')),
  'B''s update of A''s task changed nothing'
);
select tests.login(tests.id('walter'));
set local role authenticated;

select tests.ok((select count(*) = 3 from public.tasks), 'a worker sees the company''s tasks');
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

-- Proof for the weekly task and today's one-off job. The extra photos are for checks further
-- down that expect a second proof to be refused.
insert into storage.objects (bucket_id, name)
select 'task-photos', tests.id('company_a') || '/tasks/' || tests.id(v.task) || '/' || v.file
from (values ('task_walter', 'p1.jpg'), ('task_walter', 'p2.jpg'),
             ('task_walter_once', 'once-1.jpg'), ('task_walter_once', 'once-2.jpg')) v (task, file);
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
select tests.throws(
  format($$insert into storage.objects (bucket_id, name) values ('task-photos', %L)$$,
    tests.id('company_a') || '/plants/..'),
  '42501', 'an upload''s name cannot be ".."'
);
select tests.throws(
  format($$insert into storage.objects (bucket_id, name) values ('task-photos', %L)$$,
    tests.id('company_a') || '/plants/'),
  '42501', 'an upload needs a file name'
);
select tests.throws(
  format($$insert into storage.objects (bucket_id, name) values ('task-photos', %L)$$,
    tests.id('company_a') || '/plants/run.sh'),
  '42501', 'uploads must be images'
);

-- ─── complete_task ───────────────────────────────────────────────────────────

select tests.throws(
  format($$select public.complete_task(%L, %L, now(), null, null, tests.today_a())$$,
    tests.id('task_anna'), tests.id('company_a') || '/tasks/' || tests.id('task_anna') || '/p.jpg'),
  '42501', 'a worker cannot complete someone else''s task'
);
select tests.throws(
  format($$select public.complete_task(%L, %L, now(), null, null, tests.today_a())$$,
    tests.id('task_walter'), tests.id('company_a') || '/plants/new-shrub.jpg'),
  '22023', 'complete_task refuses a photo from another folder'
);
select tests.throws(
  format($$select public.complete_task(%L, %L, now(), null, null, tests.today_a())$$,
    tests.id('task_walter'), tests.id('company_a') || '/tasks/' || tests.id('task_walter') || '/../p1.jpg'),
  '22023', 'complete_task refuses a path that climbs out of the task''s folder'
);
select tests.throws(
  format($$select public.complete_task(%L, %L, now(), null, null, tests.today_a())$$,
    tests.id('task_walter'), tests.id('company_a') || '/tasks/' || tests.id('task_walter') || '/missing.jpg'),
  'P0002', 'complete_task refuses a photo that was never uploaded'
);
select tests.throws(
  format($$select public.complete_task(%L, %L, now() + interval '1 day', null, null, tests.today_a())$$,
    tests.id('task_walter'), tests.id('company_a') || '/tasks/' || tests.id('task_walter') || '/p1.jpg'),
  '22023', 'complete_task refuses a photo time in the future'
);
select tests.throws(
  format($$select public.complete_task(%L, %L, now() - interval '5 days', null, null, tests.today_a())$$,
    tests.id('task_walter'), tests.id('company_a') || '/tasks/' || tests.id('task_walter') || '/p1.jpg'),
  '22023', 'complete_task refuses a photo time days in the past'
);
select tests.throws(
  format($$select public.complete_task(%L, %L, now(), null, null, tests.today_a() - 5)$$,
    tests.id('task_walter'), tests.id('company_a') || '/tasks/' || tests.id('task_walter') || '/p1.jpg'),
  '22023', 'complete_task refuses a work date days away from today'
);

select public.complete_task(
  tests.id('task_walter'),
  tests.id('company_a') || '/tasks/' || tests.id('task_walter') || '/p1.jpg',
  now(), 59.44, 24.75, tests.today_a()
);
select public.complete_task(
  tests.id('task_walter'),
  tests.id('company_a') || '/tasks/' || tests.id('task_walter') || '/p1.jpg',
  now(), 59.44, 24.75, tests.today_a()
);
select tests.ok(
  (select status = 'done' from public.tasks where id = tests.id('task_walter'))
  and (select count(*) = 1 from public.task_photos)
  and (select count(*) = 1 from public.care_events)
  and (select last_care = tests.today_a() from public.plants where id = tests.id('plant_a1')),
  'complete_task records the photo, marks the task done and updates the plant''s history; a retry changes nothing'
);
select tests.throws(
  format($$select public.complete_task(%L, %L, now(), null, null, tests.today_a())$$,
    tests.id('task_walter'), tests.id('company_a') || '/tasks/' || tests.id('task_walter') || '/p2.jpg'),
  '23505', 'a weekly task gets one proof per week: a second photo is refused'
);

select public.complete_task(
  tests.id('task_walter_once'),
  tests.id('company_a') || '/tasks/' || tests.id('task_walter_once') || '/once-1.jpg',
  now(), null, null, tests.today_a()
);
select tests.throws(
  format($$select public.complete_task(%L, %L, now() - interval '1 day', null, null, tests.today_a() - 1)$$,
    tests.id('task_walter_once'), tests.id('company_a') || '/tasks/' || tests.id('task_walter_once') || '/once-2.jpg'),
  '23505', 'a one-off task that is already done cannot be completed again'
);

select tests.throws(
  format($$select public.set_task_status(%L, 'planned')$$, tests.id('task_walter_once')),
  '42501', 'a worker cannot reopen a finished one-off task (and then prove it again)'
);
select tests.throws(
  format($$select public.set_task_status(%L, 'skipped')$$, tests.id('task_walter_once')),
  '42501', 'a worker cannot skip a finished one-off task'
);
-- A weekly task's status carries over from week to week, so the worker can still skip it.
-- Reopening it doesn't let them prove it twice: that is limited per week (above).
select public.set_task_status(tests.id('task_walter'), 'skipped');
select public.set_task_status(tests.id('task_walter'), 'planned');
select tests.throws(
  format($$select public.complete_task(%L, %L, now(), null, null, tests.today_a())$$,
    tests.id('task_walter'), tests.id('company_a') || '/tasks/' || tests.id('task_walter') || '/p2.jpg'),
  '23505', 'reopening a weekly task doesn''t allow a second proof in the same week'
);

-- ─── Everything else ─────────────────────────────────────────────────────────

select tests.throws(
  $$insert into public.weather_cache (key, payload) values ('59.44,24.75', '{}')$$,
  '42501', 'signed-in users cannot write the shared weather cache'
);
select tests.ok((select count(*) = 0 from public.usage_counters), 'usage counters are not readable directly');
select tests.throws(
  $$select public.bump_usage('ai_plan')$$,
  '42501', 'a worker cannot use up the company''s AI allowance'
);

reset role;
select tests.login(tests.id('anna'));
set local role authenticated;

select tests.ok(
  (select count(*) = 1 from public.task_photos where task_id = tests.id('task_walter')),
  'a weekly task was proven once this week, whatever was tried'
);
select tests.ok(
  (select sites = 2 and plants = 3 and hours = 2.5 from public.client_stats(
     now() - interval '7 days', now() + interval '1 day'
   ) where client_id = tests.id('client_a')),
  'client_stats counts sites, plants and proven hours (one visit per task per day)'
);

reset role;
update private.usage_limits set daily_limit = 2 where kind = 'ai_plan';
select tests.login(tests.id('anna'));
set local role authenticated;
select tests.ok(
  public.bump_usage('ai_plan') and public.bump_usage('ai_plan') and not public.bump_usage('ai_plan'),
  'bump_usage allows the daily limit, then says no'
);
select tests.throws(
  $$select public.bump_usage('ai_plan', 1000000)$$,
  '42883', 'the caller cannot choose their own limit'
);
select tests.throws(
  $$select public.bump_usage('made_up')$$,
  '22023', 'bump_usage refuses a kind it has no limit for'
);

-- ─── Invitations: finding an existing login, allowances, pending bosses ──────

reset role;
update auth.users set email_confirmed_at = now() where id = tests.id('anna');
select tests.as_service();
set local role service_role;
select tests.ok(
  (select confirmed and linked from public.login_for_email('  ANNA@Alpha.test '))
  and (select not confirmed and not linked from public.login_for_email('sam@nowhere.test'))
  and not exists (select 1 from public.login_for_email('nobody@nowhere.test')),
  'the server finds a login by email, in any case, and whether it is confirmed and linked'
);
reset role;
select tests.ok(
  not has_function_privilege('authenticated', 'public.login_for_email(text)', 'execute'),
  'signed-in users cannot look logins up by email'
);

select tests.login(tests.id('anna'));
set local role authenticated;
select tests.ok(public.bump_usage('invite'), 'a boss can spend the invite allowance');
select tests.ok(public.bump_usage('geocode'), 'a boss can spend the address-search allowance');
select tests.throws(
  $$insert into public.workers (name, email) values ('Casey Caps', 'Casey@Alpha.test')$$,
  '23514', 'worker emails are stored lowercased and trimmed'
);

reset role;
select tests.login(tests.id('walter'));
set local role authenticated;
select tests.throws(
  $$select public.bump_usage('invite')$$,
  '42501', 'a worker cannot spend the invite allowance'
);
select tests.throws(
  $$select public.bump_usage('geocode')$$,
  '42501', 'a worker cannot spend the address-search allowance'
);

-- Company B invites Sam as a second boss. Until Sam accepts, Bella is still the only boss.
reset role;
select tests.login(tests.id('bella'));
set local role authenticated;
with w as (
  insert into public.workers (name, email, app_role)
  values ('Pending Pat', 'sam@nowhere.test', 'boss') returning id
)
insert into tests.ids select 'pat_row', id from w;
insert into tests.ids select 'bella_row', id from public.workers where user_id = tests.id('bella');
reset role;
select tests.as_service();
set local role service_role;
update public.workers set user_id = tests.id('sam'), invited_at = now()
where id = tests.id('pat_row');
reset role;
select tests.login(tests.id('bella'));
set local role authenticated;
select tests.throws(
  format($$update public.workers set app_role = 'worker' where id = %L$$, tests.id('bella_row')),
  '23514', 'an invited boss who hasn''t accepted doesn''t count toward keeping one boss'
);
reset role;
select tests.as_service();
set local role service_role;
update public.workers set user_id = null, invited_at = null where id = tests.id('pat_row');
reset role;

reset role;
select tests.login(tests.id('anna'));
set local role authenticated;

select tests.ok((select count(*) = 2 from public.task_photos), 'the boss sees the company''s photo proof');
select tests.ok(
  (select count(*) = 5 from storage.objects where bucket_id = 'task-photos'),
  'the boss sees the company''s stored photos'
);
select public.set_task_status(tests.id('task_walter_once'), 'planned');
select tests.ok(
  (select status = 'planned' from public.tasks where id = tests.id('task_walter_once')),
  'a boss can reopen a finished task'
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
select tests.throws(
  $$select count(*) from public.clients$$,
  '42501', 'signed-out visitors cannot read the tables at all'
);

-- ─── Grants ──────────────────────────────────────────────────────────────────

reset role;
select tests.ok(
  not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and has_function_privilege('anon', p.oid, 'execute')
  ),
  'no private function is executable by everyone'
);
select tests.ok(
  not exists (
    select 1 from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      and (has_table_privilege('authenticated', c.oid, 'truncate')
        or has_table_privilege('authenticated', c.oid, 'references')
        or has_table_privilege('authenticated', c.oid, 'trigger'))
  ),
  'signed-in users cannot truncate tables (which skips row-level security), reference or trigger them'
);
select tests.ok(
  not exists (
    select 1 from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'S')
      and has_any_column_privilege('anon', c.oid, 'select, insert, update')
  )
  and not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and has_function_privilege('anon', p.oid, 'execute')
  ),
  'signed-out visitors have no access to any table or function'
);

-- What a later migration would create: the defaults must keep it closed too.
create function public.tests_later() returns integer language sql as 'select 1';
create function private.tests_later() returns integer language sql as 'select 1';
select tests.ok(
  not has_function_privilege('anon', 'public.tests_later()', 'execute')
  and not has_function_privilege('authenticated', 'private.tests_later()', 'execute'),
  'functions added later are closed by default: none for visitors, none in private'
);

\warn 'All row-level security tests passed.'
rollback;
