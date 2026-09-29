/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Member } from "@/lib/auth/access";
import type { Database } from "@/lib/supabase/types";
import {
  acceptInvitation,
  declineInvitation,
  EMAIL_TAKEN,
  inviteWorker,
  removeAccess,
  resendInvite,
} from "./invites";

// The database rules (who may link or accept, company isolation) are covered by the SQL
// security tests; these cover the order of steps and what each refusal says.

type Client = SupabaseClient<Database>;
type Result = { data: unknown; error: unknown };
/** One query as the code built it: the table and every method called on it, in order. */
type Query = { table: string; calls: [string, unknown[]][] };

const COMPANY = "0b4f3d2e-8a41-4c1e-9d1f-2f6a1c9e7b10";
const BOSS = "11111111-1111-4111-8111-111111111111";
const KARL = "22222222-2222-4222-8222-222222222222";
const LOGIN = "33333333-3333-4333-8333-333333333333";
const STALE = "44444444-4444-4444-8444-444444444444";

const boss: Member = {
  workerId: BOSS,
  companyId: COMPANY,
  companyName: "Alpha Gardens",
  role: "boss",
  name: "Anna Boss",
};

const karl = {
  id: KARL,
  email: "karl@alpha.test" as string | null,
  user_id: null as string | null,
  app_role: "worker" as "boss" | "worker",
  accepted_at: null as string | null,
  archived_at: null as string | null,
};

const has = (q: Query, method: string) => q.calls.some(([m]) => m === method);
const argsOf = (q: Query, method: string) =>
  q.calls.find(([m]) => m === method)?.[1];
const updates = (queries: Query[]) => queries.filter((q) => has(q, "update"));

/**
 * A stand-in Supabase client. Every query method returns the same builder; awaiting it records
 * the query and answers with `onQuery`. `rpc` and `auth.admin` are answered the same way.
 */
function fake(
  onQuery: (q: Query) => Result,
  opts: {
    rpc?: (fn: string, args: unknown) => Result;
    admin?: Record<string, (...args: unknown[]) => Result>;
  } = {},
) {
  const queries: Query[] = [];
  const authCalls: [string, unknown[]][] = [];
  const rpcCalls: [string, unknown][] = [];
  const from = (table: string) => {
    const q: Query = { table, calls: [] };
    const builder: object = new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === "then")
            return (
              ok: (r: Result) => unknown,
              fail: (e: unknown) => unknown,
            ) => {
              queries.push(q);
              return Promise.resolve(onQuery(q)).then(ok, fail);
            };
          return (...args: unknown[]) => {
            q.calls.push([String(prop), args]);
            return builder;
          };
        },
      },
    );
    return builder;
  };
  const admin = new Proxy(
    {},
    {
      get(_, prop) {
        return async (...args: unknown[]) => {
          authCalls.push([String(prop), args]);
          const handler = opts.admin?.[String(prop)];
          if (!handler)
            throw new Error(`unexpected auth.admin.${String(prop)}`);
          return handler(...args);
        };
      },
    },
  );
  const client = {
    from,
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push([fn, args]);
      return opts.rpc ? opts.rpc(fn, args) : { data: null, error: null };
    },
    auth: { admin },
  } as unknown as Client;
  return { client, queries, authCalls, rpcCalls };
}

/** Fails loudly if reached. */
const untouchable = new Proxy(
  {},
  {
    get() {
      throw new Error("should not be reached");
    },
  },
) as Client;

/** The boss's session: reads the worker, and spends the invite allowance. */
function bossDb(worker: typeof karl | null = karl, allowed = true) {
  return fake(() => ({ data: worker, error: null }), {
    rpc: () => ({ data: allowed, error: null }),
  });
}

type Login = { user_id: string; confirmed: boolean; linked: boolean };
const sent =
  (id = LOGIN) =>
  () => ({ data: { user: { id } }, error: null });
const ok = () => ({ data: {}, error: null });

