import {
  isAuthRetryableFetchError,
  type SupabaseClient,
} from "@supabase/supabase-js";

import { spendAllowance } from "@/lib/api/usage";
import type { Member } from "@/lib/auth/access";
import type { Database } from "@/lib/supabase/types";

/**
 * Worker invitations and removing access: the one place besides the weather cache that uses the
 * service-role key.
 *
 * Every function gets two clients:
 *   - `db`, the boss's own session. The worker is read through it, so row-level security proves
 *     they're in the boss's company, and the invite allowance is spent against that company.
 *   - `admin`, the service role. Used only to send Supabase's invite email, delete a login, and
 *     link or unlink it: `guard_worker_update` lets only the server change `workers.user_id`.
 *     Its writes still name the boss's company, so a bug can't reach another one.
 */

type Client = SupabaseClient<Database>;
export type InviteContext = { db: Client; admin: Client; member: Member };

export const EMAIL_TAKEN =
  "This email already has a Goldman Stocks account. One account belongs to one company.";
const TOO_MANY_EMAILS =
  "Too many emails have gone out just now. Try again in a few minutes.";

type AuthRefusal = {
  status?: number | undefined;
  code?: string | undefined;
  message: string;
};

/** What the boss is told when Supabase won't send an invitation. */
function inviteError(error: AuthRefusal): string {
  if (isAuthRetryableFetchError(error))
    return "Couldn't reach the email service. Try again.";
  if (error.code === "email_exists") return EMAIL_TAKEN;
  if (
    error.status === 429 ||
    error.code === "over_email_send_rate_limit" ||
    error.code === "over_request_rate_limit"
  )
    return TOO_MANY_EMAILS;
  return "Couldn't send the invitation. Try again.";
}

async function readWorker(ctx: InviteContext, workerId: string) {
  if (ctx.member.role !== "boss") throw new Error("Only a boss can do this");
  const { data, error } = await ctx.db
    .from("workers")
    .select("id, email, user_id, app_role, archived_at")
    .eq("id", workerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.archived_at) throw new Error("Worker not found");
  return data;
}

/**
 * Invite a worker to the app: Supabase emails them a link (supabase/templates/invite.html) to
 * /auth/confirm, then /auth/set-password. The login is linked to the worker straight away, so
 * the moment they open the link they're a member of this company, never a stranger sent to
 * onboarding.
 */
export async function inviteWorker(ctx: InviteContext, workerId: string) {
  const worker = await readWorker(ctx, workerId);
  if (!worker.email) throw new Error("Add an email address first");
  if (worker.user_id)
    throw new Error(
      "They've already been invited. Resend the invitation instead.",
    );

  // Before the account check below: that check says whether an address has an account, so
  // the daily allowance also caps how many addresses a boss can try.
  await spendAllowance(ctx.db, "invite");

  // One account belongs to one company. Supabase refuses a confirmed address itself, but an
  // unconfirmed one (invited by another company, not yet accepted) it would simply re-invite.
  const { data: taken, error: takenError } = await ctx.admin
    .from("workers")
    .select("id")
    .eq("email", worker.email)
    .not("user_id", "is", null)
    .limit(1);
  if (takenError) throw new Error(takenError.message);
  if (taken?.length) throw new Error(EMAIL_TAKEN);

  const { data: sent, error: sendError } =
    await ctx.admin.auth.admin.inviteUserByEmail(worker.email);
  if (sendError) throw new Error(inviteError(sendError));

  const { data: linked, error: linkError } = await ctx.admin
    .from("workers")
    .update({ user_id: sent.user.id, invited_at: new Date().toISOString() })
    .eq("id", worker.id)
    .eq("company_id", ctx.member.companyId)
    .is("user_id", null)
    .select("id");
  if (linkError)
    throw new Error(
      linkError.code === "23505" ? EMAIL_TAKEN : linkError.message,
    );
  if (!linked?.length)
    throw new Error("This worker was changed meanwhile. Reload and try again.");
}

/** Send the invitation again, to someone who hasn't opened it yet. */
export async function resendInvite(ctx: InviteContext, workerId: string) {
  const worker = await readWorker(ctx, workerId);
  if (!worker.user_id || !worker.email) throw new Error("Invite them first");

  const { data: login, error: loginError } =
    await ctx.admin.auth.admin.getUserById(worker.user_id);
  if (loginError) throw new Error(loginError.message);
  if (login.user.email_confirmed_at)
    throw new Error("They've already joined and can sign in.");

  await spendAllowance(ctx.db, "invite");
  // Supabase sends a fresh invitation to an address that hasn't confirmed yet.
  const { error: sendError } = await ctx.admin.auth.admin.inviteUserByEmail(
    worker.email,
  );
  if (sendError) throw new Error(inviteError(sendError));

  const { error } = await ctx.admin
    .from("workers")
    .update({ invited_at: new Date().toISOString() })
    .eq("id", worker.id)
    .eq("company_id", ctx.member.companyId);
  if (error) throw new Error(error.message);
}

/**
 * Take away someone's login; they stay in the crew, with their jobs and history, and can be
 * invited again. Also cancels an invitation not yet accepted.
 *
 * Deleting the login ends their access at once: `private.company_id()` looks the login up on
 * every request, and the foreign key clears `workers.user_id`. The link is also cleared here,
 * so a login that was already gone doesn't leave the worker marked as having one.
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
    throw new Error("Couldn't remove the login. Try again.");

  const { error } = await ctx.admin
    .from("workers")
    .update({ user_id: null, invited_at: null })
    .eq("id", worker.id)
    .eq("company_id", ctx.member.companyId);
  if (error) throw new Error(error.message);
}
