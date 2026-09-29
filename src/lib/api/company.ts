import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";

import type { Database } from "../supabase/types";
import { getAuthedClient, requireBoss, requireMember } from "./session";

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

export const CompanyAreaInput = z.object({
  city: z.string().trim().min(1, "Pick a place").max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type CompanyAreaInput = z.infer<typeof CompanyAreaInput>;

/**
 * Write the area on the caller's own session. Row-level security turns a refused update into
 * "no rows" rather than an error, so that is reported instead of passing silently.
 */
export async function updateCompanyArea(
  db: SupabaseClient<Database>,
  companyId: string,
  area: CompanyAreaInput,
): Promise<void> {
  const { data: rows, error } = await db
    .from("companies")
    .update({ city: area.city, lat: area.lat, lng: area.lng })
    .eq("id", companyId)
    .select("id");
  if (error)
    throw new Error("Couldn't save where the company is based. Try again.");
  if (!rows?.length) throw new Error("Only a boss can change this");
}

/**
 * Where the company is based: the dashboard's forecast and the maps use it until it has sites.
 * Boss only; the database also allows only a boss to change it.
 */
export const saveCompanyArea = createServerFn({ method: "POST" })
  .validator(CompanyAreaInput)
  .handler(async ({ data }): Promise<void> => {
    const db = await requireBoss();
    const { member } = await requireMember(); // cached for the request: no second lookup
    await updateCompanyArea(db, member.companyId, data);
  });
