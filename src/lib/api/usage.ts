import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../supabase/types";

type Kind = Database["public"]["Functions"]["bump_usage"]["Args"]["p_kind"];

/**
 * Count one use of a paid feature against the company's daily allowance, or refuse once it's
 * spent. The limits live in the database (private.usage_limits), so no caller can raise them.
 * Needs the boss's own session: the service role has no company to count against.
 */
export async function spendAllowance(
  db: SupabaseClient<Database>,
  kind: Kind,
): Promise<void> {
  const { data: allowed, error } = await db.rpc("bump_usage", { p_kind: kind });
  if (error) throw new Error(error.message);
  if (!allowed)
    throw new Error(
      "Today's allowance for this feature is used up; try again tomorrow",
    );
}
