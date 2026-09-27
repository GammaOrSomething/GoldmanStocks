// Marks this module server-only: importing it from a component is a build error, which
// keeps the service-role key out of the client bundle. See the `no-restricted-imports`
// rule in eslint.config.js for the convention.
import "@tanstack/react-start/server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import {
  getCookies,
  setCookie,
  setResponseHeader,
} from "@tanstack/react-start/server";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";
import type { Database } from "./types";

type ResponseHeaderName = Parameters<typeof setResponseHeader>[0];

/**
 * Request-scoped client that reads the caller's session from the request cookies and
 * respects row-level security. Use this inside `createServerFn` handlers — it answers
 * "what is this user allowed to see?".
 *
 * Create a new one per request; never hoist it to module scope. Supabase writes refreshed
 * tokens back through `setAll`, and a shared client would leak one request's session into
 * another's response.
 */
export function getServerClient() {
  // Cookies written during this request, so later reads see them.
  //
  // @supabase/ssr re-reads the session through `getAll` on every call rather than trusting an
  // in-memory copy. Sign-in writes the session to the *response*, but `getCookies()` reads the
  // *request* — without this overlay the very next query looks signed out again and row-level
  // security returns nothing.
  const written = new Map<string, string>();

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        const merged = new Map(Object.entries(getCookies()));
        for (const [name, value] of written) merged.set(name, value);
        return [...merged].map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value, options } of cookiesToSet) {
          written.set(name, value);
          setCookie(name, value, options);
        }
        // Supabase hands back Cache-Control/Expires/Pragma alongside any auth cookie write.
        // Dropping them lets a CDN cache the response and serve one user's session to another.
        for (const [name, value] of Object.entries(headers ?? {})) {
          setResponseHeader(name as ResponseHeaderName, value);
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses row-level security entirely, so it must never be reachable
 * from the browser or handed user-supplied filters. For trusted server-side work only (the
 * shared weather cache, and worker invitations in src/lib/server/invites.ts) — anything acting
 * on behalf of a user wants `getServerClient`.
 *
 * The key is read from `process.env` at call time (not `import.meta.env`) so it is never
 * inlined into a bundle.
 */
export function getAdminClient() {
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. Copy .env.example to .env and fill it in from the Supabase dashboard (Project Settings → API).",
    );
  }

  return createClient<Database>(SUPABASE_URL, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
