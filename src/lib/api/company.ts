import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";

import { getAuthedClient } from "./session";

export const CompanyInput = z.object({
  companyName: z.string().trim().min(1, "Company name is required").max(200),
  fullName: z.string().trim().min(1, "Your name is required").max(200),
});
export type CompanyInput = z.infer<typeof CompanyInput>;

/**
 * Onboarding: create the company and make the signed-in person its boss. The database takes
 * who they are from their login, and refuses if they already belong to a company.
 */
export const createCompany = createServerFn({ method: "POST" })
  .validator(CompanyInput)
  .handler(async ({ data }): Promise<{ companyId: string }> => {
    const { data: companyId, error } = await (
      await getAuthedClient()
    ).rpc("create_company", {
      company_name: data.companyName,
      full_name: data.fullName,
    });
    if (error)
      throw new Error(
        error.code === "23505"
          ? "This account already belongs to a company."
          : "Couldn't set up the company. Try again.",
      );
    return { companyId };
  });