/** The service role, with what `login_for_email` finds and what each query answers. */
function adminFor(
  existing: Login[],
  opts: {
    admin?: Record<string, (...args: unknown[]) => Result>;
    onQuery?: (q: Query) => Result;
  } = {},
) {
  return fake(opts.onQuery ?? (() => ({ data: [{ id: KARL }], error: null })), {
    rpc: (fn) =>
      fn === "login_for_email"
        ? { data: existing, error: null }
        : { data: null, error: { message: `unexpected rpc ${fn}` } },
    ...(opts.admin ? { admin: opts.admin } : {}),
  });
}

describe("inviteWorker", () => {
  test("only a boss may invite", async () => {
    await expect(
      inviteWorker(
        {
          db: untouchable,
          admin: untouchable,
          member: { ...boss, role: "worker" },
        },
        KARL,
      ),
    ).rejects.toThrow("Only a boss can do this");
  });

  test("a worker from another company (or none) is not found", async () => {
    await expect(
      inviteWorker(
        { db: bossDb(null).client, admin: untouchable, member: boss },
        KARL,
      ),
    ).rejects.toThrow("Worker not found");
  });

  test("needs an email, and no login yet", async () => {
    await expect(
      inviteWorker(
        {
          db: bossDb({ ...karl, email: null }).client,
          admin: untouchable,
          member: boss,
        },
        KARL,
      ),
    ).rejects.toThrow("Add an email address first");
    await expect(
      inviteWorker(
        {
          db: bossDb({ ...karl, user_id: LOGIN }).client,
          admin: untouchable,
          member: boss,
        },
        KARL,
      ),
    ).rejects.toThrow("already been invited");
  });

  test("a used-up allowance stops it before anything else", async () => {
    await expect(
      inviteWorker(
        { db: bossDb(karl, false).client, admin: untouchable, member: boss },
        KARL,
      ),
    ).rejects.toThrow("allowance");
  });

  test("an address that is confirmed or linked anywhere is refused before sending", async () => {
    for (const login of [
      { user_id: STALE, confirmed: true, linked: false },
      { user_id: STALE, confirmed: false, linked: true },
    ]) {
      const admin = adminFor([login]);
      await expect(
        inviteWorker(
          { db: bossDb().client, admin: admin.client, member: boss },
          KARL,
        ),
      ).rejects.toThrow(EMAIL_TAKEN);
      expect(admin.authCalls).toEqual([]);
    }
  });

  test("an unfinished signup for the address is deleted first, so its password dies with it", async () => {
    const admin = adminFor(
      [{ user_id: STALE, confirmed: false, linked: false }],
      {
        admin: { deleteUser: ok, inviteUserByEmail: sent() },
      },
    );
    await inviteWorker(
      { db: bossDb().client, admin: admin.client, member: boss },
      KARL,
    );
    expect(admin.authCalls.map(([m, a]) => [m, a[0]])).toEqual([
      ["deleteUser", STALE],
      ["inviteUserByEmail", "karl@alpha.test"],
    ]);
  });

  test("sends the invitation naming the company, then links the login without accepting", async () => {
    const db = bossDb();
    const admin = adminFor([], { admin: { inviteUserByEmail: sent() } });
    await inviteWorker(
      { db: db.client, admin: admin.client, member: boss },
      KARL,
    );

    expect(db.rpcCalls).toEqual([["bump_usage", { p_kind: "invite" }]]);
    expect(admin.rpcCalls).toEqual([
      ["login_for_email", { p_email: "karl@alpha.test" }],
    ]);
    expect(admin.authCalls).toEqual([
      [
        "inviteUserByEmail",
        ["karl@alpha.test", { data: { company_name: "Alpha Gardens" } }],
      ],
    ]);
    const [link] = updates(admin.queries);
    expect(argsOf(link!, "update")?.[0]).toMatchObject({
      user_id: LOGIN,
      accepted_at: null,
    });
    for (const filter of <[string, unknown[]][]>[
      ["eq", ["id", KARL]],
      ["eq", ["company_id", COMPANY]],
      ["eq", ["email", "karl@alpha.test"]],
      ["is", ["user_id", null]],
    ])
      expect(link!.calls).toContainEqual(filter);
  });

  test("if linking fails, the new login is deleted rather than left behind", async () => {
    const admin = adminFor([], {
      admin: { inviteUserByEmail: sent(), deleteUser: ok },
      // The link matches nothing (the worker changed meanwhile), and nothing links the login.
      onQuery: () => ({ data: [], error: null }),
    });
    await expect(
      inviteWorker(
        { db: bossDb().client, admin: admin.client, member: boss },
        KARL,
      ),
    ).rejects.toThrow("changed meanwhile");
    expect(admin.authCalls.map(([m]) => m)).toEqual([
      "inviteUserByEmail",
      "deleteUser",
    ]);
  });

  test("says plainly what went wrong with sending", async () => {
    const refusing = (code: string, status = 400) =>
      adminFor([], {
        admin: {
          inviteUserByEmail: () => ({
            data: { user: null },
            error: { name: "AuthApiError", status, code, message: "raw" },
          }),
        },
      }).client;
    const attempt = (code: string, status?: number) =>
      inviteWorker(
        { db: bossDb().client, admin: refusing(code, status), member: boss },
        KARL,
      );
    await expect(attempt("email_exists", 422)).rejects.toThrow(EMAIL_TAKEN);
    await expect(attempt("over_email_send_rate_limit", 429)).rejects.toThrow(
      "Too many emails",
    );
    await expect(attempt("email_address_invalid")).rejects.toThrow(
      "doesn't look right",
    );
    await expect(attempt("email_address_not_authorized")).rejects.toThrow(
      "Email sending isn't set up",
    );
    await expect(attempt("unexpected_failure", 500)).rejects.toThrow(
      "Couldn't send the invitation",
    );
  });
});

