# Demo → production migration log

This is the running record of turning the hackathon demo into a real product: what was decided, what
each change did, what you need to do by hand, and what comes next. It is updated with every PR.

- **Started:** 23 Sep 2026
- **Current step:** staging on the production Supabase project (A1–D2 are done), then PR E. **Start at [Pick up here](#-pick-up-here-next-session).**

## ▶ Pick up here (next session)

_Updated 29 Sep 2026._

**Where the code is.** Each branch is stacked on the one before. Only the last one is pushed: to GitHub as **`claude-101`** (your name for it; git allows no spaces), never to `main`. Work from here on continues on `claude-101`.

| Branch                   | Contains      | State                                                                |
| ------------------------ | ------------- | -------------------------------------------------------------------- |
| `chore/remove-demo-data` | A1            | done                                                                 |
| `chore/remove-dead-code` | A2 + this doc | done                                                                 |
| `feat/real-login`        | B             | done, reviewed, fixes in                                             |
| `feat/production-schema` | C             | done; security review fixed and re-reviewed; 86 database checks pass |
| `feat/cut-over`          | D1            | done, reviewed                                                       |
| `feat/worker-invites`    | D2            | **done**, reviewed; all checks pass; pushed as `claude-101`          |

**Next: staging.** Only you sign up; public signup waits for the CAPTCHA. The code is on GitHub as `claude-101`, never `main`, so Lovable and the demo are untouched. CI runs on that branch, including the database tests on a real Supabase.

1. ~~Create the Supabase project~~ **Done:** `GoldmanStocks-production`, ref `wjhrdbrhoysdtppqaapm`, in `eu-west-1` (Ireland, not London). Vercel's function moved to `dub1` (Dublin) to sit next to it. The demo stays on its own project; reusing it would have meant wiping it and breaking `goldman-stocks.vercel.app` and Lovable's preview.
   - **You, still:** add a second address of yours to _this_ project's organisation (it's a different one from the demo's). The built-in email only reaches members, and you'll need it for the test worker.
2. ~~Schema~~ **Done** (29 Sep 2026; see [Staging](#staging-on-the-production-project)).
3. **You, Authentication settings:**
   - Site URL = the branch's stable Vercel address, `<project>-git-claude-101-<team>.vercel.app`. The email links are built from it.
   - Redirect URLs: that address and `http://localhost:8080/**`.
   - Confirm email on; minimum password 10 with letters and digits; secure password change on.
   - Paste the three templates from `supabase/templates/`.
4. **You, Vercel:** your own Vercel project. The existing `goldman-stocks.vercel.app` is on an account you can't reach, so leave it alone; it keeps showing the demo.
   - Import this repo (Framework "Other", no output directory; `vercel.json` sets the rest). That needs Vercel's GitHub app on `mrkikuts/GoldmanStocks`, which only the repo's owner can install. If you can't, I deploy from this machine with `bunx vercel link` and `bunx vercel deploy` instead.
   - Preview variables scoped to the `claude-101` branch:
     - `VITE_SUPABASE_URL`;
     - `VITE_SUPABASE_ANON_KEY` (the publishable key);
     - `SUPABASE_SERVICE_ROLE_KEY` (the secret key);
     - a **new** `OPENAI_API_KEY`.
   - Then redeploy the branch.
5. **Together, on the preview** (laptop plus phone):
   1. Sign up, confirm, then onboarding.
   2. A client, a site, and a worker with your second address.
   3. Invite them; on the phone, open the link, set a password, then join.
   4. The worker finishes a job with a photo.
   5. Reset a password.
   6. Resend, then cancel an invitation.
   7. Remove access, including for a worker with photos.
   8. The frame headers (`curl -sI`).
   - Also confirm the sign-in method names for link sessions, and whether the email templates escape data.

**Before public signup:**

- **Email:** Supabase's built-in sender won't do. There's no domain, so: **Gmail SMTP with an app password** (needs 2-step verification on the Google account; about 500 a day; `smtp.gmail.com`, port 587). Brevo (300 a day) is the fallback. Resend needs a domain.
- **CAPTCHA:** Cloudflare Turnstile (free, works on `*.vercel.app`), then step E builds it into signup, login and forgot-password.
- **Before charging:** Vercel Pro (Hobby is non-commercial), Supabase Pro (backups, no pausing) and Open-Meteo's commercial plan.
- **Launch without merging:** in your Vercel project, set Production Branch = `claude-101`, then the Production variables, the Site URL and redirect URLs, and the Turnstile hostname for the production address. `main` feeds Lovable and probably the `goldman-stocks.vercel.app` demo, and after the cut-over it no longer works against the demo database, so merging to `main` is a separate decision. Tag `96ba21a` as `demo-final` first.

**Then E** ([plan](technical-plan/README.md#pr-e-hardening-and-docs)):

- Playwright end-to-end tests (need Docker);
- the CAPTCHA;
- the docs rewrite;
- the company's own time zone.

Still open from before:

- office screens don't hide boss-only buttons from workers (they're redirected anyway);
- "Skipped" carries over on weekly tasks;
- orphaned plant photos.

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
- set up SMTP before D1/D2 go live;
- **a signup CAPTCHA is required before production** (see the review below); I need your Cloudflare Turnstile keys to build it.

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
| D1   | Switch the app to the new project: signup, roles, company scoping | Done        | `feat/cut-over` (on top of C)           |
| D2   | Worker invites and password reset                                 | Done        | `feat/worker-invites` (on top of D1)    |
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

### Photos, in D1

**What changed:**

- **Task proof** (`src/lib/server/photos.ts`):
  - Upload paths are `<company>/tasks/<task>/<uuid>.<ext>`. The upload URL is signed with the worker's own session, so the storage policy refuses a task that isn't theirs.
  - Finishing a task is one `complete_task` database call, which checks everything in one transaction. The app's own check that the photo sits in this company's folder for this task stays, so a wrong path fails before any request.
  - The unused `getTaskPhotoUrl` is gone; the report signs photos in batches.
- **Plant pictures** (`src/lib/server/plant-photos.ts`):
  - Uploaded to `<company>/plants/<uuid>.<ext>`.
  - `savePlant` takes the path as `photoPath` and stores it in the same insert. It has to: only a boss may change a plant afterwards, so the old "save, then attach the photo" step would fail for a worker.
  - `savePlant` also returns the plant's code, so the worker app's "registered as" message shows `PL-0001` rather than a uuid.
  - `getPlantPhotoUrl` reads `plants.photo_path` instead of listing the folder.
- **Client report** (`src/lib/server/reports.ts`):
  - Runs on the boss's own session.
  - It still read `tasks.site`, which is `zone` in the new schema, so it would have failed on the new project. Its client is now typed against the schema, so the compiler catches that kind of mistake.
  - A malformed client id in the URL now shows "not found".
- **Weather:** the shared forecast cache uses the admin client, since signed-in users can't reach `weather_cache`. The sites are still read on the user's session.

**Verified:** 161 unit tests (8 new: the `complete_task` call and its errors, company and task folders, uuid ids, plant photo paths, the report's bad id), typecheck, lint, build, and the 86 database checks.

### Review of D1 so far

**Scope:** everything on `feat/cut-over` up to the photos step (data layer, roles, signup/onboarding/confirm pages, photos), checked for security holes and bugs.

**What held up:**

- No way was found to read or change another company's data. Every server function runs on the caller's own session, links between rows carry the company, `requireBoss` guards office work, and the database refuses a worker's writes regardless.
- Photo paths are checked in the app, in `complete_task` and in the storage policies.
- The hand-written `types.ts` matches the migrations column for column, and every function signature.

**Fixed:**

- **HIGH: the AI features could run up the OpenAI bill.** Signup is open, so anyone can become a boss and get 50 + 50 AI calls a day. The plan explainer accepted input of any size and passed free text through, so it worked as a general chatbot on our key.
  - Every field sent to `explainPlan` and `draftOffers` is now bounded (lengths, counts, ranges, dates).
  - The whole request is capped at 60,000 characters (`MAX_PROMPT_CHARS` in `src/lib/server/llm.server.ts`).
  - Both calls cap the reply length (`max_completion_tokens`).
  - A site with many plants lists the first 10 and counts the rest, so a big site stays cheap.
- **Bug: drafting offers could fail after the AI call was paid for.** The rows were inserted only after the call, and the insert failed for a non-uuid id, a description over 200 characters, or a model-written subject over 200. Ids are now checked first, and text is shortened to the table's limits.
- **Clickjacking:** any site could load the app in a hidden frame. On Vercel, every response now says only this site may frame it (`frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`), plus `nosniff` and a referrer policy (`src/lib/response-headers.ts`).
  - They're set by the app itself, because `vercel.json` headers don't apply when the build writes Vercel's output.
  - They're only on Vercel, because the Lovable editor shows the app in a frame of its own.
  - Checked by running the Vercel build's function locally.
- **Bug: an unconfirmed account was told "Wrong email or password".** It's now told to confirm its email. This reveals nothing, since Supabase only says so when the password was right (`signInErrorMessage` in `src/lib/auth/errors.ts`).
- **Bug: some phone photos failed with an unreadable error.** A photo with no type is treated as a JPEG, and an unsupported one gets a plain message before anything is uploaded. The accepted types live in one place, `src/lib/photo-types.ts`, shared by the browser and the server.
- **Storage trouble looked like a permission problem.** Only a real refusal says "You can't add a photo to this task"; anything else says to try again.
- **Loose inputs:**
  - a worker's colour must be a palette colour or a hex one, because it's written into inline styles;
  - a malformed plant id returns an empty care history instead of a database error;
  - address search is capped at 200 characters and coordinates at the globe.

**Not fixed; needs you or a later step:**

- **CAPTCHA before production.** Open signup lets anyone send confirmation emails from our domain to any address, and each account gets its own AI allowance. Supabase caps emails per hour for the whole project, so a flood also blocks real signups, invites and resets. A signup CAPTCHA (Cloudflare Turnstile, which Supabase supports) was optional in E; it's now required before production. See [Your checklist](#your-checklist-things-only-you-can-do).
- The rest is listed under [Known limitations](#known-limitations).

**Verified:**

- 182 unit tests (21 new), typecheck, lint, build, and the 86 database checks.
- The Vercel build's function run locally: pages get the frame headers with `VERCEL=1` and not without.

### D1: worker app, office and docs

**Worker app on the signed-in worker:**

- `src/lib/worker-store.ts` and the "whose jobs to show" picker are gone. `useCurrentWorker()` (`src/hooks/use-viewer.ts`) finds the signed-in person's worker record. A boss has one too, so a boss opening `/mobile` sees their own jobs.
- The language setting goes through `update_my_profile` (`updateMyLanguage`), which works for a worker. Before, it called the boss-only `saveWorker`.
- Only a boss sees "Full site".
- **Reopening a finished job** is shown only to a boss, on a one-off job. The database refuses a worker, and a weekly job's "done" now comes from its photo, which reopening wouldn't undo.
- **Refused task changes are reported.** Skipping, reopening, adding, removing and approving tasks used to fail without a word; they now show the error.
- **The schedule's Status control matches.** On a weekly task, "Done" can't be picked; the photo decides it. Once the task has this week's proof, the control is locked, since planned or skipped wouldn't show until next week. A one-off task keeps the boss's manual "Done".

**Decision: a weekly task is done only if it has a photo from this week.** Before, once a weekly task was proven, it showed as done in every later week, and the worker had to reopen it before the next photo. `listTasks` and `projectTasks` now read this week's `task_photos` and work out each weekly task's status from them (`provenThisWeek` and `weeklyStatus` in `src/lib/api/task-rows.ts`, with tests). The week is Monday to Sunday on the company's calendar, the same week `complete_task` allows one proof in. The office screens use the same status, so the dashboard, schedule and workers page agree with the phone. "Skipped" still carries over; see [Known limitations](#known-limitations).

**Office:**

- `/workers`: "Open in worker app" is gone. Each worker shows their email and whether they can sign in: "Can sign in", "Invited <date>" or "No login".
- Plants show their code (`PL-0001`) instead of the uuid: plant table, plant card, map popup, plant dialog and the worker app's plant page. Plant search matches the code.
- A bad id in a URL already showed "not found" (`getProject` and the client report return null for a non-uuid); nothing to change.

**Docs:** `.env.example` and `docs/deploy-vercel.md` say the Supabase variables hold the production project's keys, that the service-role key now only serves the weather cache (and D2's invites), and how to set up the new project first (`supabase db push`, then the checklist).

**Review:** a code-review pass found two issues:

- **Fixed:** the schedule's Status control still offered "Done" on weekly tasks and let a boss reopen a proven one. Neither showed, since the status now comes from the photo (see above).
- **Deferred to E:** the week is worked out in Tallinn time rather than the company's own zone; added to the time-zone entry in [Known limitations](#known-limitations).

**Verified:**

- 187 unit tests (5 new), typecheck, lint and build pass, and the 86 database checks.
- No end-to-end run in a browser: the new schema isn't on any live project, and this machine has no Docker.

### D2: worker invites and password reset

**Why:** after D1, a boss could add workers, but nobody could give them a login, and the invite and reset emails pointed at a page that didn't exist.

**Decisions:**

- **"Remove access" deletes the login only.** The worker stays in the crew with their jobs and history, and can be invited again. Taking someone off the crew entirely is a separate feature, for later.
- **Being invited is not agreeing to join** (after the security review, below). The invited person answers on `/join`; until they press Join, their login sees nothing of the company.

**Database** (new migrations; the baseline is untouched):

- `20260927000001_invites.sql`:
  - **`workers.accepted_at`.** The three membership checks every policy uses (`private.company_id()`, `worker_id()`, `is_boss()`) count a login only once it has accepted. Only the server may record an acceptance; a boss can't do it through the API. `create_company` marks the new boss as joined, and the last-boss rule counts only bosses who have joined.
  - **`my_invitation()`:** the company waiting for the caller's answer, for `/join`.
  - **`login_for_email()`:** the server's way to find the login that holds an address. It's closed to everyone but the server, since it would reveal which addresses have accounts.
  - **An `invite` allowance of 20 a day per company.** Invitations send email from our domain to any address a boss types, so they're metered like the AI features. A resend counts.
  - Worker emails are stored lowercased and trimmed.
- `20260927000002_geocode_limit.sql`: a `geocode` allowance (see the security sweep below).
- `config.toml`: `secure_password_change = true`.

**Invitations** (`src/lib/server/invites.ts`, the one place besides the weather cache that uses the service-role key):

- Every boss action reads the worker through the boss's own session, so row-level security proves it's their company, and spends the allowance against that company. The service role only sends the email and finds, deletes, links, unlinks or accepts logins, and its writes name the boss's company too.
- **Invite:**
  - Refuses a worker without an email, or one already invited.
  - Refuses an address that is confirmed, or linked to any company: one account belongs to one company.
  - An address someone signed up with but never confirmed is deleted first, so no password its creator chose survives.
  - Supabase emails the invitation, and the login is linked to the worker, but not accepted.
  - The allowance is spent before the account lookup, since that reveals whether an address has an account.
- **Answering (`/join`):** "Join <Company>?" with **Join** and **This isn't me**. Both run on the server with the person's verified session. Declining unlinks them; they can then set up their own company. The guard sends a person with an unanswered invitation to `/join` and nowhere else.
- **Resend:** only until the link has been opened; after that, they sign in and accept.
- **Remove access** (also cancels an invitation):
  - Deletes the login and clears `workers.user_id`, as D1's notes required.
  - It works at once: every request looks the login up again, so even a still-valid token sees nothing.
  - Never your own, and never a boss's, so a company can't lock itself out.
- **Workers:**
  - A worker has an optional email, unique within the company. It's read-only in the dialog once it's someone's login; the database refuses a change anyway.
  - `/workers` shows each person's email and state ("No login", "Invited <date>", "Can sign in"), with the matching buttons (`src/components/WorkerAccess.tsx`). Removing access asks first.
- **The invite email doesn't name the company yet.** Bosses choose company names, and it isn't confirmed that Supabase's email templates escape them. The name is sent with the invitation for later; `/join` shows it before anyone joins.

**Passwords:**

- **`/forgot-password`:**
  - Emails a reset link from the browser, as sign-in does, so Supabase's limits apply per person, not to our server's one address.
  - Answers the same whether or not the email has an account, including when Supabase's per-address email limit is hit.
  - Linked from the login page.
- **`/auth/confirm`** decides where to go from the link's type (invite and reset go to `/auth/set-password`, a signup confirmation goes to `/onboarding`), never from the link itself.
- **`/auth/set-password`:**
  - Only for a session an invite or reset link started in the last hour. Anyone else is offered to sign out and get a reset link, so a signed-in phone left lying around can't have its password changed.
  - Then the guard sends them on: to `/join` if invited, otherwise home.
  - Opened without a session, it explains the link has expired and offers a new one.
- **Access rules:** `/forgot-password` is public. Like login and signup, it sends a signed-in member home and is never a redirect target.

**Security review of D2** (a security reviewer agent, after the first version):

- **HIGH, fixed:** someone could sign up with a victim's email, never confirm it, and keep a working password once the victim's real boss invited that address and the victim accepted. Unfinished signups are now deleted before inviting.
- **MEDIUM, fixed:** the first version linked a login when the invitation was sent, so any boss could invite a stranger's address and the stranger would land in that company the first time they signed up or reset their password. Hence `/join` and `accepted_at`.
- **LOW, fixed:**
  - Races between two tabs or two bosses: every update now checks the row is still as it was read, and a login left over by a failed step is deleted.
  - Forgot-password leaked which addresses have accounts through the per-address rate limit.
  - A crafted email link could choose where the person went after it.
  - Any recent session could set a new password without the old one.
  - Some errors were wrong, or showed raw database messages.
- **Noted, not fixed:**
  - An archived worker keeps their login. It matters once archiving exists in the app.
  - A confirmed account with no company can't be invited (Supabase refuses the address); the person has to be asked to use another one.
  - Links to photos signed before access was removed work until they expire (1 hour, 2 for uploads).

**Security sweep of the whole app** (27 Sep 2026):

- **Checked and sound:**
  - no secrets in the repo or its history, and `.env` is git-ignored;
  - every server function (40) checks the caller before reading or writing; the AI, report, offer, address-search and invite ones are boss-only;
  - CSRF protection and the response headers;
  - no user text is written into raw HTML;
  - calls to other services go to fixed hosts;
  - error reports never include email-link tokens;
  - signed photo links expire after an hour.
- **Fixed:**
  - **MEDIUM: address search had no limit.** With open signup, one company could loop it and get our server banned by Nominatim, breaking address search for everyone. It now spends a `geocode` allowance of 300 a day per company.
  - **LOW–MEDIUM: one company could use up the shared weather quota.** A page load now fetches at most 50 uncached sites.
  - **LOW: six dependency advisories**, all in lint and build tools. `bun audit` is clean.
- **Deferred:** a script Content-Security-Policy (see [Known limitations](#known-limitations)).

**Verified:**

- 230 unit tests, typecheck, lint and build pass.
- 101 database checks (15 new: acceptance, the guards, `my_invitation`, `login_for_email`, lowercase emails, the allowances).
- **First CI run on `claude-101` (29 Sep 2026):**
  - All 101 database checks pass on a real local Supabase, the first time they've run outside the stand-in.
  - 4 report tests failed: CI's newer ICU data writes en-GB September as "Sept", so the report's date column would have changed with the server's runtime. `dayLabel` now builds "Mon 07 Sep" itself, and a test covers September and December.
- **Built server run locally:**
  - `/forgot-password`, `/auth/set-password` and an invite `/auth/confirm` link answer 200 when signed out.
  - `/join` and `/workers` redirect to login.
  - Neither the invite code nor the service-role key is in the browser bundle.
- **Not tried for real yet:** an invitation email arriving, being accepted, a resend, and a reset. That's the staging run. Two things to confirm there:
  - which sign-in method names Supabase records for invite and reset links, which `/auth/set-password` relies on;
  - whether its email templates escape data, before the invite email names the company.

### Staging on the production project

**29 Sep 2026.** The schema is live on `GoldmanStocks-production` (`wjhrdbrhoysdtppqaapm`, `eu-west-1`).

- **Applied:** `supabase link`, then a dry run that listed exactly the six files in `supabase/migrations/` and no seed, then `db push`. The project was empty beforehand: no tables, no migration history. The CLI connected through its temporary login role, so the database password wasn't needed.
- **Checked on the live database:**
  - `postgres` has BYPASSRLS, which `complete_task` needs;
  - all 14 public tables have row-level security on;
  - the `task-photos` bucket is private;
  - the four daily allowances are in place: `ai_plan` 50, `ai_outreach` 50, `geocode` 300, `invite` 20.
- **Types:** `supabase gen types --linked` against the hand-written `src/lib/supabase/types.ts`. Every table's rows, every enum and every function's return type match. The only differences are deliberate narrowings in the hand-written file:
  - `plants.code` is optional on insert, since a trigger assigns it;
  - `task_photos` can't be updated;
  - `complete_task` takes null GPS, and `set_project_crew` takes a crew without a lead;
  - `bump_usage` lists its four kinds.
- **Supabase's advisor:** no errors. Six warnings, all "signed-in users can execute a SECURITY DEFINER function", for `bump_usage`, `complete_task`, `create_company`, `my_invitation`, `set_task_status` and `update_my_profile`. That's intended: they're the narrow ways members write, each checks the caller, and the database tests cover them. `login_for_email` isn't on the list, since it's server-only.
- **Region:** the project is in Ireland rather than London, so `vercel.json` now runs the function in `dub1` (Dublin). `main`'s `vercel.json`, which the demo builds from, is unchanged.

**Then (29 Sep):**

- **Vercel:** your own project, `goldman-stocks-production`, imports your fork `GammaOrSomething/GoldmanStocks`, with Production Branch = `claude-101`. Live at `https://goldman-stocks-production.vercel.app`.
  - Headers are right, private pages redirect to login, and the server runs in `dub1`.
  - The browser code points at the new project and holds no secret key.
  - `claude-101` is pushed to both `origin` (`mrkikuts`) and `fork`.
- **Supabase:** Site URL and redirect URLs set to that address, email settings and templates in.
- **Why Production and not a preview:** one stable address for the Site URL and later the Turnstile hostname, and no Vercel sign-in wall on the phone.
  - It's safe before the CAPTCHA only while Supabase's built-in sender is in use, since that reaches org members only. **Don't set up SMTP until the CAPTCHA ships.**

### Staging feedback (29 Sep 2026)

You signed up and onboarded, then reported three problems.

- **"I can't see the weather forecast."** Forecasts are per site. A new company has none, so `loadForecasts` threw "Weather unavailable" and the card showed nothing useful.
  - **Fix:** companies have a home area, set in `20260929000001_company_area.sql`:
    - `city`, plus `lat` and `lng`, set together or not at all;
    - only the company's boss can change them, through the existing update policy plus a column grant.
  - `getWeekWeather` → `loadWeekWeather`:
    - with sites, their forecasts;
    - with no sites, the forecast for the area, in the same single request;
    - with neither, an empty week rather than an error.
  - **Dashboard:** "Forecast for {town} · Change". With neither a site nor a town, the card asks "Where's your company based?" with a town search, or links to adding a site.
  - **Onboarding** asks for the town (optional) and looks it up once the company exists.
  - **Maps** start at the area instead of Tallinn when there's no pin.
- **"I have to place the dot by hand instead of writing the address."** The form's search box sat apart from its Address field, and typing the address there never moved the pin.
  - **Fix:** the Address field is the search: Enter or **Find** → matches → pick one, and the pin moves (`src/components/PlaceSearch.tsx`).
  - Saving without a pin looks up "address, city" and uses the best match. The toast says where, and the pin can be dragged on the Sites map.
  - With no clients, the form now says to add one first, instead of a silently disabled button.
  - Still no search-as-you-type: Nominatim forbids autocomplete, and each search spends the `geocode` allowance.
- **"The AI plan says Review with nothing to generate."** The tile said "Review / Awaiting approval" whenever the day wasn't approved.
  - Worse, **Approve today's plan** was enabled with no jobs, and `explainPlan` spent an `ai_plan` use and an OpenAI call on an empty plan.
  - **Fix:** with no jobs today, the tile reads "— / No jobs today" and the button "Nothing to approve", disabled.
  - The server also answers an empty plan with a fixed sentence before spending anything (`isEmptyPlan`).

**Review** (a code-reviewer pass): no security problems. Fixed:

- **HIGH:** adding the first site left the dashboard on "No forecast" for up to 15 minutes, because nothing refreshed the forecast. The week's forecast is now one of the shared data keys (`dataKeys.weekWeather`), so every site save or move refreshes it.
- **MEDIUM:**
  - "Where's your company based?" could flash for a company that has sites, while its site list was still loading. The server now reports `hasSites`, and the card asks only when the server saw neither sites nor an area.
  - The tile and the explanation used different tests for "there's a plan". Both now use `hasAssignedWork` (`src/lib/planner.ts`). A job nobody can be assigned reads "Nothing assigned", not "Review".
  - The weather card moved to `src/components/dashboard/WeatherCard.tsx`, bringing `src/routes/index.tsx` under 800 lines.
  - Tests for the promises themselves:
    - an empty plan spends no allowance and asks no model (`explainPlanOrSkip`);
    - a refused area update is an error (`updateCompanyArea`);
    - another company's boss can't move where A is based.
- **LOW:**
  - Cancel is disabled while a save looks up the address.
  - Search results are dropped when the text changes, and searching the same text again spends nothing.
  - A picked match fills the street alone, so the town isn't repeated ("Valukoja 8, Tallinn, Tallinn"). Matches now carry a separate `street` field.
  - The address search fields have accessible names.
- **Not changed:**
  - The saved-without-a-pin lookup takes Nominatim's best match from anywhere; the toast names the place, and the pin can be moved.
  - `saveCompanyArea` asks `requireBoss` and then `requireMember`. The second is cached for the request, so it doesn't look anything up again.

**Verified:**

- 258 unit tests (27 new), typecheck, lint and both builds;
- 105 database checks (4 new, and the worker check now covers the company's area);
- the dry run on production lists only `20260929000001_company_area`.

**Next:** the invite click-through on your phone. See [Pick up here](#-pick-up-here-next-session).

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

- [x] Create the production Supabase project. It's in `eu-west-1`, so Vercel runs in `dub1`.
- [ ] Set up custom email sending (SMTP), e.g. Resend, Postmark or SES, with SPF/DKIM on your domain. **Required:** Supabase's built-in sender only emails your own team members, so signup confirmations and worker invites won't arrive without it.
- [ ] Auth settings:
  - Site URL = the production domain.
  - Redirect URLs: production, the Vercel preview wildcard, and `http://localhost:8080/**`.
  - Email confirmation on.
  - Minimum password length 10, with letters and digits.
  - **Secure password change** on (Authentication → Providers → Email). It matches `config.toml`; the app only sets a password right after an emailed link.
  - Rate limits (Authentication → Rate Limits): keep sign-ups and emails per hour modest.
- [ ] Upload the three email templates from `supabase/templates/` (Authentication → Emails): confirm signup, invite user and reset password. Without them, invite and reset links skip the confirm step and don't reach `/auth/set-password`.
- [ ] **Create a Cloudflare Turnstile site** for the production domain and give me the site key; the secret key goes into Supabase (Authentication → Attack Protection). The CAPTCHA (signup, sign-in and password reset) can't go live without them.
- [ ] **Weather for a paid product:** Open-Meteo's free API is for non-commercial use. Before charging customers, take their commercial plan and give me the API key. The app already caches forecasts and fetches at most 50 sites per load.
- [ ] After the first Vercel preview deploy, check the headers: `curl -sI https://<preview>/login` should show `content-security-policy: frame-ancestors 'self'`.
- [ ] Tag the last pre-D1 commit `demo-final`. Its Vercel deployment stays up as the live demo.

---

## Next steps

1. **E: end-to-end tests, the CAPTCHA, and final docs.**

The full technical plan (schema, access rules, file-by-file changes, risks) is in
[technical-plan/README.md](technical-plan/README.md). This file tracks what actually happened.

## Known limitations

- **No script Content-Security-Policy.** React's escaping is the only defence against injected scripts, and Supabase keeps the session in cookies that JavaScript can read (its browser client needs them). A strict CSP needs nonce support from the framework and an allow-list for the map tiles; it belongs with E.
- **Orphaned photos:** any member can upload plant pictures (up to 10 MB each) that never end up on a plant, and nothing cleans them up. A clean-up job belongs with E.
- **Saving a client or site isn't atomic:** if saving its terms or crew fails after a new client or site was inserted, the new row stays, and pressing Save again makes a duplicate. The fix is one database function per save.
- **Updates to a missing id succeed silently:** `saveClient`, `saveWorker` and `moveSite` report success when the id matches nothing (another company's row, say). Nothing is changed, but the caller isn't told.

- **The app uses a hardcoded company time zone.** `completeTask` works out the local date, and `listTasks` works out which week a proof photo belongs to, with `COMPANY_TZ` (Tallinn), not `companies.timezone`. `complete_task` accepts ±1 day around the company's today, so the work date only matters for a company far from Tallinn. Around midnight between Sunday and Monday, a company in another zone could see a weekly task as done when the database would still take its proof, or the other way round. Switching to the company's zone is in E.
- **Row limit on this week's proof:** a weekly task's "done" comes from this week's photos, read in one query, and Supabase returns at most 1,000 rows per query. Past 1,000 proof photos in a week, some weekly tasks would show as not done. Client counts no longer have this problem: they come from `client_stats` since D1.
- **Hours follow the current task:** client hours use each task's current duration and site. Editing a task changes hours already counted this month.
- **Tasks double as weekly templates:** a task is a repeating weekly template, but its status and approval are stored on the template itself. Since D1, a weekly task's "done" comes from this week's photo proof, but "skipped" and "approved" still carry over from week to week. The real fix is per-date task occurrences, the next data-model change after this migration.
