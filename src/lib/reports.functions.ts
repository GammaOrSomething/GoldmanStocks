import { createServerFn } from "@tanstack/react-start";
import { requireBoss } from "@/lib/api/session";

import {
  ClientReportInput,
  clientReport as clientReportImpl,
} from "@/lib/server/reports";

/**
 * Server-function wrapper for the monthly client report. Boss-only, and on the caller's own
 * session: row-level security keeps it to their company, and the storage policies let a member
 * sign their company's photos.
 */
export const clientReport = createServerFn({ method: "GET" })
  .validator((input: ClientReportInput) => ClientReportInput.parse(input))
  .handler(async ({ data }) => clientReportImpl(await requireBoss(), data));
