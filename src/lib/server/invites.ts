import {
  isAuthRetryableFetchError,
  type SupabaseClient,
} from "@supabase/supabase-js";

import { spendAllowance } from "@/lib/api/usage";
import type { Member } from "@/lib/auth/access";
import type { Database } from "@/lib/supabase/types";

/**
 * Worker invitations: the one place besides the weather cache that uses the service-role key.
 *
 * The boss's actions get two clients:
 *   - `db`, the boss's own session. The worker is read through it, so row-level security proves
 *     they're in the boss's company, and the invite allowance is spent against that company.
 *   - `admin`, the service role. Used only to send Supabase's invite email, find or delete a
 *     login, and link, unlink or accept: `guard_worker_update` lets only the server change
 *     `workers.user_id` and `accepted_at`. Its writes still name the boss's company.
 *
 * A linked login is not yet a member: the invited person accepts on /join
 * (`acceptInvitation`), or says it isn't them (`declineInvitation`).
 */

type Client = SupabaseClient<Database>;
export type InviteContext = { db: Client; admin: Client; member: Member };

export const EMAIL_TAKEN =
  "This email already has a Goldman Stocks account. One account belongs to one company.";
const TOO_MANY_EMAILS =
  "Too many emails have gone out just now. Try again in a few minutes.";
const CHANGED = "This worker was changed meanwhile. Reload and try again.";
const ALREADY_OPENED =
  "They've already opened the invitation. They can sign in to accept it.";

type AuthRefusal = {
  status?: number | undefined;
  code?: string | undefined;
  message: string;
};

/** What the boss is told when Supabase won't send an invitation. */
function inviteError(error: AuthRefusal): string {
  if (isAuthRetryableFetchError(error))
    return "Couldn't reach the email service. Try again.";
  switch (error.code) {
    case "email_exists":
      return EMAIL_TAKEN;
    case "email_address_invalid":
    case "validation_failed":
      return "That email address doesn't look right.";
    case "email_address_not_authorized":
      return "Email sending isn't set up yet, so invitations can't go out. (The project needs its own SMTP server.)";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return TOO_MANY_EMAILS;
  }
  if (error.status === 429) return TOO_MANY_EMAILS;
  console.error("invitation email refused", error);
  return "Couldn't send the invitation. Try again.";
}

/** Log the real cause on the server; tell the browser only what it can act on. */
function fail(message: string, cause: unknown): never {
  console.error(message, cause);
  throw new Error(message);
}

async function readWorker(ctx: InviteContext, workerId: string) {
  if (ctx.member.role !== "boss") throw new Error("Only a boss can do this");
  const { data, error } = await ctx.db
    .from("workers")
    .select("id, email, user_id, app_role, accepted_at, archived_at")
    .eq("id", workerId)
    .maybeSingle();
  if (error) fail("Couldn't read the worker. Try again.", error);
  if (!data || data.archived_at) throw new Error("Worker not found");
  return data;
}

/** Delete a login we just created, unless something links to it by now. */
async function discardLogin(admin: Client, userId: string) {
  const { data, error } = await admin
    .from("workers")
    .select("id")
    .eq("user_id", userId)
    .limit(1);
  if (error || data?.length) return;
  await admin.auth.admin.deleteUser(userId);
}

/**
 * Invite a worker to the app: Supabase emails them a link (supabase/templates/invite.html) to
 * /auth/confirm, then /auth/set-password and /join. The login is linked to the worker now, so
 * their answer on /join can only be about this company, which that page names; it counts as
 * membership only once they accept.
 *
 * The company name also goes with the invitation (`data.company_name`), for the email to show
 * once it's confirmed that Supabase's templates escape it: bosses choose the name.
 */
export async function inviteWorker(ctx: InviteContext, workerId: string) {
  const worker = await readWorker(ctx, workerId);
  const email = worker.email;
  if (!email) throw new Error("Add an email address first");
  if (worker.user_id)
    throw new Error(
      "They've already been invited. Resend the invitation instead.",
    );

  // Before the account lookup below: it says whether an address has an account, so the daily
  // allowance also caps how many addresses a boss can try.
  await spendAllowance(ctx.db, "invite");

  // One account belongs to one company. A confirmed or linked address is taken. An unconfirmed,
  // unlinked one is a signup nobody finished: Supabase would re-invite that same login and keep
  // whatever password its creator chose, so it goes first.
  const { data: existing, error: lookupError } = await ctx.admin.rpc(
    "login_for_email",
    { p_email: email },
  );
  if (lookupError) fail("Couldn't check the address. Try again.", lookupError);
  for (const login of existing ?? []) {
    if (login.confirmed || login.linked) throw new Error(EMAIL_TAKEN);
    const { error } = await ctx.admin.auth.admin.deleteUser(login.user_id);
    if (error && error.status !== 404)
      fail("Couldn't prepare the invitation. Try again.", error);
  }

  const { data: sent, error: sendError } =
    await ctx.admin.auth.admin.inviteUserByEmail(email, {
      data: { company_name: ctx.member.companyName },
    });
  if (sendError) throw new Error(inviteError(sendError));

  // Only if the row is still as it was read: no login, and the same address.
  const { data: linked, error: linkError } = await ctx.admin
    .from("workers")
    .update({
      user_id: sent.user.id,
      invited_at: new Date().toISOString(),
      accepted_at: null,
    })
    .eq("id", worker.id)
    .eq("company_id", ctx.member.companyId)
    .eq("email", email)
    .is("user_id", null)
    .select("id");
  if (linkError || !linked?.length) {
    await discardLogin(ctx.admin, sent.user.id);
    if (linkError?.code === "23505") throw new Error(EMAIL_TAKEN);
    if (linkError)
      fail("Couldn't record the invitation. Try again.", linkError);
    throw new Error(CHANGED);
  }
}

