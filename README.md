# Goldman Stocks

Crew planning for gardening and landscaping companies. The boss plans each worker's day around every
plant's care schedule and the weather, and workers prove their work with photos from their phones.

- **Office app** (`/`, `/schedule`, `/projects`, `/plants`, `/clients`, `/workers`): the boss's
  desktop views, plus a monthly photo report per client.
- **Worker app** (`/mobile`): today's jobs, photo check-off, plant registration.

Built with TanStack Start (React, file-based routes, server functions) and Supabase (Postgres, auth,
storage). Weather comes from Open-Meteo, and the plan explanations and offer drafts from OpenAI.

## Getting started

```sh
bun install
cp .env.example .env   # fill in the values; see the comments in the file
bun run dev            # http://localhost:8080
```

| Command         | What it does                                    |
| --------------- | ----------------------------------------------- |
| `bun run dev`   | local dev server                                |
| `bun test`      | unit tests (`*.test.ts` next to the code)       |
| `bun run build` | production build (needs the `VITE_*` variables) |
| `bun run lint`  | eslint + prettier                               |

## Where things are

- `src/routes/`: pages. See [src/routes/README.md](src/routes/README.md) for the routing rules.
- `src/lib/api/`: server functions that read and write the database.
- `src/lib/server/`: server-only code (photos, reports, weather cache, LLM).
- `supabase/`: database migrations and notes.

## More

- [docs/production/README.md](docs/production/README.md): the demo → production migration: progress,
  your to-do checklist and next steps.
- [docs/deploy-vercel.md](docs/deploy-vercel.md): hosting on Vercel.
- [docs/HANDOFF.md](docs/HANDOFF.md): how the app is built. [docs/TODO.md](docs/TODO.md): open work.
- This repo is connected to [Lovable](https://lovable.dev). See [AGENTS.md](AGENTS.md) before pushing.
