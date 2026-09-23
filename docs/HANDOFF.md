# Handoff — integration, real map, Vercel

Written 19 Sep 2026 for whoever picks this up next. Everything below is on the **`main-test`**
branch. What's left to do is in [TODO.md](TODO.md).

## Where the branch stands

Six commits on `main-test`, on top of `018239d`:

| Commit | What it did |
| --- | --- |
| `7cc7f15` | Every screen reads from Supabase — no mock data left in the app |
| `7dc219c` | Create/edit forms for clients, workers, plants; worker-app settings save |
| `d6a9568` | Real street/satellite map; add, move and edit work sites |
| `989e0a7` | Deployable to Vercel |
| `d33e276` | "Register new plant" in the worker app saves, with photo and GPS |
| `a5675ff` | Drafted offers are saved; approve/dismiss persists |

**Pushed, but not merged.** `main-test` is on GitHub at `91e1137`, so nothing is waiting to be
pushed. It is **7 commits ahead of `main` and not merged into it** — PR #4 merged the earlier
`018239d`, not this work. Opening a PR from `main-test` into `main` is still to do.

Checks at `a5675ff`: `bunx tsc --noEmit` clean, `bun test` 68/68, `bun run build` (Cloudflare) and
`VERCEL=1 bun run build` both pass. After the photo report (section 7) the same four are green with
`bun test` at 90/90. Every feature below was also clicked through in a headless browser against the
real Supabase project; test data was removed afterwards.

> If `bun run build` fails on `leaflet/dist/leaflet.css`, `node_modules` is incomplete — run
> `bun install`. Leaflet was missing from a fresh checkout here.

## Running it

```sh
bun install
cp .env.example .env     # then fill it in — see below
bun run dev              # http://localhost:8080 (phone: the "Network" URL vite prints, /mobile)
bun test                 # 68 tests (planner, weather rules, geo, offers, photos validation)
bunx tsc --noEmit
bun run build            # Cloudflare build (Lovable's target)
VERCEL=1 bun run build   # Vercel build → .vercel/output
```

No `bun` installed? `npx bun@1.4.2 <command>` works the same.

`.env` needs:

| Variable | Notes |
| --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | public, needed at build time |
| `SUPABASE_SERVICE_ROLE_KEY` | server only — photo storage, signed URLs |
| `OPENAI_API_KEY` | plan explanation + drafted offers (`OPENAI_MODEL` optional, default `gpt-4o`) |

## What was built

### 1. No mock data in the app
- **`src/hooks/use-data.ts`:** cached `useClients` / `useWorkers` / `useProjects` / `usePlants`, and
  `useRefreshData()`. **Call `useRefreshData()` after every write:** it refetches those lists
  and re-runs the route loaders.
- **Moved onto live data:** the dashboard, schedule, planner (`use-week-plan.ts`) and every worker-app page.
- **Weather:** `weather.functions.ts` reads site coordinates from the `projects` table and caches forecasts in
  `weather_cache`.
- **Plant calendar:** `PlantCalendar` shows real care history (`src/lib/api/care.ts` → `care_events`).
  Finishing a job with a photo now also writes a care event and updates the plant's last-care date
  (`completeTask` in `src/lib/server/photos.ts`).
- **Dates:** "Today" and due dates use the real date. They used to be pinned to 21 Sep 2026.
- **No mock data:** the mock data file and seed script are gone. Tests use the small fixture in
  `src/lib/__fixtures__/week.ts`. Display labels live in `src/lib/labels.ts`.

### 2. Create and edit records
- **Server functions** (zod-validated, create-or-update): `saveClient`, `saveWorker`, `saveSite`,
  `moveSite`, `savePlant` in `src/lib/api/*.ts`.
  - New ids follow the seeded scheme (`c6`, `w5`, `p6`, `PL-0462`); see `src/lib/api/ids.ts`.
  - New sites and plants bump the client's counters.
- **Forms** in `src/components/forms/`: `ClientDialog`, `WorkerDialog`, `PlantDialog`, `SiteDialog`. Each works
  for both new and edit.
