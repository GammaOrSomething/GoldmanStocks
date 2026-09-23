# Supabase

The production database is built from the migrations in [`migrations/`](migrations/), in order,
with no seed data. The demo project's old schema is kept, frozen, in
[`legacy-demo/`](legacy-demo/).

| File                           | What it sets up                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `20260923000001_core.sql`      | Types, tables and the "who am I" helpers (`private.company_id()`, `worker_id()`, `is_boss()`) |
| `20260923000002_functions.sql` | Triggers (plant codes, worker rules) and the functions the app calls                          |
| `20260923000003_rls.sql`       | Row-level security: who can read and write what                                               |
| `20260923000004_storage.sql`   | The private `task-photos` bucket and its policies                                             |

## How access works

Every table except the shared weather cache has a `company_id`, which defaults to the signed-in
user's company. Row-level security then:

- shows each company only its own rows;
- lets a **boss** do anything within their company;
- lets a **worker** read the company's data except offers and the money tables (`client_terms`,
  `project_terms`), and register plants at sites they work on.

Anything else a worker does goes through a function that checks exactly one thing:

| Function            | What it does                                                                            |
| ------------------- | --------------------------------------------------------------------------------------- |
| `complete_task`     | Finish a task with photo proof, in one transaction. Only the assigned worker or a boss. |
| `set_task_status`   | Skip a job, or put it back to planned.                                                  |
| `update_my_profile` | Change the language they speak.                                                         |

The functions for bosses and signup:

| Function           | What it does                                                           |
| ------------------ | ---------------------------------------------------------------------- |
| `create_company`   | Called once after signup. Makes the caller the boss of a new company.  |
| `set_project_crew` | Replace a site's crew and lead in one go.                              |
| `bump_usage`       | Count an AI call against the company's daily limit.                    |
| `client_stats`     | Sites, plants and proven hours per client, worked out in the database. |

Child rows use composite foreign keys (`(parent_id, company_id)`), so a row can never point at
another company's data even if someone guesses an id.

Logins are linked to workers only by the server, with the service role, when a boss invites
someone. A trigger stops signed-in users from doing it themselves.

## Working locally

You need the Supabase CLI (installed with `bun install`) and Docker.

```sh
bun run db:start      # local Supabase with every migration applied; prints the URLs and keys
bun run db:reset      # rebuild the local database from the migrations
bun run test:rls      # security tests against the local database
bun run db:types      # regenerate src/lib/supabase/types.ts from the local database
bun run db:stop
```

Emails sent locally (signup confirmations, invites, password resets) land in Mailpit at
http://localhost:54324. The dev server is http://localhost:8080; `config.toml` allows it as a
redirect target.

**No Docker?** The security tests can also run on any plain Postgres 15+ with `psql`:

```sh
bun run test:rls -- --stub
```

This creates a throwaway database, adds a small stand-in for Supabase's `auth` and `storage`
schemas (`tests/stub/supabase.sql`), applies every migration, runs `tests/rls.sql`, and drops the
database again. It covers the database rules. It does not exercise the real storage and auth
services; CI runs the tests on a real local Supabase as well.

## Changing the schema

1. Add a new file to `migrations/`, e.g. `bunx supabase migration new add_something`. Never
   edit a migration that has already been applied to production.
2. Run `bun run db:reset && bun run test:rls`, and add tests for new rules to `tests/rls.sql`.
3. Run `bun run db:types` and commit the regenerated types with the migration.
4. Apply it to production deliberately, with `bunx supabase db push` from a linked checkout.
   There is no script for this on purpose.

## Production project

Created by hand; see the checklist in [`docs/production/README.md`](../docs/production/README.md).
In short:

1. Create the project.
2. Run `bunx supabase link --project-ref <ref>`, then `bunx supabase db push`.
3. Set the auth URLs, email confirmations, password rules and custom SMTP in the dashboard, to
   match `config.toml`.
4. Upload the three email templates from `templates/`.
