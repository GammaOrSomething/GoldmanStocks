# Deploying to Vercel

The app builds for Vercel with no code changes: Nitro (the server bundler behind TanStack
Start) sees Vercel's `VERCEL=1` build environment and writes Vercel's Build Output API to
`.vercel/output` — static assets plus one Node.js function. Lovable's own builds are
unaffected and still target Cloudflare.

## One-time setup

1. **Import the repo** at vercel.com → *Add New… → Project*, pick this GitHub repo and the
   branch to deploy. `vercel.json` already sets the install/build commands and the region —
   leave *Framework Preset* on **Other** and the output directory empty.
2. **Environment variables** (*Settings → Environment Variables*, for Production and Preview):

   | Variable | Secret? | Notes |
   | --- | --- | --- |
   | `VITE_SUPABASE_URL` | no | **needed at build time** — Vite inlines it into the browser bundle |
   | `VITE_SUPABASE_ANON_KEY` | no | **needed at build time**, same reason |
   | `SUPABASE_SERVICE_ROLE_KEY` | **yes** | photo uploads/storage; never give it a `VITE_` prefix |
   | `OPENAI_API_KEY` | **yes** | plan explanation and offer drafts |
   | `OPENAI_MODEL` | no | optional, defaults to `gpt-4o` |

3. **Deploy.** Every push to the connected branch redeploys; pull requests get preview URLs.

## Notes

- **Region:** the function runs in `lhr1` (London), next to the Supabase project
  (`eu-west-2`). Each page makes several database calls, so keeping them in the same region
  matters. Change `regions` in `vercel.json` if the database moves.
- **Changing a `VITE_` variable needs a redeploy** — they're baked in at build time.
- **Maps:** street tiles come from OpenStreetMap and satellite imagery from Esri, both loaded
  by the browser. They're free with attribution (shown on the map) for modest traffic; for
  heavy production use, move to a paid tile provider.
- **Build locally the way Vercel does:** `VERCEL=1 bun run build`, then inspect
  `.vercel/output` (git-ignored).
