import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";

import { requireMember, requireUserId } from "@/lib/api/session";
import {
  acceptInvitation,
  declineInvitation,
  inviteWorker as inviteWorkerImpl,
  removeAccess as removeAccessImpl,
  resendInvite as resendInviteImpl,
  type InviteContext,
} from "@/lib/server/invites";

// Server functions only: safe to import from routes. Each runs on the boss's own session, plus
// the service-role client for the steps only the server may take (see src/lib/server/invites.ts).
// The client is imported inside the handler because `@/lib/supabase/server` is server-only.

async function adminClient() {
  const { getAdminClient } = await import("@/lib/supabase/server");
  return getAdminClient();
}

async function context(): Promise<InviteContext> {
  const { db, member } = await requireMember();
  return { db, admin: await adminClient(), member };
}

/** Email a worker an invitation to the app and link the new login to them. Boss only. */
export const inviteWorker = createServerFn({ method: "POST" })
  .validator(z.uuid())
  .handler(async ({ data: workerId }) => {
    await inviteWorkerImpl(await context(), workerId);
    return { id: workerId };
  });

/** Send the invitation again to someone who hasn't opened it. Boss only. */
export const resendInvite = createServerFn({ method: "POST" })
  .validator(z.uuid())
  .handler(async ({ data: workerId }) => {
    await resendInviteImpl(await context(), workerId);
    return { id: workerId };
  });

/** Delete a worker's login (or cancel their invitation); they stay in the crew. Boss only. */
export const removeAccess = createServerFn({ method: "POST" })
  .validator(z.uuid())
  .handler(async ({ data: workerId }) => {
    await removeAccessImpl(await context(), workerId);
    return { id: workerId };
  });

/** The signed-in person joins the company that invited them (the /join page). */
export const acceptInvite = createServerFn({ method: "POST" }).handler(
  async () => {
    const userId = await requireUserId();
    await acceptInvitation(await adminClient(), userId);
    return { accepted: true };
  },
);

/** The signed-in person says the invitation isn't for them; they go on to set up their own. */
export const declineInvite = createServerFn({ method: "POST" }).handler(
  async () => {
    const userId = await requireUserId();
    await declineInvitation(await adminClient(), userId);
    return { declined: true };
  },
);
