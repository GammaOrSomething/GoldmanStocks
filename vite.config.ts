// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";

/**
 * Fails the build when a browser-side env var is missing, instead of shipping a bundle with
 * `undefined` baked in.
 *
 * Vite inlines `import.meta.env.VITE_*` at build time, so these have to be readable *by the build*,
 * not just by the running app. On Vercel that rules out the "Sensitive" variable type: a Sensitive
 * var is set and visible in the dashboard, yet the build cannot read it, so Vite inlines `undefined`
 * and the deployed site 500s on every request with "@supabase/ssr: Your project's URL and API key
 * are required to create a Supabase client!". These two are compiled into the browser bundle anyway,
 * so they are public by nature and belong in a plain (Config) variable. Real secrets stay Sensitive —
 * they are read from `process.env` at runtime, where Sensitive works fine.
 */
const requireBrowserEnv: Plugin = {
  name: "goldman-stocks:require-browser-env",
  apply: "build",
  configResolved(config) {
    const missing = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"].filter(
      (name) => !config.env[name],
    );
    if (missing.length > 0) {
      throw new Error(
        `Missing required build-time environment ${missing.length > 1 ? "variables" : "variable"}: ${missing.join(", ")}.\n` +
          "Vite inlines VITE_* values into the bundle at build time, so the build itself must be able to read them:\n" +
          "  - locally: copy .env.example to .env and fill in the values from the Supabase dashboard (Project Settings → API)\n" +
          "  - on Vercel: Project Settings → Environment Variables, as a plain/Config variable on Production and Preview.\n" +
          '    A "Sensitive" variable is NOT readable at build time and will land here even though it looks set.',
      );
    }
  },
};

export default defineConfig({
  plugins: [requireBrowserEnv],
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
