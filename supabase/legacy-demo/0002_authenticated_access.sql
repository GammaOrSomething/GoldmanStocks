-- Grant signed-in users read/write access to the demo data.
--
-- Why: every table has RLS enabled but no policy that admits the `authenticated` role, so a
-- correctly signed-in user gets zero rows from every table. Verified with a raw authenticated
-- JWT over the REST API — the app code is fine, the policies are what block it.
--
-- This is ADDITIVE. Postgres ORs permissive policies together, so existing policies keep
-- working; nothing is dropped. Tighten `using (true)` to real company/worker scoping before
-- this is used with more than one company's data.

do $$
declare t text;
begin
  foreach t in array array[
    'companies', 'workers', 'clients', 'projects', 'plants',
    'tasks', 'care_events', 'task_photos', 'weather_cache', 'offers'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "rootline authenticated access" on %I', t);
    execute format(
      'create policy "rootline authenticated access" on %I for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;
