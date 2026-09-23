import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";

import { emptyClientStats, summarizeClients } from "../client-stats";
import { currentMonth, monthRangeUtc } from "../month";
import type { Client } from "../types";
import { toClient } from "./mappers";
import { companyId, nextId } from "./ids";
import { getAuthedClient } from "./session";

/** Every client, with its site and plant counts and this month's proven hours. */
export const listClients = createServerFn({ method: "GET" }).handler(
  async (): Promise<Client[]> => {
    const db = await getAuthedClient();
    const { startUtc, endUtc } = monthRangeUtc(currentMonth());
    const [clients, projects, plants, tasks, photos] = await Promise.all([
      db.from("clients").select("*").order("id"),
      db.from("projects").select("id, client_id"),
      db.from("plants").select("project_id"),
      db.from("tasks").select("id, project_id, duration"),
      db
        .from("task_photos")
        .select("task_id, taken_at")
        .gte("taken_at", startUtc)
        .lt("taken_at", endUtc),
    ]);
    for (const result of [clients, projects, plants, tasks, photos])
      if (result.error) throw new Error(result.error.message);

    const stats = summarizeClients({
      projects: (projects.data ?? []).map((p) => ({
        id: p.id,
        clientId: p.client_id,
      })),
      plants: (plants.data ?? []).map((p) => ({ projectId: p.project_id })),
      tasks: (tasks.data ?? []).map((t) => ({
        id: t.id,
        projectId: t.project_id,
        duration: Number(t.duration),
      })),
      photos: (photos.data ?? []).map((p) => ({
        taskId: p.task_id,
        takenAt: p.taken_at,
      })),
    });
    return (clients.data ?? []).map((row) =>
      toClient(row, stats.get(row.id) ?? emptyClientStats),
    );
  },
);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ClientInput = z.object({
  /** omit to create a new client */
  id: z.string().optional(),
  name: z.string().trim().min(1, "Name is required"),
  city: z.string().trim().min(1, "City is required"),
  contact: z.string().trim(),
  monthlyValue: z.number().min(0),
  contractUntil: isoDate.or(z.literal("")),
  health: z.enum(["good", "watch", "at risk"]),
});
export type ClientInput = z.infer<typeof ClientInput>;

/** Create or update a client. New clients start with no sites or plants. */
export const saveClient = createServerFn({ method: "POST" })
  .validator(ClientInput)
  .handler(async ({ data }): Promise<{ id: string }> => {
    const db = await getAuthedClient();
    const row = {
      name: data.name,
      city: data.city,
      contact: data.contact,
      monthly_value: data.monthlyValue,
      contract_until: data.contractUntil || null,
      health: data.health,
    };
    if (data.id) {
      const { error } = await db.from("clients").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const id = await nextId(db, "clients", "c");
    const { error } = await db
      .from("clients")
      .insert({ ...row, id, company_id: await companyId(db) });
    if (error) throw new Error(error.message);
    return { id };
  });
