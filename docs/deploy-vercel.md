# Deploying to Vercel

The app builds for Vercel with no code changes: Nitro (the server bundler behind TanStack
Start) sees Vercel's `VERCEL=1` build environment and writes Vercel's Build Output API to
`.vercel/output` — static assets plus one Node.js function. Lovable's own builds are
unaffected and still target Cloudflare.

## One-time setup

1. **Set up the production Supabase project** first: create it, then
   `bunx supabase link --project-ref <ref>` and `bunx supabase db push` to apply
   `supabase/migrations/` (see [`supabase/README.md`](../supabase/README.md#production-project)).
   Auth URLs, custom SMTP, email templates and the signup CAPTCHA are set in its dashboard; the
   list is under "Before D1" in [the migration log's checklist](production/README.md#your-checklist-things-only-you-can-do).
   Without SMTP, signup confirmations and worker invites never arrive.
2. **Import the repo** at vercel.com → *Add New… → Project*, pick this GitHub repo and the
   branch to deploy. `vercel.json` already sets the install/build commands and the region —
   leave *Framework Preset* on **Other** and the output directory empty.
3. **Environment variables** (*Settings → Environment Variables*, for Production and Preview):

   | Variable | Secret? | Notes |
   | --- | --- | --- |
   | `VITE_SUPABASE_URL` | no | the production project's; **needed at build time** — Vite inlines it into the browser bundle |
   | `VITE_SUPABASE_ANON_KEY` | no | **needed at build time**, same reason |
   | `SUPABASE_SERVICE_ROLE_KEY` | **yes** | bypasses row-level security; only the shared weather cache uses it (worker invites too, from D2). Never give it a `VITE_` prefix |
   | `OPENAI_API_KEY` | **yes** | plan explanation and offer drafts |
   | `OPENAI_MODEL` | no | optional, defaults to `gpt-4o` |

4. **Deploy.** Every push to the connected branch redeploys; pull requests get preview URLs.

## Notes

- **Region:** the function runs in `dub1` (Dublin), next to the production Supabase project
  (`eu-west-1`). Each page makes several database calls, so keeping them in the same region
  matters. Change `regions` in `vercel.json` if the database moves. (The demo project is in
  `eu-west-2`, and `main`'s `vercel.json` still says `lhr1`.)
- **Changing a `VITE_` variable needs a redeploy** — they're baked in at build time.
- **Maps:** street tiles come from OpenStreetMap and satellite imagery from Esri, both loaded
  by the browser. They're free with attribution (shown on the map) for modest traffic; for
  heavy production use, move to a paid tile provider.
- **Build locally the way Vercel does:** `VERCEL=1 bun run build`, then inspect
  `.vercel/output` (git-ignored).
