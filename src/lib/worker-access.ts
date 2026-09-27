import type { Worker } from "./types";

/**
 * Where a worker stands with the app:
 *   - none: no login; the boss can invite them once they have an email;
 *   - invited: a login is linked, but the invitation link hasn't been opened yet;
 *   - active: they've accepted and can sign in.
 */
export type AccessState = "none" | "invited" | "active";

export function accessState(
  worker: Pick<Worker, "hasLogin" | "joinedAt">,
): AccessState {
  if (!worker.hasLogin) return "none";
  return worker.joinedAt ? "active" : "invited";
}
