# Goldman Stocks: from demo to production

> **Changes made during implementation.** This is the plan as approved. Where the work ended up
> differing, [the migration log](../README.md) has the details:
>
> - **B:** sign-in and sign-out run in the browser, not in a server function, so Supabase's
>   per-IP rate limit applies to each user rather than to the server's single address. The
>   redirect target is returned as a plain URL, and `safeRedirect` refuses control characters
>   (the review found an open redirect via a tab).
> - **C:** a `set_task_status` function was added for workers skipping or un-skipping their own
>   jobs. `complete_task` is idempotent for a retried photo. The security tests are SQL
>   (`supabase/tests/rls.sql`), runnable on a real local Supabase or, without Docker, on plain
>   Postgres with a stand-in for Supabase's auth and storage schemas.

## Context

The app is a hackathon demo. It has no login: every visitor is silently signed in, on the server, as one shared "demo boss" Supabase account (`src/lib/api/session.ts:23`). In the worker app, "who am I" is just a worker picked from a list and saved in the phone's browser (`src/lib/worker-store.ts`). The database lets any signed-in user read and write every row (`supabase/migrations/0002_authenticated_access.sql`). Three server functions use the service-role key with no auth check at all (photos, plant photos, client report). The data is seeded from a 700-line mock file (`src/lib/rootline-data.ts`), and several screens show fake numbers or static cards.

**Decisions made with the user:**

1. **Open signup.** Signing up creates a new company, and that person becomes its boss.
2. **Workers join by email invite plus a password.**
3. **A new production Supabase project**, built from clean migrations with no seed. The current project stays untouched as the demo database.
4. **A production schema rewrite:**
   - UUID keys, with plants keeping a readable per-company code (`PL-0001`).
   - `company_id` on every table.
   - A `project_workers` join table.
   - Counters calculated rather than stored.
   - Company- and role-based row-level security (RLS), plus storage policies.
5. **Money fields are boss-only**, enforced by the database: `client_terms` and `project_terms` tables.

**Ground rules:**

- The repo syncs to Lovable. Each phase is its own branch and PR, and each leaves `main` deployable.
- No force-pushes, and no rewriting pushed history.
- Keep `AGENTS.md`, `src/lib/lovable-error-reporting.ts` and `@lovable.dev/vite-tanstack-config`.

---

## Status and working rules (updated 2026-09-23)

| Step                                 | State                                                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| A1: demo data removed                | **Done**, committed locally on `chore/remove-demo-data` (08d58ea and ae79921; the second fixes review findings) |
| A2: dead code and template leftovers | **Done**, committed locally on `chore/remove-dead-code`, stacked on A1 (b08c65a)                                |
| B: real login                        | **Next.** Branch `feat/real-login`, stacked on A2                                                               |
| C, D1, D2, E                         | Not started                                                                                                     |

