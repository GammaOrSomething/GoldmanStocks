import {
  isAuthRetryableFetchError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { redirect } from "@tanstack/react-router";

import {
  loginHref,
  type Invitation,
  type Member,
  type Viewer,
} from "../auth/access";
import type { Database } from "../supabase/types";
import { toArea } from "./mappers";

type Client = SupabaseClient<Database>;
type User = { userId: string; email: string };
type Session = {
  db: Client;
  user: User | null;
  /** The caller's company and role, looked up on first use and then kept for the request. */
  member: () => Promise<Member | null>;
};

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
  const { data, error } = await db.auth.getClaims();
  // Supabase unreachable while refreshing the token is an outage, not a sign-out: fail the
  // request rather than sending a signed-in user to the login page.
  if (error && isAuthRetryableFetchError(error)) throw error;
  const claims = data?.claims;
  const user = claims
    ? { userId: claims.sub, email: String(claims.email ?? "") }
    : null;
  let member: Promise<Member | null> | undefined;
  return {
    db,
    user,
    member: () =>
      (member ??= user ? readMember(db, user.userId) : Promise.resolve(null)),
  };
}

/**
 * The caller's worker row and company, read with their own session: row-level security shows
 * a member only their own company. An archived worker is no member at all, and nor is a login
 * whose invitation hasn't been accepted.
 */
async function readMember(db: Client, userId: string): Promise<Member | null> {
  const [me, company] = await Promise.all([
    db
      .from("workers")
      .select("id, company_id, app_role, name")
      .eq("user_id", userId)
      .is("archived_at", null)
      .not("accepted_at", "is", null)
      .maybeSingle(),
    db.from("companies").select("name, city, lat, lng").maybeSingle(),
  ]);
  if (me.error) throw new Error(me.error.message);
  if (company.error) throw new Error(company.error.message);
  if (!me.data) return null;
  return {
    workerId: me.data.id,
    companyId: me.data.company_id,
    companyName: company.data?.name ?? "",
    area: toArea(company.data),
    role: me.data.app_role,
    name: me.data.name,
  };
}

/** An invitation the caller hasn't answered yet: they can't read the company, so ask the database. */
async function readInvitation(db: Client): Promise<Invitation | null> {
  const { data, error } = await db.rpc("my_invitation");
  if (error) throw new Error(error.message);
  const [pending] = data ?? [];
  return pending ? { companyName: pending.company_name } : null;
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

/** Who is signed in on this request, and their company, or null. Never throws when signed out. */
export async function getSessionViewer(): Promise<Viewer> {
  const session = await currentSession();
  if (!session.user) return null;
  const member = await session.member();
  return {
    ...session.user,
    member,
    invitation: member ? null : await readInvitation(session.db),
  };
}

/**
 * The client every server function should query through: the caller's own session, so
 * row-level security applies. A signed-out caller is sent to the login page — the redirect
 * reaches the browser whether this runs in a route loader or behind a `useQuery`.
 */
export async function getAuthedClient(): Promise<Client> {
  const { db, user } = await currentSession();
  if (!user) throw redirect({ href: loginHref() });
  return db;
}

/** The signed-in login's id, from their verified session; a signed-out caller goes to login. */
export async function requireUserId(): Promise<string> {
  const { user } = await currentSession();
  if (!user) throw redirect({ href: loginHref() });
  return user.userId;
}

/** The signed-in member and their session; fails for someone who has no company yet. */
export async function requireMember(): Promise<{ db: Client; member: Member }> {
  const db = await getAuthedClient();
  const member = await (await currentSession()).member();
  if (!member) throw new Error("Set up your company first");
  return { db, member };
}

/**
 * The client for office-only work: changing clients, sites, the plan and workers, offers, the
 * AI features, address search and reports. Row-level security already refuses a worker's
 * writes; this also stops a worker's reads and paid API calls, and gives a clear error.
 */
export async function requireBoss(): Promise<Client> {
  const { db, member } = await requireMember();
  if (member.role !== "boss") throw new Error("Only a boss can do this");
  return db;
}