describe("resendInvite", () => {
  const invited = { ...karl, user_id: LOGIN };
  const unconfirmed = () => ({
    data: { user: { id: LOGIN, email_confirmed_at: null } },
    error: null,
  });

  test("needs an invitation, and one not yet accepted", async () => {
    await expect(
      resendInvite(
        { db: bossDb().client, admin: untouchable, member: boss },
        KARL,
      ),
    ).rejects.toThrow("Invite them first");
    await expect(
      resendInvite(
        {
          db: bossDb({ ...invited, accepted_at: "2026-09-27T09:00:00Z" })
            .client,
          admin: untouchable,
          member: boss,
        },
        KARL,
      ),
    ).rejects.toThrow("already joined");
  });

  test("someone who has opened the link is told to sign in and accept", async () => {
    const admin = adminFor([], {
      admin: {
        getUserById: () => ({
          data: {
            user: { id: LOGIN, email_confirmed_at: "2026-09-27T09:00:00Z" },
          },
          error: null,
        }),
      },
    });
    await expect(
      resendInvite(
        { db: bossDb(invited).client, admin: admin.client, member: boss },
        KARL,
      ),
    ).rejects.toThrow("already opened");
  });

  test("sends again to the same login and records when", async () => {
    const db = bossDb(invited);
    const admin = adminFor([], {
      admin: { getUserById: unconfirmed, inviteUserByEmail: sent() },
    });
    await resendInvite(
      { db: db.client, admin: admin.client, member: boss },
      KARL,
    );
    expect(db.rpcCalls).toEqual([["bump_usage", { p_kind: "invite" }]]);
    const [stamp] = updates(admin.queries);
    expect(Object.keys(argsOf(stamp!, "update")?.[0] as object)).toEqual([
      "invited_at",
    ]);
    expect(stamp!.calls).toContainEqual(["eq", ["user_id", LOGIN]]);
  });

  test("a different login coming back (the old one vanished) is deleted, not left unlinked", async () => {
    const admin = adminFor([], {
      admin: {
        getUserById: unconfirmed,
        inviteUserByEmail: sent(STALE),
        deleteUser: ok,
      },
    });
    await expect(
      resendInvite(
        { db: bossDb(invited).client, admin: admin.client, member: boss },
        KARL,
      ),
    ).rejects.toThrow("changed meanwhile");
    expect(admin.authCalls.at(-1)).toEqual(["deleteUser", [STALE]]);
    expect(updates(admin.queries)).toEqual([]);
  });
});

