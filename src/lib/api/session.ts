import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../supabase/types";

type Client = SupabaseClient<Database>;

/**
 * One authenticated client per request.
 *
 * Signing in writes the session cookie onto the *response*, but the Supabase server client reads
 * the *request* cookies — so a second call inside the same request would still look signed out
 * and row-level security would hand back nothing. Memoising the signed-in client for the life of
 * the request keeps the session in memory where every later call can see it.
 *
 * Every import of server-only code here is deliberately dynamic and inside a function.
 * `@tanstack/react-start/server` and `../supabase/server` are both server-only modules; a static
 * import would put them in the module graph of every file that exports a server function, and
 * TanStack's import protection would then replace those modules on the client with a stub that
 * throws — breaking every useQuery in the app while still looking fine in SSR.
 */
const perRequest = new WeakMap<Request, Promise<Client>>();

async function signInAsDemoBoss(): Promise<Client> {
  const { getServerClient } = await import("../supabase/server");
  const db = getServerClient();

  const { data: existing } = await db.auth.getClaims();
  if (existing?.claims) return db;

  const email = process.env["DEMO_BOSS_EMAIL"];
  const password = process.env["DEMO_BOSS_PASSWORD"];
  if (!email || !password) {
    throw new Error(
      "Missing DEMO_BOSS_EMAIL / DEMO_BOSS_PASSWORD — see .env.example.",
    );
  }

  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`Demo sign-in failed (${error.message}).`);
  }
  return db;
}

/**
 * The client every server function should query through: authenticated, RLS-respecting, and
 * shared across one request. Swap `signInAsDemoBoss` for a real login when the demo grows up —
 * nothing downstream changes.
 */
export async function getAuthedClient(): Promise<Client> {
  let request: Request | undefined;
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    request = getRequest();
  } catch {
    // Outside a request (a script, say) — fall back to an un-memoised client.
  }
  if (!request) return signInAsDemoBoss();

  const cached = perRequest.get(request);
  if (cached) return cached;

  const pending = signInAsDemoBoss();
  perRequest.set(request, pending);
  return pending;
}
