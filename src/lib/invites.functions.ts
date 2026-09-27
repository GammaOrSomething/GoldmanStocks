import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";

import { requireMember } from "@/lib/api/session";
import {
  inviteWorker as inviteWorkerImpl,
  removeAccess as removeAccessImpl,
  resendInvite as resendInviteImpl,
  type InviteContext,
} from "@/lib/server/invites";

// Server functions only: safe to import from routes. Each runs on the boss's own session, plus
// the service-role client for the steps only the server may take (see src/lib/server/invites.ts).
// The client is imported inside the handler because `@/lib/supabase/server` is server-only.

async function context(): Promise<InviteContext> {
  const { db, member } = await requireMember();
  const { getAdminClient } = await import("@/lib/supabase/server");
  return { db, admin: getAdminClient(), member };
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