- **Wired into the pages:**
  - Clients: New client, Edit.
  - Workers: Add worker, Edit. "Open in worker app" replaced the fake "Send today's list".
  - Plants: Register plant, Edit. "Add by photo" links to the worker app.
  - Projects and project page: see the map section.
- **Worker-app settings:**
  - Language is saved on the worker (the planner uses it).
  - "Stamp photos with location" is saved on the phone and respected.
  - Morning reminders are shown as unavailable (no push notifications exist).

### 3. Real map (Leaflet)
- **`src/components/map/`:** street (OpenStreetMap) and satellite (Esri) layers.
  - Loaded only in the browser (`ClientOnly` + lazy import). Leaflet can't run on the server.
  - `SitesMap`: all sites, drag to move, click to place.
  - `SiteMap`: one site with its plants.
  - `LocationPicker`: used in the site form.
- **Projects page:**
  - a sites map with **Move sites** (drag a pin; it saves on drop)
  - **Place new site** (click the map)
  - **Add site** / **Edit site**
- **Site form:** address search and reverse lookup (`src/lib/api/geocode.ts`, OpenStreetMap Nominatim; no
  key, max 1 request/second), crew chips with a ★ for the lead.
- **Plant positions:** migration 0003 is **applied** (19 Sep 2026), so `plants.lat`/`lng` exist and a
  plant registered with GPS is stored and drawn at its exact position. A plant *without* GPS — which
  is all 15 seeded ones, deliberately not backfilled — is still derived from its site-plan `x`/`y`
  around the site point (`src/lib/geo.ts`, a 160 × 100 m plan), which is what lets it keep following
  the site if that is moved. `plantPosition` picks between the two; `savePlant` still carries its
  `PGRST204` retry, harmless now but the reason the app worked before the migration landed.
- **Bug fixed:** the project detail page (`/projects/p1`) never rendered, because it was nested under the list route,
  which has no `<Outlet>`. It was renamed to `src/routes/projects_.$projectId.tsx`; the URL is unchanged.
- **Bug fixed:** `Badge` now renders a `<span>`. As a `<div>` inside a `<p>` it broke hydration.

### 4. Vercel
- `vercel.json` sets the install and build commands, no framework preset, and region `lhr1` (next to Supabase
  `eu-west-2`).
- **How the target is chosen:** Nitro detects Vercel's build environment and outputs `.vercel/output` (Build Output
  API, Node 24). Lovable's own builds still target Cloudflare.
- **The logo is bundled** (`src/assets/goldman-stocks-logo.png`). The Lovable-hosted `/__l5e/` asset 404s on
  any other host.
- **Setup and env vars:** [deploy-vercel.md](deploy-vercel.md).

### 5. Register new plant (worker app)
- **`/mobile/new-plant`:**
  - the photo uploads immediately
  - the worker enters the name, species (optional) and type, and picks the site and area
  - the GPS pin is added (if allowed)
  - Save creates the plant and attaches the photo
- **Plant recognition was removed on purpose.** No AI guessing: the worker names the plant.
- **Photos** live in the private `task-photos` bucket under `plants/<id>/photo.*`
  (`src/lib/server/plant-photos.ts`, `src/lib/plants.functions.ts`). `PlantPhoto` shows them in both
  plant views.

### 6. Offers saved
- **Draft offers** saves the OpenAI drafts to `offers`.
- **Cooldown:** a site with a waiting offer, or one drafted in the last 30 days, isn't offered again.
- **Approve/Dismiss persists.** Approving copies the text to the clipboard; nothing is ever sent.
- **Code:** `src/lib/outreach.functions.ts`.

### 7. Monthly photo report
- **`/clients/:clientId/report?month=YYYY-MM`** — one table row per photo uploaded that month:
  the picture, the date and time, the plant, the work done and the worker. Replaces the fake toast
  on `/clients`.
