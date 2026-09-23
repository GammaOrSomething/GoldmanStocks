# TODO — finishing the integration

Read [HANDOFF.md](HANDOFF.md) first. The list is in priority order, and each item says how to
verify it.

> Updated 19 Sep 2026. Items 1 and 4 are done; the state of 2 and 3 was checked against the live
> database rather than assumed. Anything below that needs the Supabase dashboard, the Vercel
> dashboard or a key rotation cannot be done from a dev machine — those are the ones left.

## 1. ~~Merge `main-test` into `main`~~ — done

Merged 19 Sep 2026 with `git merge --no-ff`, so the branch's shape stays visible and no published
history was rewritten (`AGENTS.md` — force-pushing or rebasing pushed commits corrupts Lovable's
view of the project).

PR #4 had merged only the earlier `018239d`; everything after it — the Supabase-backed screens, the
real map, Vercel support, plant registration, saved offers and the monthly photo report — reached
`main` in this merge. Confirm with:

```sh
git rev-list --count origin/main..origin/main-test   # 0
```

The merge deleted three files from `main`, all deliberately superseded on the branch:
`src/components/PlantMap.tsx` (replaced by the Leaflet components),
`src/assets/goldman-stocks-logo.png.asset.json` (replaced by the bundled PNG, since the
Lovable-hosted `/__l5e/` asset 404s on any other host) and `src/routes/projects.$projectId.tsx`
(renamed to `projects_.$projectId.tsx` — the fix for the detail page that never rendered).

## 2. ~~Fix the live site coordinates~~ — done

Applied to the live database on 19 Sep 2026. All five sites read back correct:

| | was | now | |
| --- | --- | --- | --- |
| `p1` | `59.4215, 24.7985` — the forest by the railway | `59.4196, 24.8048` | Valukoja 8, Tallinn |
| `p2` | `59.4322, 24.753` | `59.4335, 24.7581` | Rävala pst 3, Tallinn |
| `p3` | `58.379, 24.487` — 842 m off the street it names | `58.376, 24.5` | Ranna pst, Pärnu |
| `p4` | `56.973, 24.115` | `56.9776, 24.1368` | Duntes iela 6, Riga |
| `p5` | `59.438, 24.79` | `59.4379, 24.7801` | Koidula 14, Tallinn |

The one-off fix script has since been deleted along with the rest of the demo tooling.

**One caveat on `p3`.** House number 12 has no geocode — Nominatim resolves the street but not the
building — so its pin is street-level, taken from the seed file and corroborated by Nominatim to
within ~110 m. That is a large improvement on the 842 m error it replaces, but if you want it on
the building, open `/projects` → **Move sites** and drag it; it saves on drop, and plants follow
their site automatically.

**Verify:** on `/projects/p1` the pin and plant dots sit on the Ülemiste City office park.

## 3. ~~Apply migration 0003 — plant GPS~~ — done

Applied 19 Sep 2026 via the Supabase Management API (see
[supabase/README.md](../supabase/README.md) → Applying migrations, which now documents the route).
`plants.lat` and `plants.lng` exist as nullable `double precision`, and PostgREST serves them —
`GET /rest/v1/plants?select=id,lat,lng` returns 200 where it used to answer
`42703: column plants.lat does not exist`.

Verified by round-tripping a plant with a known position: the write no longer needs the `PGRST204`
fallback in `src/lib/api/plants.ts`, the coordinates read back byte-identical rather than rounded,
and `plantPosition` (`src/lib/geo.ts`) drew it at the stored GPS instead of deriving it from the
site plan. The test plant was deleted afterwards — `plants` is back to 15 rows.

Existing plants were **not** backfilled, deliberately: all 15 still have `lat`/`lng` null, which is
what makes them keep following their site when it is moved on the map.

**Still worth doing on a real phone:** register a plant from `/mobile/new-plant` with location
enabled and check the dot lands where you stood. If the columns ever read back empty after a schema
change, run `notify pgrst, 'reload schema';`.

## 4. ~~Build the monthly photo report~~ — done

Built and verified end to end. See [HANDOFF.md](HANDOFF.md) section 7 for how it works.

`/clients` → **Monthly report with photos** now opens `/clients/:clientId/report?month=YYYY-MM`:
one table row per photo uploaded that month, with the picture, date, plant, work done and worker.

Verified by finishing a real job with a photo against the live database — the row appeared with the
right worker, site, time, a signed photo and a map link, adjacent months and other clients stayed
empty — and the test data was removed afterwards (`task_photos` back to 0 rows, `care_events` back
to 120, task `t9` back to `planned`, storage object deleted).

**What is left is real-world use, not code.** `task_photos` is empty, so every client's report is
an empty table until workers start finishing jobs with photos in the worker app. That is the
feature working as designed, not a bug — but it means the report cannot be demoed cold. Finish one
job with a photo on `/mobile` first.