- **Branches stay local** (user's choice). No pushes or PRs until the user asks. Each PR gets its own stacked branch and local commits.
- **Document as we go.** New living doc `docs/production/README.md`; the name gets past the markdown-write hook. It's linked from the root README and updated with every PR:
  1. The goal and the decisions (from Context).
  2. A progress log: one section per PR, with what changed, why, where, verification results, and review findings with how they were handled.
  3. A manual-steps checklist for the user (Phase 0, env vars after B, the cut-over steps), with checkboxes.
  4. Next steps: the remaining PRs, in order.
  5. Known limitations and follow-ups (e.g. the 1,000-row limit, the recurring-task design flaw).
- **Write the A1/A2 section first**, backfilled from this session, and commit it on the A2 branch as `docs: add production migration log`. Then do B and update the doc in B's commit.
- **After each PR's code:** run the code-review agent, fix the findings, then update the doc.

## Phase 0: manual, before any code (you do this)

- **Rotate the leaked credentials in the demo project.** `docs/TODO.md:124-140` lists the database password, API keys and OpenAI key as pasted into chat logs. Update them in `.env`, Vercel and Lovable, then redeploy.
- **Delete the stray auth user** `kristers-local@rootline.demo`.

## PR A1: remove demo data and fake numbers (still on the demo database)

**Replace the mock data in tests and code**

- Rewrite `src/lib/planner.test.ts` and `src/lib/outreach.test.ts` to use small inline fixtures, keeping every behaviour they assert today.
- Move `intervalByKind` into a new `src/lib/care-intervals.ts`.
- **Delete:**
  - `src/lib/rootline-data.ts` and `src/lib/plant-care.ts`
  - `scripts/seed.ts` and `scripts/fix-site-coordinates.ts`
  - the `seed` script in `package.json`
- `src/lib/outreach.ts:86`: drop the fallback that assumes a 2026 date. Use `lastCareDate`, else `nextCareDate`, else skip the plant, and add tests for each case.

**Calculate client numbers instead of storing them**

- New `src/lib/client-stats.ts`: a pure function with tests, `summarizeClients(...)`. It counts sites, plants, and hours this month. Hours are the sum of task durations with a proof photo this month; reuse `localDate` and `monthRangeUtc` from `src/lib/month.ts`.
- `src/lib/api/clients.ts` and `mappers.ts` use it and stop reading the stored counters.
- Delete `bumpClientCounter` and remove its calls in `projects.ts` and `plants.ts`.

**Remove fake UI**

- `AppShell.tsx:106-111`: the static "AI plan ready" card.
- `index.tsx`:
  - The "Live" badge at 246-248: show when the forecast was fetched, or remove it.
  - The equal-width strip at 252-259: make it proportional to the real numbers, or remove it.
  - "Sent to crew" at 298 becomes "Approved".
  - "Plants under care" at 125 becomes the real number of plant rows.
- `schedule.tsx:146`: the `"2026-09-21"` fallback becomes today's date (`localDate(new Date())`).
- `workers.tsx:25`: the page description mentions invites that don't exist yet.
- Remove the "Demo data" section from `supabase/README.md`.

## PR A2: dead code and template leftovers

- **Unused UI components:** delete the ones never imported: accordion, alert-dialog, aspect-ratio, breadcrumb, calendar, carousel, chart, checkbox, collapsible, command, context-menu, drawer, form, hover-card, input-otp, menubar, navigation-menu, pagination, radio-group, resizable, scroll-area, sidebar, slider, tabs, textarea, toggle, toggle-group and tooltip. Also delete `src/hooks/use-mobile.tsx`.
  - Keep `dropdown-menu`, `avatar`, `alert` and `separator`: the user menu and auth forms will use them.
- **Unused packages** in `package.json`: `cmdk`, `embla-carousel-react`, `input-otp`, `react-day-picker`, `react-hook-form`, `@hookform/resolvers`, `react-resizable-panels`, `recharts`, `vaul`, and the matching `@radix-ui/*` packages.
- **Package name:** `tanstack_start_ts` becomes `goldman-stocks`.
- **Lint:** `eslint.config.js` should also ignore `.vercel`, `.wrangler`, `.nitro`, `.tanstack` and `src/routeTree.gen.ts`. It currently scans build output, which is why lint seems to hang.
- **Template leftovers:**
  - `README.md` lines 1-21: the generic routing text.
  - `.gitignore`: the `lovable-new-frontend/` entry.
  - `vite.config.ts`: the `LOVABLE_PREVIEW_HOST` workaround, plus its line in `.env.example`.
  - `__root.tsx` and `mobile.tsx`: the `twitter:card summary_large_image` tag, which has no image.

## PR B: real login, still on the demo database

This closes the biggest hole right away. It only checks signed in versus signed out, because the demo users aren't linked to worker rows.

- `src/lib/api/session.ts`: delete `signInAsDemoBoss`. `getAuthedClient()` reads the session from the request cookie with `getClaims()`, and throws `redirect({ to: "/login" })` when there isn't one.
  - Keep the per-request memo (the `WeakMap`).
  - Keep the dynamic imports; the header comment explains why.
- **New `src/lib/auth/auth.functions.ts`:** server functions `getViewer`, `signIn` and `signOut`, all through `getServerClient()`. Cookies are then set on server responses and covered by the existing CSRF check in `src/start.ts`.
- **New `src/lib/auth/access.ts`:** `resolveAccess(pathname, viewer)`, a pure function with unit tests. It returns where to redirect, or `null`.
- **New `src/routes/login.tsx`:** an email and password form, built from the existing `card`, `input`, `label` and `button` components. Its `?redirect=` parameter is validated with zod and must stay on this site.
- **Route guard in `src/routes/__root.tsx`:**
  - Its `beforeLoad` loads the viewer through `queryClient.ensureQueryData(["viewer"])` and calls `resolveAccess`.
  - It returns `{ viewer }` into the router context. That context is sent from server to browser, so there's no second fetch.
  - One guard at the root, not a layout route: `AppShell` is a component the routes wrap themselves in, and moving 8 route files would churn Lovable.
- **Redirects from data hooks, in `src/router.tsx`:** add `QueryCache` and `MutationCache` `onError` handlers. On a redirect error they clear the cache and navigate, which covers `useQuery` calls in the mobile app and dashboard.
- **No caching:** `src/start.ts` adds a request middleware that sets `Cache-Control: private, no-store`.
- **Let redirects through the error middleware.** `errorMiddleware` in `src/start.ts` only re-throws errors that have `statusCode`. A thrown `redirect()` or `notFound()` would become the 500 error page. It must re-throw when `isRedirect(error) || isNotFound(error)`. Add a unit test if the check is pulled into a helper.
- **Login needs the dark-mode-safe existing tokens** from `styles.css`, and must work at phone width, because workers sign in on phones.
- **Tests (TDD):** write `access.test.ts` first:
  - public paths `/login` and `/auth/*`;
  - a signed-out user on `/` goes to `/login?redirect=/`;
  - a signed-in user on `/login` goes to `/`;
  - an unsafe `redirect` value (`//evil.com`, `https://…`) falls back to `/`.
- **Sign-out** in the `AppShell` user menu (`dropdown-menu`) and in `mobile.settings.tsx`. The worker picker stays until D1.
- **Require a session** in `photos.functions.ts`, `plants.functions.ts`, `reports.functions.ts`, `plan.functions.ts` (OpenAI) and `api/geocode.ts`. They call `getAuthedClient()` first.
- **Env and docs:** remove `DEMO_BOSS_*` from `.env.example` and `docs/deploy-vercel.md`.
- **Manual, after merging:** remove `DEMO_BOSS_*` from Vercel and Lovable. The demo boss email and password become a normal demo login.

## PR C: new schema, Supabase CLI and RLS tests (no app code changes)

**Tooling**

- Add the `supabase` CLI as a dev dependency.
- Scripts: `db:start`, `db:stop`, `db:reset`, `db:types` and `test:rls`. There's deliberately no `db:push` script.
- `supabase/config.toml`:
  - `site_url` is `http://localhost:8080`, the fixed Lovable dev port.
  - The allowed redirect URLs, with email confirmations on.
  - The email templates are set here, and local email goes to Mailpit.
- `supabase/templates/{confirmation,invite,recovery}.html` link to `/auth/confirm?token_hash=…&type=…&next=…`.
- Move `0001`–`0004` to `supabase/legacy-demo/`, with a README saying they are the frozen demo schema. The CLI would otherwise try to apply them.
- New baseline migration(s) `supabase/migrations/20260923…_*.sql`, as outlined below.

**Baseline schema**

- **Helper functions** in a `private` schema that the API doesn't expose: `private.company_id()`, `private.worker_id()` and `private.is_boss()`.
  - All `security definer`, with `set search_path = ''`.
  - Each reads `workers` where `user_id = auth.uid()` and the worker isn't archived.
  - Policies call them as `(select …)`.
- **Enums:** `app_role`, `health_status`, `client_health`, `task_status`, `task_kind`, `plant_kind`, `offer_status`.
- **Common columns:** `created_at` and `updated_at` everywhere, kept current by a trigger.
- **Company scoping:** every tenant table gets `company_id uuid not null default private.company_id()`, an index on it, and `unique(id, company_id)`.
  - Child tables use composite foreign keys on `(parent_id, company_id)`, so a row can never point at another company's data.

**Tables**

| Table             | Notes                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `companies`       | `id`, `name`, `timezone` (default `Europe/Tallinn`), `plant_seq`, `created_by`                                                                         |
| `workers`         | `user_id` (unique, nullable), `email`, `name`, `job_title`, `app_role`, `language`, `color`, `invited_at`, `archived_at`. Email is unique per company. |
| `clients`         | `name`, `city`, `contact`, `health`                                                                                                                    |
| `client_terms`    | **Boss-only.** `client_id` is the primary key; `monthly_value`, `contract_until`                                                                       |
| `projects`        | `client_id`, `name`, `city`, `address`, `lat`, `lng`, `zones[]`, `visits_per_month`, `status`                                                          |
| `project_terms`   | **Boss-only.** `project_id` is the primary key; `monthly_value`, `contract_until`                                                                      |
| `project_workers` | `(project_id, worker_id)` primary key, plus `is_lead`. At most one lead per site.                                                                      |
| `plants`          | `code` is set by a trigger and unique per company. `zone` (was `site`), `photo_path`, plus the existing plant columns.                                 |
| `tasks`           | Plant and worker links use composite foreign keys; `zone` (was `site`), plus the existing columns. Workers are archived, never deleted.                |
| `care_events`     | Links to plant, task and worker by composite foreign keys.                                                                                             |
| `task_photos`     | A check makes `storage_path` start with `<company_id>/tasks/<task_id>/`.                                                                               |
| `offers`          | Composite foreign keys to clients and projects.                                                                                                        |
| `weather_cache`   | Global cache. RLS is on with no policies, so only the service role can use it.                                                                         |
| `usage_counters`  | Limits OpenAI calls per company per day.                                                                                                               |

**Triggers**

- `plants_assign_code`: an atomic per-company counter produces `PL-0001`, `PL-0002`, and so on.
- `workers_guard`: blocks changes to `user_id`, `company_id` or email after invite, and blocks removing the last active boss.

**Access rules (RLS).** "Company" means the row's `company_id` matches the signed-in user's.

| Who             | Can do                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------ |
| Boss            | Everything within their company.                                                           |
| Worker, reading | Everything in their company except offers, `client_terms` and `project_terms`.             |
| Worker, writing | Add plants on sites they're assigned to. Everything else goes through the functions below. |

**Database functions workers and bosses call**

- `create_company(company_name, full_name)`: refuses if the caller already has a worker row, and never trusts signup metadata.
- `complete_task(task_id, photo_path, taken_at, lat, lng, local_date)`, run as one transaction:
  - Checks the task is the caller's own (or the caller is a boss), that the path is a plain image file in the task's folder, and that the photo exists in storage.
  - Refuses a photo time or work date away from the company's today (±1 day), a second proof for a weekly task in the same week, and a one-off task that is already done.
  - Then adds the photo row, marks the task done, adds a care event and updates the plant's last care date.
- `update_my_profile(language)`.
- `set_project_crew(project_id, worker_ids, lead_id)`: runs with the caller's rights, so the boss rules apply.
- `bump_usage(kind)`: boss-only; the limits live in `private.usage_limits` (`ai_plan`, `ai_outreach`), and unknown kinds are refused.
- `client_stats(month_start, month_end)`: sites, plants and proven hours per client, computed in SQL. In D1, `listClients` switches to it, because Supabase caps each query at 1,000 rows and the in-app count (A1) would silently undercount at scale. Keep `summarizeClients` as the tested reference.

**Storage**

- Bucket `task-photos`: private, 10 MB limit.
- Paths: `<company_id>/tasks/<task_id>/<uuid>.<ext>` and `<company_id>/plants/<uuid>.<ext>`.
- Policies on `storage.objects`, all limited to the user's company folder:

| Action               | Who                                           |
| -------------------- | --------------------------------------------- |
| Read                 | Any member                                    |
| Upload a task photo  | A boss, or the worker the task is assigned to |
| Upload a plant photo | Any member                                    |
| Delete               | Boss                                          |
| Update               | Nobody; photos are never overwritten          |

**RLS test suite** (`supabase/tests/rls.test.ts`, bun:test, runs against the local Supabase stack)

- Setup: two companies plus one worker.
- Company B can't see or write any of company A's rows or files.
- Company B can't attach a record to company A's parent row; the composite keys reject it.
- A worker can't:
  - read offers or the terms tables;
  - update tasks directly;
  - change their own role or user id;
  - upload under another worker's task;
  - complete someone else's task.
- Plant codes don't collide when added in parallel.
- `create_company` can't run twice for the same user.
- Signed-in users can't write `weather_cache`.
- The last boss can't be removed.

**CI:** `.github/workflows/ci.yml` runs `bun test`, the build (with placeholder `VITE_*` values), lint, and `supabase start` followed by `test:rls`.

**Docs:** rewrite `supabase/README.md` for the CLI workflow.

## PR D1: the cut-over to the new project

**Data layer**

- `src/lib/supabase/types.ts`: regenerate with `bun run db:types`. This replaces the hand-written file, and relationships get typed.
- Env names: `VITE_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`, since new projects use the new key format. Update `env.ts`, `server.ts`, the build guard in `vite.config.ts`, and `.env.example`.
- `src/lib/types.ts`:
  - Add `Plant.code`.
  - Add `Worker.email`, `Worker.appRole` and `Worker.access` (`none`, `invited` or `active`).
  - Add a `Viewer` type.
  - Make `monthlyValue` and `contractUntil` optional, because workers don't get them.
- **Delete** `src/lib/api/ids.ts` and `src/lib/api/lookups.ts`. IDs, company and plant codes now come from the database, and names come through embedded selects.
- `src/lib/api/mappers.ts`:
  - `toProject` rebuilds `workerIds` and `leadWorkerId` from the crew embed, so `Project` keeps its shape and the planner and dialogs are untouched.
  - Terms are merged in when present.
- `src/lib/api/{clients,workers,projects,plants,tasks,care}.ts`:
  - Validate every id with `z.string().uuid()`.
  - `tasks.ts` gets real zod validators; today they're identity functions.
  - Replace `.order("id")` (6 places) with `name`, `code` or `created_at`.
  - Remove the missing-column fallbacks written for migrations 0003 and 0004.
  - `saveSite` calls `set_project_crew` and upserts the terms.
  - `saveWorker` accepts an email.
  - Add `updateMyProfile`.

**Auth**

- **New `src/lib/auth/middleware.ts`:** `authed` puts the database client and viewer into context; `bossOnly` builds on it and rejects non-bosses with `FORBIDDEN`.
  - `bossOnly`: office writes, offers, `explainPlan`, geocoding and `clientReport`.
  - `authed`: reads and worker actions.
  - Check the build output to confirm the middleware's server code doesn't reach the browser. If it does, fall back to explicit `requireViewer()` calls.
- **Full viewer:** `getViewer` returns `{ userId, email, workerId, companyId, companyName, role, name }`. `worker: null` means the user still needs onboarding.
- **Extend `access.ts`:**
  - No worker row → `/onboarding`.
  - A worker on an office page → `/mobile`.
  - A signed-in user on `/login` or `/signup` → their home page.
- **New routes:**
  - `signup.tsx`: email, password, your name, company name.
  - `onboarding.tsx`: calls `create_company`.
  - `auth.confirm.tsx`: the user presses a button that calls `verifyOtp`, then goes to the validated `next` path. It never verifies on page load, because email link scanners would use up the token.

**Photos**

- `src/lib/server/photos.ts`: storage paths start with the company id, and `completeTask` becomes a single `complete_task` database call.
- `src/lib/server/plant-photos.ts`: sign `<company>/plants/<uuid>`; `photo_path` is saved with the plant, so delete `attachPlantPhoto`.
- `mobile.new-plant.tsx`: pass the photo path into `savePlant`.
- `photos.functions.ts`, `plants.functions.ts` and `reports.functions.ts` use the user's own client, so RLS applies. The service-role key is now used only for the weather cache and, in D2, invites.
- `plan.functions.ts` and `outreach.functions.ts`: boss-only, plus a `bump_usage` daily limit.

**Worker app**

- **Delete** `src/lib/worker-store.ts`. New `src/hooks/use-viewer.ts` provides `useViewer`, `useCurrentWorker` and `useWorkerProjects`; update the 4 mobile routes to use it.
- `mobile.settings.tsx`: remove the "Who is using this phone?" picker; add an account section with sign-out; language changes go through `updateMyProfile`.
- `mobile.tsx`: only bosses see the "Full site" link.

**Office**

- `workers.tsx`: remove the "Open in worker app" button that let you act as any worker; show each worker's access status.
- `AppShell.tsx`: the user menu shows name, company and sign-out.
- Show `plant.code` instead of `plant.id` in `PlantTable.tsx` (107, 191), `LeafletMap.tsx:237` and `PlantDialog.tsx:122`.
- `projects_.$projectId.tsx` and `clients_.$clientId.report.tsx`: an invalid id in the URL shows "not found".

## PR D2: worker invites and password reset

- **New `src/lib/server/invites.ts`** (server-only, the one other place the service-role key is used):
  - `inviteWorker(workerId)`:
    - Checks the caller is a boss, and reads the worker through the caller's own client, so RLS proves same company.
    - Checks the worker has an email and no account yet.
    - Sends `auth.admin.inviteUserByEmail`, then sets `workers.user_id` and `invited_at`.
  - `resendInvite`.
  - `revokeAccess`: archives the worker and deletes their auth user.
  - An email that already has an account gets a clear error: one account belongs to one company.
- `auth.functions.ts`: add `requestPasswordReset` and `updatePassword`.
- **New routes:** `auth.set-password.tsx` and `forgot-password.tsx`. `auth.confirm.tsx` handles the `invite` and `recovery` link types.
- `WorkerDialog.tsx`: add an email field.
- `workers.tsx`: Invite, Resend and Remove access buttons, plus a status badge.

## PR E: hardening and docs

- **Playwright end-to-end tests** against the local stack, with Mailpit catching the emails, also run in CI:
  - signup → confirm → onboarding;
  - creating records;
  - inviting a worker → the worker sets a password → completes a task;
  - password reset.
- **Docs:** rewrite `docs/HANDOFF.md`, `docs/deploy-vercel.md` and the README. Delete or archive `docs/TODO.md` and `docs/backend-tasks.md`.
- **Required before production** (the D1 review): a CAPTCHA on signup (Cloudflare Turnstile, supported by Supabase). Open signup otherwise lets anyone send confirmation emails to any address and create accounts that each get their own AI allowance.
- **Optional:** use `companies.timezone` instead of the hardcoded `COMPANY_TZ` in `src/lib/weather.ts`.
- **Record the next data-model change:** a task row is a repeating weekly template but also stores `status`, so it needs per-date occurrences. Out of scope here.

---

## Manual steps for the cut-over (you do these; I'll give exact values)

**Before merging D1:**

1. Create the production Supabase project in `eu-west-2`, the same region as today.
2. Run `supabase link` and then `supabase db push`, with no seed.
3. In Auth settings:
   - **Site URL:** the production domain.
   - **Allowed redirect URLs:** production, the Vercel preview wildcard, and `http://localhost:8080/**`.
   - **Email confirmation:** on.
   - **Minimum password length:** 10.
   - **Email templates:** upload them.
4. **Set up custom SMTP (required).** Supabase's built-in sender only emails your own team, so signup and invites fail without it. Use Resend, Postmark or SES, with SPF and DKIM set up, and raise the auth email rate limit.
5. Tag the last commit before D1 as `demo-final`. Its Vercel deployment keeps the demo env vars and stays up as the live demo.
6. Point the D1 branch's Vercel Preview at the new project and test it.

**Merging:**

1. Switch the Vercel Production env vars to the new project.
2. Merge D1.
3. Update the env vars in Lovable too.
4. Before merging D2, make sure the invite and recovery email templates are live.

## Main risks

- **Server-only imports.** Every new server-function or middleware file must import server-only modules inside the handler. Otherwise TanStack swaps them for stubs in the browser and the page breaks while server rendering still looks fine.
- **Auth pages must never be cached** (`no-store`).
- **Invalid UUIDs** must return a 400 or "not found", not a Postgres error.
- **Lovable AI edits** landing on `main` can bring back old patterns, such as mock imports and `.order("id")`. Regenerate `routeTree.gen.ts` rather than hand-merging it.
- **After the cut-over,** `main` no longer works against the demo project. The only live demo is the pinned `demo-final` deployment.

## Verification

**Every PR**

- `bun test` (104 pass today).
- `bun run build`, and `VERCEL=1 bun run build`.
- Lint.
- `bun test --coverage`, with at least 80% on new modules.
- Click through the Vercel preview.

**By phase**

| Phase | Checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1    | Grep for `rootline-data`, `plant-care`, `MOCK_TODAY`, `2026-09-21`, `hours_this_month` and `bumpClientCounter` finds nothing. The dashboard, clients page and schedule show calculated numbers.                                                                                                                                                                                                                                                                                                                              |
| A2    | Every route and dialog still renders, and `bun run lint` finishes.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| B     | 1. `curl` a server function without a cookie: it redirects instead of returning data. <br>2. Signed out, every route goes to `/login`. <br>3. Log in and out from both apps. <br>4. A hard refresh, and waiting past token expiry, keep you signed in. <br>5. Responses carry the `no-store` header.                                                                                                                                                                                                                         |
| C     | `bun run db:start`, then `supabase db reset`, then `bun run test:rls` all pass. `supabase db lint` is clean. The app still runs against the demo project.                                                                                                                                                                                                                                                                                                                                                                    |
| D1    | Against local Supabase: <br>1. Sign up, confirm the email through Mailpit (localhost:54324), then onboard. <br>2. Create a client, a site with crew, a plant (it gets `PL-0001`) and a task. <br>3. Approve the plan. <br>4. Complete the task with a photo from `/mobile`. <br>5. Open the client report. <br>6. A second signup sees none of the first company's data. <br>7. `getAdminClient` appears only in `weather.functions.ts` and `server/invites.ts`. <br><br>Then repeat on the Vercel preview, then production. |
| D2    | 1. The boss invites a worker. <br>2. The worker sets a password and lands on `/mobile`, seeing only their jobs. <br>3. The worker is redirected away from `/`. <br>4. They can complete their own task but not someone else's. <br>5. After the boss removes access, the worker is sent to `/login`. <br>6. Password reset works.                                                                                                                                                                                            |
| E     | Playwright runs green locally and in CI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