describe("removeAccess", () => {
  const linked = {
    ...karl,
    user_id: LOGIN,
    accepted_at: "2026-09-27T09:00:00Z",
  };

  test("not your own, and not a boss's", async () => {
    await expect(
      removeAccess(
        {
          db: bossDb({ ...linked, id: BOSS }).client,
          admin: untouchable,
          member: boss,
        },
        BOSS,
      ),
    ).rejects.toThrow("your own access");
    await expect(
      removeAccess(
        {
          db: bossDb({ ...linked, app_role: "boss" }).client,
          admin: untouchable,
          member: boss,
        },
        KARL,
      ),
    ).rejects.toThrow("A boss's access");
  });

  test("deletes the login, then clears exactly that link", async () => {
    const admin = adminFor([], { admin: { deleteUser: ok } });
    await removeAccess(
      { db: bossDb(linked).client, admin: admin.client, member: boss },
      KARL,
    );
    expect(admin.authCalls).toEqual([["deleteUser", [LOGIN]]]);
    const [unlink] = updates(admin.queries);
    expect(argsOf(unlink!, "update")?.[0]).toEqual({
      user_id: null,
      invited_at: null,
      accepted_at: null,
    });
    expect(unlink!.calls).toContainEqual(["eq", ["company_id", COMPANY]]);
    expect(unlink!.calls).toContainEqual(["eq", ["user_id", LOGIN]]);
  });

  test("a login that's already gone still gets unlinked", async () => {
    const admin = adminFor([], {
      admin: {
        deleteUser: () => ({
          data: null,
          error: {
            name: "AuthApiError",
            status: 404,
            code: "user_not_found",
            message: "x",
          },
        }),
      },
    });
    await removeAccess(
      { db: bossDb(linked).client, admin: admin.client, member: boss },
      KARL,
    );
    expect(updates(admin.queries)).toHaveLength(1);
  });

  test("any other failure leaves the link alone", async () => {
    const admin = adminFor([], {
      admin: {
        deleteUser: () => ({
          data: null,
          error: {
            name: "AuthApiError",
            status: 500,
            code: "unexpected_failure",
            message: "x",
          },
        }),
      },
    });
    await expect(
      removeAccess(
        { db: bossDb(linked).client, admin: admin.client, member: boss },
        KARL,
      ),
    ).rejects.toThrow("Couldn't remove");
    expect(admin.queries).toEqual([]);
  });
});

describe("answering an invitation", () => {
  test("accepting marks only the caller's own pending row", async () => {
    const admin = adminFor([]);
    await acceptInvitation(admin.client, LOGIN);
    const [accept] = updates(admin.queries);
    expect(Object.keys(argsOf(accept!, "update")?.[0] as object)).toEqual([
      "accepted_at",
    ]);
    for (const filter of <[string, unknown[]][]>[
      ["eq", ["user_id", LOGIN]],
      ["is", ["accepted_at", null]],
      ["is", ["archived_at", null]],
    ])
      expect(accept!.calls).toContainEqual(filter);
  });

  test("with nothing pending there is nothing to accept", async () => {
    const admin = adminFor([], { onQuery: () => ({ data: [], error: null }) });
    await expect(acceptInvitation(admin.client, LOGIN)).rejects.toThrow(
      "no invitation",
    );
  });

  test("declining unlinks the caller's pending row, never an accepted one", async () => {
    const admin = adminFor([]);
    await declineInvitation(admin.client, LOGIN);
    const [decline] = updates(admin.queries);
    expect(argsOf(decline!, "update")?.[0]).toEqual({
      user_id: null,
      invited_at: null,
    });
    expect(decline!.calls).toContainEqual(["eq", ["user_id", LOGIN]]);
    expect(decline!.calls).toContainEqual(["is", ["accepted_at", null]]);
  });
});