- **Code:** `src/lib/server/reports.ts` (`clientReport`), exposed through
  `src/lib/reports.functions.ts`, rendered by `src/routes/clients_.$clientId.report.tsx`.
- **`src/lib/month.ts`** holds the month helpers. It sits *outside* `src/lib/server/` on purpose:
  the route needs `currentMonth`/`monthShift`/`MonthParam` to validate its search param, and
  anything under `server/` is denied in the browser.
- **Month boundaries are the fiddly part.** `care_events.date` is a bare `date` and compares as a
  string, but `task_photos.taken_at` is a `timestamptz` — so the month is converted to real
  instants in `COMPANY_TZ` (`monthRangeUtc`). September 2026 runs from `2026-08-31T21:00:00Z`;
  naive UTC bounds would file an 08:00 job on the 1st under the previous month.
- **Photos are signed in one batched call** (`createSignedUrls`, 100 at a time), not via
  `getTaskPhotoUrl` — that one signs a single task's *latest* photo and would hide every repeat
  visit of a weekly task.
- **First `validateSearch` in the app.** `?month=` falls back to the current month rather than
  erroring. `loaderDeps` is required with it — without it the loader does not re-run when only the
  search param changes, and stepping between months shows stale rows.
- **First print styling in the app.** `print:` variants on `AppShell` hide the sidebar and nav;
  `src/styles.css` carries the `@page` margin and colour-adjust rules Tailwind can't express.

### 8. The Lovable redesign, merged in

Lovable produced a new front end (exported to `lovable-new-frontend/`, gitignored). It was branched
from `lovable-edits` — *before* the backend existed — so it was a mock-data app: no Supabase, no
forms, no map, no report. It was **not** copied over. The design was ported onto the live screens
and the mock-data half was left behind.

**Taken:** the Apple system type stack (the Playfair/Inter webfont request is gone from
`__root.tsx`), five categorical `--data-*` colour tokens, the `rise-in` entrance and
`<AnimatedGroup>` (`src/components/motion/`, CSS-only — no animation library), the compact
dashboard, the sticky-ID plants table, and the new AppShell.

**Deliberately not taken**, because each would have reverted a fix:

| From the export | Why it stayed out |
| --- | --- |
| `package.json` | drops `@supabase/*`, `leaflet`, `openai`; adds `motion`, which nothing imports |
| `.gitignore` | has no `.env` rule at all |
| `badge.tsx` | reverts `<span>`→`<div>`, the hydration bug fixed in section 3 |
| `projects.$projectId.tsx` | the old filename, whose page never rendered |
| `goldman-stocks-logo.png.asset.json` | Lovable-hosted URL, 404s anywhere else |
| `styles.css` print block | the export deleted it; the report needs it |
| `tsconfig`/`vite.config` | drop `scripts/**` and the `LOVABLE_PREVIEW_HOST` shim |
| the 5 `mobile.*` routes, `worker-store`, `PlantMap` | untouched by Lovable — stale pre-Supabase copies |

**AppShell active state** is now matched on the path, not `data-[status=active]`: the detail pages
are *siblings* of their list route (`projects_.$projectId`), so the router never marked "Projects"
active while you were on `/projects/p1`.

### 9. Month view, and what a task's date means

The schedule gained a third view, **Month**, and with it `tasks.date` (migration 0004,
**not yet applied** — TODO item 5).

**A task is still a recurring weekly template.** `day` (0-6) + `start` hour, repeating every week —
that is what the worker app, the day and week views and the planner have always read. `date` is
optional and makes a task a **one-off** on that calendar date instead. Both kinds share the table.

