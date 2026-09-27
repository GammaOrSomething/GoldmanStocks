/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Member } from "@/lib/auth/access";
import type { Database } from "@/lib/supabase/types";
import {
  EMAIL_TAKEN,
  inviteWorker,
  removeAccess,
  resendInvite,
} from "./invites";

// The database rules (who may link a login, company isolation) are covered by the SQL security
// tests; these cover the order of steps and what each refusal says.

type Client = SupabaseClient<Database>;
type Result = { data: unknown; error: unknown };
/** One query as the code built it: the table and every method called on it, in order. */
type Query = { table: string; calls: [string, unknown[]][] };

const COMPANY = "0b4f3d2e-8a41-4c1e-9d1f-2f6a1c9e7b10";
const BOSS = "11111111-1111-4111-8111-111111111111";
const KARL = "22222222-2222-4222-8222-222222222222";
const LOGIN = "33333333-3333-4333-8333-333333333333";

const boss: Member = {
  workerId: BOSS,
  companyId: COMPANY,
  companyName: "Alpha Gardens",
  role: "boss",
  name: "Anna Boss",
};

const karl = {
  id: KARL,
  email: "karl@alpha.test",
  user_id: null as string | null,
  app_role: "worker" as "boss" | "worker",
  archived_at: null as string | null,
};

const has = (q: Query, method: string) => q.calls.some(([m]) => m === method);
const argsOf = (q: Query, method: string) =>
  q.calls.find(([m]) => m === method)?.[1];

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
    rpc: async (fn: string, args: unknown) =>
      opts.rpc ? opts.rpc(fn, args) : { data: null, error: null },
    auth: { admin },
  } as unknown as Client;
  return { client, queries, authCalls };
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

/** The boss's session: reads Karl, and spends the invite allowance. */
function bossDb(worker: typeof karl | null = karl, allowed = true) {
  const rpcCalls: [string, unknown][] = [];
  const db = fake(() => ({ data: worker, error: null }), {
    rpc: (fn, args) => {
      rpcCalls.push([fn, args]);
      return { data: allowed, error: null };
    },
  });
  return { ...db, rpcCalls };
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
    const { client } = bossDb(null);
    await expect(
      inviteWorker({ db: client, admin: untouchable, member: boss }, KARL),
    ).rejects.toThrow("Worker not found");
  });

  test("needs an email, and no login yet", async () => {
    await expect(
      inviteWorker(
        {
          db: bossDb({ ...karl, email: null as unknown as string }).client,
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

  test("an email that already has a login anywhere is refused before sending", async () => {
    const admin = fake(() => ({ data: [{ id: "someone-else" }], error: null }));
    await expect(
      inviteWorker(
        { db: bossDb().client, admin: admin.client, member: boss },
        KARL,
      ),
    ).rejects.toThrow(EMAIL_TAKEN);
    expect(admin.authCalls).toEqual([]);
  });

  test("a used-up allowance stops it before any email", async () => {
    await expect(
      inviteWorker(
        { db: bossDb(karl, false).client, admin: untouchable, member: boss },
        KARL,
      ),
    ).rejects.toThrow("allowance");
  });

  test("sends the invitation, then links the login to the worker in this company", async () => {
    const db = bossDb();
    const admin = fake(
      (q) =>
        has(q, "update")
          ? { data: [{ id: KARL }], error: null }
          : { data: [], error: null },
      {
        admin: {
          inviteUserByEmail: () => ({
            data: { user: { id: LOGIN } },
            error: null,
          }),
        },
      },
    );
    await inviteWorker(
      { db: db.client, admin: admin.client, member: boss },
      KARL,
    );

    expect(db.rpcCalls).toEqual([["bump_usage", { p_kind: "invite" }]]);
    expect(admin.authCalls).toEqual([
      ["inviteUserByEmail", ["karl@alpha.test"]],
    ]);
    const link = admin.queries.find((q) => has(q, "update"))!;
    expect(argsOf(link, "update")?.[0]).toMatchObject({ user_id: LOGIN });
    expect(link.calls).toContainEqual(["eq", ["id", KARL]]);
    expect(link.calls).toContainEqual(["eq", ["company_id", COMPANY]]);
    expect(link.calls).toContainEqual(["is", ["user_id", null]]);
  });

  test("says plainly when the email already has an account, or too many emails went out", async () => {
    const refusing = (error: object) =>
      fake(() => ({ data: [], error: null }), {
        admin: { inviteUserByEmail: () => ({ data: { user: null }, error }) },
      }).client;
    await expect(
      inviteWorker(
        {
          db: bossDb().client,
          admin: refusing({
            name: "AuthApiError",
            status: 422,
            code: "email_exists",
            message: "x",
          }),
          member: boss,
        },
        KARL,
      ),
    ).rejects.toThrow(EMAIL_TAKEN);
    await expect(
      inviteWorker(
        {
          db: bossDb().client,
          admin: refusing({
            name: "AuthApiError",
            status: 429,
            code: "over_email_send_rate_limit",
            message: "x",
          }),
          member: boss,
        },
        KARL,
      ),
    ).rejects.toThrow("Too many emails");
  });
});

describe("resendInvite", () => {
  const invited = { ...karl, user_id: LOGIN };

  test("refuses someone who has already joined", async () => {
    const admin = fake(() => ({ data: null, error: null }), {
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
    ).rejects.toThrow("already joined");
  });

  test("sends again and records when", async () => {
    const db = bossDb(invited);
    const admin = fake(() => ({ data: [{ id: KARL }], error: null }), {
      admin: {
        getUserById: () => ({
          data: { user: { id: LOGIN, email_confirmed_at: null } },
          error: null,
        }),
        inviteUserByEmail: () => ({
          data: { user: { id: LOGIN } },
          error: null,
        }),
      },
    });
    await resendInvite(
      { db: db.client, admin: admin.client, member: boss },
      KARL,
    );
    expect(db.rpcCalls).toEqual([["bump_usage", { p_kind: "invite" }]]);
    expect(admin.authCalls.map(([m]) => m)).toEqual([
      "getUserById",
      "inviteUserByEmail",
    ]);
    const stamp = admin.queries.find((q) => has(q, "update"))!;
    expect(Object.keys(argsOf(stamp, "update")?.[0] as object)).toEqual([
      "invited_at",
    ]);
  });

  test("needs an invitation to resend", async () => {
    await expect(
      resendInvite(
        { db: bossDb().client, admin: untouchable, member: boss },
        KARL,
      ),
    ).rejects.toThrow("Invite them first");
  });
});

describe("removeAccess", () => {
  const linked = { ...karl, user_id: LOGIN };

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

  test("deletes the login, then clears the link", async () => {
    const admin = fake(() => ({ data: [{ id: KARL }], error: null }), {
      admin: { deleteUser: () => ({ data: {}, error: null }) },
    });
    await removeAccess(
      { db: bossDb(linked).client, admin: admin.client, member: boss },
      KARL,
    );
    expect(admin.authCalls).toEqual([["deleteUser", [LOGIN]]]);
    const unlink = admin.queries.find((q) => has(q, "update"))!;
    expect(argsOf(unlink, "update")?.[0]).toEqual({
      user_id: null,
      invited_at: null,
    });
    expect(unlink.calls).toContainEqual(["eq", ["company_id", COMPANY]]);
  });

  test("a login that's already gone still gets unlinked", async () => {
    const admin = fake(() => ({ data: [{ id: KARL }], error: null }), {
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
    expect(admin.queries.some((q) => has(q, "update"))).toBe(true);
  });

  test("any other failure leaves the link alone", async () => {
    const admin = fake(() => ({ data: [], error: null }), {
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
