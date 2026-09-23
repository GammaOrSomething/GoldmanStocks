# Demo → production migration log

This is the running record of turning the hackathon demo into a real product: what was decided, what
each change did, what you need to do by hand, and what comes next. It is updated with every PR.

- **Started:** 23 Sep 2026
- **Current step:** PR C, new database schema (B is done)

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
| C    | New database schema, Supabase CLI, security tests                 | Not started |                                         |
| D1   | Switch the app to the new project: signup, roles, company scoping | Not started |                                         |
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

1. **C: new schema**
   - Supabase CLI and local database.
   - One clean baseline migration.
   - Automated security tests proving company A can't see company B's data and workers can't do boss things.
   - CI.
   - No app changes; the old migrations are kept as `supabase/legacy-demo/`.
2. **D1: switch to the new project**
   - Signup and a company-setup step.
   - Boss vs worker roles.
   - Everything scoped to the company.
   - Photos stored per company.
   - The worker app uses the signed-in worker instead of a picker.
3. **D2: worker invites and password reset.**
4. **E: end-to-end tests and final docs.**

The full technical plan (schema, access rules, file-by-file changes, risks) is in
[technical-plan/README.md](technical-plan/README.md). This file tracks what actually happened.

## Known limitations

- **Row limit on client counts:**
  - The problem: client counts are calculated in the app from full table reads, and Supabase returns at most 1,000 rows per query. Past 1,000 plants or monthly proof photos, the counts would silently come out low.
  - Now: harmless at demo size.
  - Fix, planned for C/D1: a database function that calculates the counts server-side.
- **Hours follow the current task:** client hours use each task's current duration and site. Editing a task changes hours already counted this month.
- **Until D1, a signed-in account can see everything.** Login is real, but there are no roles or company scoping yet. The client report and photo functions check that you're signed in, not which company you belong to. That's safe only while the demo database holds a single company.
- **Tasks double as weekly templates:** a task is a repeating weekly template, but its done/approved status is stored on the template itself. That needs per-date task occurrences, which is the next data-model change after this migration.
