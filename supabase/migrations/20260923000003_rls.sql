-- Production baseline, part 3 of 4: row-level security.
--
-- The rules, for signed-in users (the `authenticated` role):
--   * Everyone sees only their own company's rows.
--   * A boss may do anything within their company.
--   * A worker may read their company's data, except offers and the money tables
--     (client_terms, project_terms). The only direct write is registering a plant at a site
--     they work on; everything else goes through the functions in part 2.
--   * Signed-out visitors (`anon`) get nothing: no policy names them.
--   * weather_cache and usage_counters have no policies at all: only the server (service
--     role, which bypasses row-level security) and the functions in part 2 touch them.
--
-- `(select private.company_id())` is the caller's company, evaluated once per query.

do $$
declare t text;
begin
  foreach t in array array[
    'companies', 'workers', 'clients', 'client_terms', 'projects', 'project_terms',
    'project_workers', 'plants', 'tasks', 'care_events', 'task_photos', 'offers',
    'weather_cache', 'usage_counters'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ─── Companies and workers ───────────────────────────────────────────────────

create policy "members read their company" on public.companies
  for select to authenticated
  using (id = (select private.company_id()));

create policy "boss renames the company" on public.companies
  for update to authenticated
  using (id = (select private.company_id()) and (select private.is_boss()))
  with check (id = (select private.company_id()));

create policy "members read their company's workers" on public.workers
  for select to authenticated
  using (company_id = (select private.company_id()));

-- A boss adds people without a login; logins are linked only through an invitation.
create policy "boss adds workers" on public.workers
  for insert to authenticated
  with check (
    company_id = (select private.company_id())
    and (select private.is_boss())
    and user_id is null
  );

-- Which columns may change is limited further by the guard_worker_update trigger.
create policy "boss edits workers" on public.workers
  for update to authenticated
  using (company_id = (select private.company_id()) and (select private.is_boss()))
  with check (company_id = (select private.company_id()));
-- No delete policy: workers are archived (archived_at), never deleted.

-- ─── Readable by the whole company, written by the boss ──────────────────────

do $$
declare t text;
begin
  foreach t in array array['clients', 'projects', 'project_workers', 'tasks', 'care_events']
  loop
    execute format($f$
      create policy "members read" on public.%1$I
        for select to authenticated
        using (company_id = (select private.company_id()));
      create policy "boss inserts" on public.%1$I
        for insert to authenticated
        with check (company_id = (select private.company_id()) and (select private.is_boss()));
      create policy "boss updates" on public.%1$I
        for update to authenticated
        using (company_id = (select private.company_id()) and (select private.is_boss()))
        with check (company_id = (select private.company_id()));
      create policy "boss deletes" on public.%1$I
        for delete to authenticated
        using (company_id = (select private.company_id()) and (select private.is_boss()));
    $f$, t);
  end loop;
end $$;

-- ─── Boss only: money and offers ─────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['client_terms', 'project_terms', 'offers'] loop
    execute format($f$
      create policy "boss only" on public.%I
        for all to authenticated
        using (company_id = (select private.company_id()) and (select private.is_boss()))
        with check (company_id = (select private.company_id()) and (select private.is_boss()));
    $f$, t);
  end loop;
end $$;

-- ─── Plants: workers register them at their own sites ────────────────────────

create policy "members read" on public.plants
  for select to authenticated
  using (company_id = (select private.company_id()));

create policy "boss, or crew at that site, registers plants" on public.plants
  for insert to authenticated
  with check (
    company_id = (select private.company_id())
    and (
      (select private.is_boss())
      or exists (
        select 1 from public.project_workers pw
        where pw.project_id = plants.project_id
          and pw.worker_id = (select private.worker_id())
      )
    )
  );

create policy "boss updates" on public.plants
  for update to authenticated
  using (company_id = (select private.company_id()) and (select private.is_boss()))
  with check (company_id = (select private.company_id()));

create policy "boss deletes" on public.plants
  for delete to authenticated
  using (company_id = (select private.company_id()) and (select private.is_boss()));

-- ─── Task photos: added through complete_task, readable by the company ───────

create policy "members read" on public.task_photos
  for select to authenticated
  using (company_id = (select private.company_id()));

create policy "boss deletes" on public.task_photos
  for delete to authenticated
  using (company_id = (select private.company_id()) and (select private.is_boss()));