Two limits worth knowing before showing it to anyone, both recorded in HANDOFF.md:

- the **Plant** column is blank for every current task (`tasks.plant_id` is null throughout the
  seed data); the site and zone underneath it locate the work instead
- `/clients` hours are now calculated from the same proof photos (`src/lib/client-stats.ts`), so
  the two agree

## 5. ~~Apply migration 0004 — task dates~~ — done

Applied 19 Sep 2026 via the Supabase Management API (see
[supabase/README.md](../supabase/README.md) → Applying migrations). `tasks.date` exists as nullable
`date` with the `tasks_date_idx` index, and PostgREST serves it —
`GET /rest/v1/tasks?select=id,date` returns 200 where it answered
`42703: column tasks.date does not exist`.

Verified by round-tripping a one-off date onto a task and querying it back through a month window,
then reverting. Existing tasks were **not** backfilled, deliberately: a null date means "every week
on `day`", which is what the day and week views and the worker app read.

## 6. ~~Deploy to Vercel~~ — done

Live at **https://goldman-stocks.vercel.app**, deploying from `main` on push. Confirmed serving the
current build: the worker app shows the seven-day week and `/clients/c1/report?month=2026-09`
renders the September photo row.

Still worth a manual pass before showing it to anyone: map tiles, the logo, and that
"Approve today's plan" returns its AI explanation — those need the server-side keys to be set in
Vercel, not just the `VITE_` ones.

## 7. Security clean-up — now urgent (20 min)

**Rotate everything.** The Supabase `service_role` JWT, the `sb_secret_` key, the anon and
publishable keys, the database password and the OpenAI key have all been pasted into AI chat
transcripts. Rotate in this order:

1. Supabase → Settings → Database → **Reset database password** (the riskiest: unlike the API keys
   it is not scoped by PostgREST).
2. Supabase → Settings → API Keys → rotate `service_role` and `sb_secret_`, and the anon /
   publishable keys in the same pass.
3. OpenAI → API keys → revoke and replace.
4. Update `.env`.
5. Update the env vars in **both** Vercel and Lovable, and redeploy — `VITE_SUPABASE_*` are baked
   in at build time, so saving the setting is not enough.

**Remove the extra auth user:** Supabase → Authentication has a local dev login,
`kristers-local@rootline.demo`. Delete it if nobody uses it.

Nothing in the codebase requires pasting a secret to anyone: `.env` is read directly by `bun`.

## 7a. Live-data corrections and deliberate demo data

**Corrected 19 Sep 2026:** the eight seeded tasks had `plant_id` null, because the (since deleted)
seed script dropped the field on insert. The code is fixed
and the live rows were backfilled from the seed, so the report's **Plant** column now fills in.
Only `t1789775221396` (created in the app) has no plant, which is correct.

### Demo data deliberately left in the shared database

Added 19 Sep 2026 so the monthly report has something to show. **Not test residue — remove it only
when you mean to.**

| What | Detail |
| --- | --- |
| Task `t13` "Weekend watering round" | Saturday (`day 5`), 09:00, 2 h, `w1` Mart Kivi, Ülemiste (`p1`), plant `PL-0142`. `status: done` — it is the row the report shows |
| Task `t14` "Parking edge hedge check" | Saturday (`day 5`), 11:00, 1 h, `w1`, Ülemiste, plant `PL-0143`. Left **open** so the camera → **Validate work** has a job to attach to |
| One `task_photos` row | `tasks/t13/…jpg`, a small placeholder JPEG, taken `2026-09-19T09:20+03:00` with GPS |
| One `care_events` row | written by `completeTask`; `PL-0142.last_care` moved to 2026-09-19 |

To remove: delete the `task_photos` row and its storage object, delete the `care_events` row for
`t13`, delete task `t13`, and restore `PL-0142.last_care`.

**To demo the capture flow again** once `t14` is photographed, set it back to open:
`PATCH /rest/v1/tasks?id=eq.t14  {"status":"planned"}` — its previous photo stays in the report,
which is correct: a recurring job photographed on two different visits is two rows.

The seed script and its mock data are gone, so these rows only exist in the demo database.

## 8. Nice to have

- **Confirm or drop the psql claim.** `supabase/README.md` now documents the Management API route
  and flags its old "psql can't reach this database" note as unconfirmed. One command settles it —
  see item 3 — and then the note can become fact or disappear.
- **One server-function convention:** consolidate `src/lib/api/` and `src/lib/*.functions.ts`.
- **Schedule week view:** stop concurrent jobs of different workers overlapping (split the day
  column per worker).
- **Push reminders:** the "Morning job reminders" switch in the worker app needs push notifications
  before it can work.
- **Tie tasks to plants.** Nothing sets `tasks.plant_id`, which is why the report's Plant column is
  blank. Setting it when a task is created would fill in the report and the plant's care history
  at the same time.