/** Send the invitation again, to someone who hasn't opened it yet. */
export async function resendInvite(ctx: InviteContext, workerId: string) {
  const worker = await readWorker(ctx, workerId);
  if (!worker.user_id || !worker.email) throw new Error("Invite them first");
  if (worker.accepted_at)
    throw new Error("They've already joined and can sign in.");

  const { data: login, error: loginError } =
    await ctx.admin.auth.admin.getUserById(worker.user_id);
  if (loginError) fail("Couldn't check the invitation. Try again.", loginError);
  if (login.user.email_confirmed_at) throw new Error(ALREADY_OPENED);

  await spendAllowance(ctx.db, "invite");
  // Supabase sends a fresh invitation to an address that hasn't confirmed yet.
  const { data: sent, error: sendError } =
    await ctx.admin.auth.admin.inviteUserByEmail(worker.email, {
      data: { company_name: ctx.member.companyName },
    });
  if (sendError)
    throw new Error(
      sendError.code === "email_exists"
        ? ALREADY_OPENED
        : inviteError(sendError),
    );
  // A different login means the linked one vanished meanwhile; don't leave a stray one behind.
  if (sent.user.id !== worker.user_id) {
    await ctx.admin.auth.admin.deleteUser(sent.user.id);
    throw new Error(CHANGED);
  }

  const { error } = await ctx.admin
    .from("workers")
    .update({ invited_at: new Date().toISOString() })
    .eq("id", worker.id)
    .eq("company_id", ctx.member.companyId)
    .eq("user_id", worker.user_id);
  if (error) fail("Couldn't record the invitation. Try again.", error);
}

/**
 * Take away someone's login; they stay in the crew, with their jobs and history, and can be
 * invited again. Also cancels an invitation not yet accepted.
 *
 * Deleting the login ends their access at once: `private.company_id()` looks the login up on
 * every request, and the foreign key clears `workers.user_id`. The link is also cleared here,
 * so a login that was already gone doesn't leave the worker marked as having one; only the
 * link that was read, so a newer invitation isn't undone by a stale click.
 *
 * Not for yourself, and not for a boss, so a company can't lock itself out.
 */
export async function removeAccess(ctx: InviteContext, workerId: string) {
  const worker = await readWorker(ctx, workerId);
  if (worker.id === ctx.member.workerId)
    throw new Error("You can't remove your own access");
  if (worker.app_role === "boss")
    throw new Error("A boss's access can't be removed here");
  if (!worker.user_id) return;

  const { error: deleteError } = await ctx.admin.auth.admin.deleteUser(
    worker.user_id,
  );
  if (deleteError && deleteError.status !== 404)
    fail("Couldn't remove the login. Try again.", deleteError);

  const { error } = await ctx.admin
    .from("workers")
    .update({ user_id: null, invited_at: null, accepted_at: null })
    .eq("id", worker.id)
    .eq("company_id", ctx.member.companyId)
    .eq("user_id", worker.user_id);
  if (error) fail("Couldn't remove the login. Try again.", error);
}

/**
 * The signed-in person accepts the invitation linked to their login: from now on they're a
 * member. `userId` comes from their verified session, never from the request.
 */
export async function acceptInvitation(admin: Client, userId: string) {
  const { data, error } = await admin
    .from("workers")
    .update({ accepted_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("accepted_at", null)
    .is("archived_at", null)
    .select("id");
  if (error) fail("Couldn't accept the invitation. Try again.", error);
  if (!data?.length) throw new Error("There's no invitation to accept.");
}

/**
 * The signed-in person says the invitation isn't for them: the login is unlinked, and they carry
 * on to set up their own company. An accepted membership is never touched here.
 */
export async function declineInvitation(admin: Client, userId: string) {
  const { error } = await admin
    .from("workers")
    .update({ user_id: null, invited_at: null })
    .eq("user_id", userId)
    .is("accepted_at", null);
  if (error) fail("Couldn't decline the invitation. Try again.", error);
}
