import { createServerFn } from "@tanstack/react-start";
import { getAuthedClient } from "@/lib/api/session";

import {
  ClientReportInput,
  clientReport as clientReportImpl,
} from "@/lib/server/reports";

/**
 * Server-function wrapper for the monthly client report.
 *
 * It uses the service-role client rather than the request's session because the report signs
 * URLs into the private `task-photos` bucket, which has no storage policies. As in
 * `photos.functions.ts`, the client is imported inside the handler: `@/lib/supabase/server` is
 * marked server-only, and a static import would pull it into the browser's module graph.
 */
export const clientReport = createServerFn({ method: "GET" })
  .validator((input: ClientReportInput) => ClientReportInput.parse(input))
  .handler(async ({ data }) => {
    await getAuthedClient(); // signed-in callers only
    const { getAdminClient } = await import("@/lib/supabase/server");
    return clientReportImpl(getAdminClient(), data);
  });