- **`src/lib/task-schedule.ts`** is the single answer to "what is on this date": `taskDateIn` (an
  undated task takes the week's date for its weekday) and `inWeek`. It sits outside
  `src/lib/server/` on purpose — routes, components and hooks all need it.
- **`day` is kept in step with `date`** server-side (`weekdayFromDate` in `src/lib/api/tasks.ts`),
  so nothing that reads `day` had to change.
- **This was the subtle part:** a job dated in November still carries a weekday, so without
  filtering it would be planned, weathered and counted as if it were this week. `useWeekPlan` now
  feeds the planner `inWeek` tasks only, and `workers.tsx`, `mobile.index.tsx` and
  `projects_.$projectId.tsx` filter the same way. The month grid is the one view that reads the
  full list.
- **Local date strings throughout** (`YYYY-MM-DD` built from parts, never `toISOString`) — the
  month grid is built in local time and UTC would shift days across the boundary.
- **Approve** acts on the selected date in month view, on the day or week otherwise.
  **Plan with AI** is hidden in month view: the planner works a weekday at a time against this
  week's forecast and has nothing to say about a future month.
- Tests: `src/lib/task-schedule.test.ts` (7 tests) pins the two helpers, weekend dates included.

## Conventions to keep (these bit us)

1. **Never import from `src/lib/server/` in browser code**, meaning routes, components and hooks. TanStack
   denies anything under a `server/` directory in the browser, and it **only fails in the browser**:
   server-rendered pages still return 200. Put server-only logic in `src/lib/server/` and expose it through a
   `createServerFn` in `src/lib/*.functions.ts` or `src/lib/api/*.ts`.

   To check, with `bun run dev` running, request each client module and grep for `import-protection`:

   ```sh
   for f in $(find src/routes src/hooks src/components -name "*.ts*" | grep -v /ui/); do
     curl -s "http://localhost:8080/$f" | grep -q import-protection && echo "DENIED: $f"
   done
   ```

   Requesting a `src/lib/server/*` module directly reports denied — that is expected and correct. The failure
   signal is a *client entry point* being denied, or an `Importer:` line naming one.
2. **Anything that uses storage (photos, signed URLs) needs the service-role client.** The bucket is private and
   has no storage policies. Import it inside the handler:
   `const { getAdminClient } = await import("@/lib/supabase/server")`.
3. **A route file named `x.y.tsx` nests under `x.tsx`.** If `x.tsx` has no `<Outlet />`, name it `x_.y.tsx`
   instead.
4. **The browser check is the one that counts.** Two bugs above passed every HTTP/SSR check and only showed up
   in a real browser.
5. **Testing writes to the shared database.** Clean up after yourself, or tell the team.

## Known limitations (by design, for now)

- **Language:** the worker's language isn't an interface translation; it only feeds the planner.
- **Reminders:** morning reminders need push notifications, which don't exist.
- **Schedule week view:** jobs of different workers at the same time overlap in one column. This is an old layout issue.
- **Map tiles:** OpenStreetMap and Esri are free with attribution for modest traffic. Heavy use needs a paid provider.
- **Server-function locations:** there are two, `src/lib/api/` (Track A) and `src/lib/*.functions.ts` (Track B). Both work;
  consolidate later.
- **The report's "Plant" column works** — this was previously recorded here as a design limit, and
  that was wrong. `src/lib/rootline-data.ts` gives every task a `plantId`; `scripts/seed.ts` was
  dropping it from the insert, so every task arrived with `plant_id` null and the column rendered
  blank. Fixed 19 Sep 2026, and the eight existing live tasks were backfilled from the seed to
  match. A task created in-app still has no plant unless one is chosen, and the column then shows
  "—" with the site and zone underneath locating the work.
- **The report is photo-driven, and `tasks` has no date.** A task is a recurring weekly template
  (`day` 0-6 + `start` hour), so `task_photos.taken_at` is the only real date on finished work.
  A job completed without a photo cannot be placed in a month at all.
- **Client sites, plants and hours are calculated** (`src/lib/client-stats.ts`), not read from the
  old counter columns. Hours are the durations of jobs proven with a photo this month, counted
  once per job per day.
- **The report reads through the service-role client** with a `clientId` straight off the URL, so
  it bypasses RLS. The caller must be signed in (since the real-login change); `signPhotoUrls` is a
  separate function so the data queries can move to `getAuthedClient()` when real tenancy lands.
- **Login:** there is a real login page now, and no automatic sign-in. See `docs/production/`.
