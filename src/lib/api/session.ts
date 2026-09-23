import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "@tanstack/react-router";

import { loginHref, type Viewer } from "../auth/access";
import type { Database } from "../supabase/types";

type Client = SupabaseClient<Database>;
type Session = { db: Client; viewer: Viewer };

/**
 * The caller's own Supabase session, read from their cookies — one per request.
 *
 * Memoised for the life of the request: when the access token has expired, the first
 * `getClaims()` refreshes it and writes the new cookie onto the *response*, while the server
 * client reads the *request* cookies. Sharing one client keeps the refreshed session in memory
 * for every later call in the same request, instead of each one refreshing again.
 *
 * Every import of server-only code here is deliberately dynamic and inside a function.
 * `@tanstack/react-start/server` and `../supabase/server` are both server-only modules; a static
 * import would put them in the module graph of every file that exports a server function, and
 * TanStack's import protection would then replace those modules on the client with a stub that
 * throws — breaking every useQuery in the app while still looking fine in SSR.
 */
const perRequest = new WeakMap<Request, Promise<Session>>();

async function readSession(): Promise<Session> {
  const { getServerClient } = await import("../supabase/server");
  const db = getServerClient();
  const { data } = await db.auth.getClaims();
  const claims = data?.claims;
  const viewer: Viewer = claims
    ? { userId: claims.sub, email: String(claims.email ?? "") }
    : null;
  return { db, viewer };
}

async function currentSession(): Promise<Session> {
  let request: Request | undefined;
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    request = getRequest();
  } catch {
    // Outside a request (a script, say) — nothing to memoise against.
  }
  if (!request) return readSession();

  const cached = perRequest.get(request);
  if (cached) return cached;

  const pending = readSession();
  perRequest.set(request, pending);
  return pending;
}

/** Who is signed in on this request, or null. Never throws for a signed-out caller. */
export async function getSessionViewer(): Promise<Viewer> {
  return (await currentSession()).viewer;
}

/**
 * The client every server function should query through: the caller's own session, so
 * row-level security applies. A signed-out caller is sent to the login page — the redirect
 * reaches the browser whether this runs in a route loader or behind a `useQuery`.
 */
export async function getAuthedClient(): Promise<Client> {
  const { db, viewer } = await currentSession();
  if (!viewer) throw redirect({ href: loginHref() });
  return db;
}
