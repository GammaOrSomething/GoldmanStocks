# Demo → production migration log

This is the running record of turning the hackathon demo into a real product: what was decided, what
each change did, what you need to do by hand, and what comes next. It is updated with every PR.

- **Started:** 23 Sep 2026
- **Current step:** PR D1, switch the app to the new project (A1–C are done). **Start at [Pick up here](#-pick-up-here-next-session).**

## ▶ Pick up here (next session)

_Updated at the end of the second 23 Sep 2026 session._

**Where the code is.** Everything is on local branches, not pushed; that's your choice until you say otherwise. Each branch is stacked on the one before, so check out the last one to get everything:

| Branch                   | Contains      | State                                                                     |
| ------------------------ | ------------- | ------------------------------------------------------------------------- |
| `chore/remove-demo-data` | A1            | done                                                                      |
| `chore/remove-dead-code` | A2 + this doc | done                                                                      |
| `feat/real-login`        | B             | done, reviewed, fixes in                                                  |
| `feat/production-schema` | C             | done; security review fixed and re-reviewed; 86 database checks pass      |
| `feat/cut-over`          | D1, started   | **in progress**: data layer, roles and signup pages done; all checks pass |

**To resume D1** (`git checkout feat/cut-over`):

1. **Done in D1 so far:**
   - `src/lib/supabase/types.ts`, hand-written for the new schema, since generating it needs Docker.
   - `src/lib/types.ts`: `Plant.code`, and `Worker.email` / `appRole` / `hasLogin` / `invitedAt`.
   - `src/lib/api/mappers.ts`, with tests.
   - **The data layer** (`src/lib/api/{clients,workers,projects,plants,tasks}.ts`):
     - client numbers come from `client_stats`;
     - crews come from `project_workers`, and money from the terms tables;
     - the database makes ids and plant codes, so `ids.ts` is gone;
     - task validation and row mapping live in `task-rows.ts`, with tests;
     - skipping or reopening a task goes through `set_task_status`;
     - lists are ordered by name, code or date;
     - a malformed id reads as "not found".
   - Fixtures carry the new fields.
   - **Session and roles:**
     - the viewer carries the company and role (`Viewer.member`, null until onboarding);
     - `requireBoss()` guards office writes, offers, the AI, address search and the report;
     - the AI calls spend the daily allowance (`src/lib/api/usage.ts`);
     - `access.ts` sends a person without a company to `/onboarding`, keeps a worker in `/mobile`, and lets anyone open `/signup`, with tests.
   - **New pages:** `/signup`, `/onboarding` (calls `create_company`) and `/auth/confirm`, which verifies only when the button is pressed. They share `src/components/AuthCard.tsx`.
   - 153 unit tests, typecheck, lint and build pass.
2. **Next, in this order:**
   1. **Photos:**
      - `src/lib/server/photos.ts`: paths become `<company>/tasks/<task>/…`, and completion calls the `complete_task` function.
      - `plant-photos.ts`: `<company>/plants/<uuid>`, saved as `plants.photo_path`; delete `attachPlantPhoto`.
      - Switch the photo, plant and report functions from the admin key to the user's own session.
      - The weather cache uses the admin client.
   2. **Worker app:**
      - Replace `src/lib/worker-store.ts` with the signed-in worker (`src/hooks/use-viewer.ts`).
      - Remove the "whose jobs to show" picker.
      - Language changes go through `update_my_profile` (the server function `updateMyLanguage` exists).
      - Only bosses see "Full site".
   3. **Office:**
      - Remove "Open in worker app" from `/workers`, and show the email and login status.
      - Show `plant.code` instead of the id in `PlantTable`, `LeafletMap` and `PlantDialog`.
      - A bad id in a URL shows "not found" (the server side already returns null).
   4. **Docs:** `.env.example` and `docs/deploy-vercel.md`. Keep the variable names; they now hold the new project's keys.
3. **Also still to do:**
   - **Remove access (D2):** it must clear `workers.user_id`, not just archive the worker.
   - **Weekly tasks keep their status from week to week.** Once a weekly task is proven, it shows as done in every later week. The app did this before too. The database now limits proof to one per week, so a per-week status is the natural follow-up; decide it in D1's worker-app step.
   - **Check on real Supabase (CI):** that `postgres` has BYPASSRLS, which `complete_task` needs to read `storage.objects`; set `secure_password_change = true` in `config.toml`.
   - **Invite and reset links** point to `/auth/set-password`, which D2 adds. Until then they end on a missing page.
   - **Office screens don't hide boss-only buttons from workers yet.** Workers are redirected to `/mobile` anyway, and the server refuses them.
4. **Then:** review, update this log, and commit. D2 (invites and password reset) and E follow; see [Next steps](#next-steps).

**Checks to run:**

- `bun run test`
- `bunx tsc --noEmit -p .`
- `bun run lint`
- `bun run build`
- `bun run test:rls -- --stub` (no Docker needed; uses the local Postgres)

With Docker: `bun run db:start`, then `bun run test:rls`, then run the app against the local Supabase for the end-to-end check.

**Blocked on you:** see [Your checklist](#your-checklist-things-only-you-can-do). The most important items:

- turn off public sign-ups on the demo project;
- rotate the leaked keys;
- install Docker, or accept that D1 can only be fully tested against the new Supabase project;
- set up SMTP before D1/D2 go live.

## Where we're going

The demo has no real login. Every visitor is silently signed in, on the server, as one shared "demo
boss" account. The worker app's "who am I" is a name picked from a list. The database lets any
signed-in user read and write every row. The data came from a 700-line mock file.

**The target:**

| Decision               | What it means                                                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open signup            | Anyone can sign up. Signing up creates a new company, and that person is its boss.                                                                                                                                   |
| Workers join by invite | The boss adds a worker with an email address. The worker gets an invite, sets a password once and stays signed in on their phone.                                                                                    |
| New Supabase project   | Production gets a fresh project built from clean migrations, with no seed data. The current project stays as the demo database.                                                                                      |
| Production schema      | UUID ids, with a readable per-company plant code (`PL-0001`). `company_id` on every table. Proper worker-to-site links. Counts are calculated, not stored. Row-level security by company and role. Storage policies. |
| Money is boss-only     | Monthly values and contract dates live in boss-only tables, and the database enforces it.                                                                                                                            |

**Ground rules:**

- Each step is its own branch and PR. `main` stays deployable, because Lovable syncs from it.
- No force-pushes, and no rewriting pushed history.
- Branches stay local until you say to push.

## Progress

| Step | What                                                              | State       | Branch                                  |
| ---- | ----------------------------------------------------------------- | ----------- | --------------------------------------- |
| A1   | Remove demo data and fake numbers                                 | Done        | `chore/remove-demo-data`                |
| A2   | Remove dead code and template leftovers                           | Done        | `chore/remove-dead-code` (on top of A1) |
| B    | Real login (still on the demo database)                           | Done        | `feat/real-login` (on top of A2)        |
| C    | New database schema, Supabase CLI, security tests                 | Done        | `feat/production-schema` (on top of B)  |
| D1   | Switch the app to the new project: signup, roles, company scoping | In progress |                                         |
| D2   | Worker invites and password reset                                 | Not started |                                         |
| E    | End-to-end tests, CAPTCHA, final docs                             | Not started |                                         |

---

### A1: remove demo data and fake numbers

**Why:** the app read everything from the database already, but the mock dataset, seed script and
some hardcoded values were still in the code, and several screens showed numbers that were fixed or
made up.

**What changed:**

- **Deleted:**
  - the mock data file (`src/lib/rootline-data.ts`);
  - the seed-only helpers (`src/lib/plant-care.ts`);
  - the seed script and the one-off coordinate-fix script (`scripts/`);
  - the `seed` command.
- **Tests** now use a small, neutral fixture: `src/lib/__fixtures__/week.ts`. The planner and outreach tests still assert the same behaviour.
- **Care intervals** (days between visits per plant kind) moved to `src/lib/care-intervals.ts`.
- **Repeat-work offers** (`src/lib/outreach.ts`):
  - Before: a plant with no care history was treated as last cared for on 1 Sep 2026, so it always looked overdue and produced a false offer.
  - Now: it uses the plant's scheduled next care, or is skipped.
- **Client numbers are calculated** (`src/lib/client-stats.ts`, used by `listClients`):
  - Sites and plants are counted from the actual records. Before, they were stored counters that only ever went up.
  - "Hours this month" is the durations of jobs proven with a photo this month, counted once per job per day. Before, it was a fixed number from the seed.
- **Fake UI removed:**
  - the always-on "Live" badge and the static "AI plan ready" sidebar card;
  - "Sent to crew" now reads "Approved" (nothing is sent);
  - "plants under care" counts real plants;
  - the schedule no longer falls back to 21 Sep 2026.

**Review:** a code-review pass found no blocking bugs. Fixed:

- the `/clients` hours bar divided by zero when no client had hours yet;
- docs still pointed at deleted scripts.

One finding is deferred to C/D1 (see [Known limitations](#known-limitations)).

**Verified:**

- 111 tests pass (7 new);
- typecheck, lint and production build are clean;
- every page renders against the demo database.

### A2: remove dead code and template leftovers

**What changed:**

- **Unused UI:** deleted 28 UI components and a hook that nothing imported, plus the 25 packages only they used. Kept `dropdown-menu`, `avatar`, `alert` and `separator` for the login UI.
- **Lint:** `bun run lint` was scanning build output. It took about 10 minutes and reported 93,000 errors. It now ignores build folders and finishes in 2 seconds with 0 errors. The template files it flagged were formatted.
- **Template leftovers:**
  - replaced the template README;
  - renamed the package to `goldman-stocks`;
  - removed an obsolete Lovable dev workaround (`LOVABLE_PREVIEW_HOST`; the logo is bundled now);
  - removed a stale `.gitignore` entry;
  - removed `scripts/` from `tsconfig.json`;
  - switched to a plain `twitter:card`, since there's no share image.

**Verified:**

- 111 tests pass;
- lint shows 0 errors (2 harmless warnings from standard UI files);
- the build passes;
- all 11 pages return 200 from the dev server.

### B: real login

**Why:** anyone on the internet who opened the site was silently signed in as the demo boss and could read and change every record. This change removes that before anything else.

**What changed:**

- **No more automatic sign-in.** `getAuthedClient()` (`src/lib/api/session.ts`) now uses the caller's own session cookie. With no session, it sends them to `/login` instead of returning data. The `DEMO_BOSS_*` variables are no longer read.
- **Login page** at `/login` (`src/routes/login.tsx`). Email and password, works at phone width, and returns you to the page you were trying to open.
- **One guard for every page** (`src/routes/__root.tsx`, with the rules in `src/lib/auth/access.ts`):
  - Signed-out visitors go to `/login?redirect=…`.
  - A signed-in user on `/login` goes on to where they were heading.
  - The `redirect` value is checked, so a crafted link can't send people to another site.
- **Session expiry mid-use.** A data request that finds the session gone clears the cached data and goes to the login page (`src/router.tsx`).
- **Sign-out** in the office header's account menu (`src/components/UserMenu.tsx`) and in worker app → Settings.
- **Every server function now needs a session.** That includes the photo, plant-photo, client-report, AI plan explanation and address lookup functions, which previously ran for anyone.
- **Nothing is cached.** Every page and data response is marked `Cache-Control: private, no-store`, so no browser or CDN can show one person's page to another.
- **Redirects pass through the error handler** (`src/start.ts`) instead of becoming a 500 page.

**Decision made along the way: sign-in happens in the browser, not on the server.** The plan said to sign in through a server function. But Supabase limits sign-in attempts per IP address, and every server-side sign-in would come from our server's single address, so a few typos across a company could lock everyone out for a while. Signing in from the browser keeps each person on their own address. The session cookie is the same either way, so the server reads it exactly as before.

**Review:** a code-review pass found one serious bug, fixed before moving on:

- **Open redirect.** A crafted link like `/login?redirect=/<tab>/evil.com` passed the check, and browsers strip tabs, so a signed-in user would be sent to another site. The check now refuses any control character or space and parses the target as a URL. There are regression tests for tab, newline and carriage return, and the dev server now answers these links with a redirect to `/`.

Also fixed:

- **Cached sign-in state.** A remembered "signed in" answer could bounce a user whose session had ended off the login page and back to `/`. The login page now always asks the server again.
- **Return page kept.** When several data requests fail at once, the first one's return page is kept instead of being overwritten.
- **Cached page data cleared.** Signing in or out now also clears the router's cached page data. Otherwise, from D1 on, the next user on the same browser could briefly see the previous user's pages.
- **Network errors reported as network errors,** not as "wrong password" or "signed out".
- **Offline phones.** The sign-in check fails fast and doesn't wait for the phone to think it's online.

**What it does not do yet:** there are no roles and no company scoping. Any signed-in account still sees everything in the demo database; that's D1. The worker app still has the "whose jobs to show" picker until D1 links accounts to workers.

**Verified:**

- 123 tests pass (12 new, for the access rules), plus typecheck, lint and production build.
- **Signed out:**
  - Every private page answers `307 → /login?redirect=<that page>`.
  - `/login` itself loads.
  - Calling a data function directly returns only a redirect, no data.
  - Cross-site calls are refused (403).
- **Signed in:**
  - Pages load with the account menu, and the client list returns real calculated numbers.
  - `/login?redirect=/schedule` goes on to `/schedule`.
  - `/login?redirect=//evil.com` goes to `/`.
- Every response carries `Cache-Control: private, no-store`.

### C: new database schema

**Why:** the demo schema can't hold more than one company safely. It uses text ids like `c1` that would clash between companies, has no `company_id` on most tables, and gives every signed-in user full access. The production database is built fresh from a new baseline instead. Nothing in the app changes yet; D1 switches the app over.

**What changed** (everything is under `supabase/`; [`supabase/README.md`](../../supabase/README.md) explains it in full):

- **Four new migrations** in `supabase/migrations/`:
  - **core:** types and tables;
  - **functions:** triggers and the functions the app calls;
  - **rls:** who can read and write what;
  - **storage:** the photo bucket.
- **The four demo migrations** moved to `supabase/legacy-demo/`, frozen, with a note.
- **Every table carries its company:**
  - `company_id` fills itself in from the signed-in user.
  - Links between rows include the company, so a row can't point at another company's data even if someone guesses its id.
- **Readable plant codes:** plants get `PL-0001`, `PL-0002`, … per company. Codes are handed out safely when two plants are added at once, and never change.
- **Money is boss-only:** monthly values and contract dates moved to `client_terms` and `project_terms`, which only a boss can read.
- **Crews:** a real `project_workers` table (site, worker, lead) replaces the list of ids stored on the site.
- **Workers write through narrow database functions**, never directly: finish a task with a photo, skip or un-skip their own job, change their language. They can also register a plant at a site they work on. That keeps someone with a worker login from rewriting records through the API.
- **Rules a policy can't express** are enforced by triggers:
  - Only an invitation, run on the server, can link a login to a worker.
  - A company always keeps at least one boss.
- **Client numbers are calculated in the database** (`client_stats`), which fixes the 1,000-row limitation from A1 once D1 uses it.
- **Photos:** one private bucket with a folder per company. Workers can only upload proof for their own tasks.
- **Tooling:**
  - The Supabase CLI is a dev dependency.
  - `supabase/config.toml` holds local settings: email confirmation on, 10-character passwords with letters and digits, no seed.
  - Email templates for confirm, invite and reset.
  - New scripts: `db:start`, `db:reset`, `db:types`, `test:rls`, and `test`.
  - CI (`.github/workflows/ci.yml`) runs the tests, lint and build, and the database security tests on a real local Supabase.

**Two things were added that the plan didn't have:**

- **`set_task_status`:** the worker app lets workers skip and un-skip their own jobs, so they need a narrow way to do it.
- **Photo retries:** finishing a task with the same photo twice is now a harmless no-op. The tests caught a first version that added a second care-history entry.

**Verified:**

- **48 security checks pass** (`supabase/tests/rls.sql`). They cover:
  - company B sees and changes nothing of company A's data, photos included;
  - a worker can't see money or offers, can't change tasks, roles or clients directly, and can't upload or complete someone else's task;
  - plant codes;
  - signup rules;
  - the last-boss rule;
  - the weather cache;
  - the functions above.
- **Where they ran:** this machine has no Docker, so the checks ran on the local PostgreSQL 17 against a small stand-in for Supabase's `auth` and `storage` parts (`bun run test:rls -- --stub`). CI runs the same checks against a real local Supabase, but that job hasn't run yet, because the branch hasn't been pushed.
- The app's 124 tests, lint and build still pass. The app still runs on the demo database.

**Security review fixes (second session, 23 Sep 2026).** A review of C found no way to reach another company's data. It found ways to fake worked hours and a few loose ends. All are fixed in the migrations themselves, since they have never been applied anywhere. A second review then checked the fixes.

- **Worked hours can't be faked.** `complete_task` holds the photo time and work date to the company's today (±1 day). A weekly task gets one proof per week, and a one-off task only one. Only a boss can reopen a finished one-off task. Before this, one client's hours could be pushed from 1.5 to 30.
- **AI limits live in the database** (`private.usage_limits`: `ai_plan` and `ai_outreach`, 50 a day each). Before, the caller chose the limit. `bump_usage` is boss-only now.
- **Server vs user is read from the session's database role, not the login token.** A token missing its role claim no longer slips past the worker rules.
- **Photo paths must be plain image file names.** No `..`, no empty names, no other file types.
- **A boss can change only a company's name and time zone.** The time zone must be a real one.
- **Adding a plant under another company fails at once.** It no longer locks that company's row or reveals that it exists.
- **Crews:** saving a crew without a lead works, an unknown site is refused, and a crew is capped at 100.
- **Length limits** on every free-text column.
- **Grants:**
  - signed-out visitors can't reach any table or function;
  - signed-in users can't `TRUNCATE`, which would skip row-level security;
  - new functions aren't executable by everyone by default.
- **86 security checks pass** (38 new, one per fix).

---

## Your checklist (things only you can do)

**Now, before anything is merged**

- [ ] **Turn off public sign-ups on the demo project:** Supabase → Authentication → Sign In / Providers → "Allow new users to sign up" off. With it on, anyone can create an account with the public key in the web app, and until D1 every account can read and change everything. Create logins yourself (Authentication → Add user) for anyone who needs the demo.

- [ ] **Rotate the leaked credentials in the demo Supabase project:** database password, anon and service-role keys, and the OpenAI key. `docs/TODO.md` §7 says they were pasted into AI chats. Update them in `.env`, Vercel and Lovable, then redeploy.
- [ ] Delete the stray auth user `kristers-local@rootline.demo` (Supabase → Authentication).

**After B is merged**

- [ ] Remove `DEMO_BOSS_EMAIL` and `DEMO_BOSS_PASSWORD` from Vercel and Lovable (and your `.env`, once you no longer need them for testing). That account becomes an ordinary login for whoever demos the app.
- [ ] Try it in a real browser:
  1. Open the site signed out: you land on the login page.
  2. Sign in with the demo account.
  3. Sign out from the office header menu, then from worker app → Settings.
- [ ] Try signing in inside the Lovable editor's preview. Login cookies may not be sent inside its frame, which would make the login page keep coming back. If that happens, open the preview in its own tab; the deployed site isn't affected.

**Before D1 (the switch to the new database)**

- [ ] Install Docker Desktop, or tell me to keep using the no-Docker test setup. D1 needs a local Supabase to try signup and the worker flow end to end, and to regenerate the database types.

- [ ] Create the production Supabase project in `eu-west-2`, the same region as today.
- [ ] Set up custom email sending (SMTP), e.g. Resend, Postmark or SES, with SPF/DKIM on your domain. **Required:** Supabase's built-in sender only emails your own team members, so signup confirmations and worker invites won't arrive without it.
- [ ] Auth settings:
  - Site URL = the production domain.
  - Redirect URLs: production, the Vercel preview wildcard, and `http://localhost:8080/**`.
  - Email confirmation on.
  - Minimum password length 10.
- [ ] Tag the last pre-D1 commit `demo-final`. Its Vercel deployment stays up as the live demo.

---

## Next steps

1. **D1: switch to the new project**
   - Signup and a company-setup step.
   - Boss vs worker roles.
   - Everything scoped to the company.
   - Photos stored per company.
   - The worker app uses the signed-in worker instead of a picker.
2. **D2: worker invites and password reset.**
3. **E: end-to-end tests and final docs.**

The full technical plan (schema, access rules, file-by-file changes, risks) is in
[technical-plan/README.md](technical-plan/README.md). This file tracks what actually happened.

## Known limitations

- **Row limit on client counts:**
  - The problem: client counts are calculated in the app from full table reads, and Supabase returns at most 1,000 rows per query. Past 1,000 plants or monthly proof photos, the counts would silently come out low.
  - Now: harmless at demo size.
  - Fix: the `client_stats` database function (added in C). The app switches to it in D1.
- **Hours follow the current task:** client hours use each task's current duration and site. Editing a task changes hours already counted this month.
- **Until D1, a signed-in account can see everything.** Login is real, but there are no roles or company scoping yet. The client report and photo functions check that you're signed in, not which company you belong to. That's safe only while the demo database holds a single company.
- **Tasks double as weekly templates:** a task is a repeating weekly template, but its done/approved status is stored on the template itself. That needs per-date task occurrences, which is the next data-model change after this migration.
