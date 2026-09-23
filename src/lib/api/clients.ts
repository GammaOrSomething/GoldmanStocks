import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";

import { emptyClientStats, type ClientStats } from "../client-stats";
import { currentMonth, monthRangeUtc } from "../month";
import type { Client } from "../types";
import { toClient, type Terms } from "./mappers";
import { getAuthedClient, requireBoss } from "./session";

/**
 * Every client, with its site and plant counts and this month's proven hours.
 *
 * The counts come from the `client_stats` database function rather than from fetching every
 * site, plant and photo: Supabase caps a query at 1,000 rows, which would quietly undercount.
 * `summarizeClients` in ../client-stats is the tested reference for what it computes.
 */
export const listClients = createServerFn({ method: "GET" }).handler(
  async (): Promise<Client[]> => {
    const db = await getAuthedClient();
    const { startUtc, endUtc } = monthRangeUtc(currentMonth());
    const [clients, stats, terms] = await Promise.all([
      db.from("clients").select("*").order("name"),
      db.rpc("client_stats", { p_from: startUtc, p_to: endUtc }),
      // Boss-only; a worker gets no rows, and sees no money.
      db
        .from("client_terms")
        .select("client_id, monthly_value, contract_until"),
    ]);
    for (const result of [clients, stats, terms])
      if (result.error) throw new Error(result.error.message);

    const statsById = new Map<string, ClientStats>(
      (stats.data ?? []).map((s) => [
        s.client_id,
        { sites: s.sites, plants: s.plants, hoursThisMonth: Number(s.hours) },
      ]),
    );
    const termsById = new Map<string, Terms>(
      (terms.data ?? []).map((t) => [t.client_id, t]),
    );
    return (clients.data ?? []).map((row) =>
      toClient(
        row,
        statsById.get(row.id) ?? emptyClientStats,
        termsById.get(row.id),
      ),
    );
  },
);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ClientInput = z.object({
  /** omit to create a new client */
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Name is required").max(200),
  city: z.string().trim().min(1, "City is required").max(200),
  contact: z.string().trim().max(1000),
  monthlyValue: z.number().min(0),
  contractUntil: isoDate.or(z.literal("")),
  health: z.enum(["good", "watch", "at risk"]),
});
export type ClientInput = z.infer<typeof ClientInput>;

/** Create or update a client and its contract terms. New clients start with no sites. */
export const saveClient = createServerFn({ method: "POST" })
  .validator(ClientInput)
  .handler(async ({ data }): Promise<{ id: string }> => {
    const db = await requireBoss();
    const row = {
      name: data.name,
      city: data.city,
      contact: data.contact,
      health: data.health,
    };

    let id = data.id;
    if (id) {
      const { error } = await db.from("clients").update(row).eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const { data: created, error } = await db
        .from("clients")
        .insert(row)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      id = created.id;
    }

    const { error: termsError } = await db.from("client_terms").upsert({
      client_id: id,
      monthly_value: data.monthlyValue,
      contract_until: data.contractUntil || null,
    });
    if (termsError) throw new Error(termsError.message);
    return { id };
  });
