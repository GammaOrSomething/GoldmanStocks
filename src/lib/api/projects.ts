import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";

import type { Project, Worker } from "../types";
import { clientNameById } from "./lookups";
import { toProject, toWorker } from "./mappers";
import { nextId } from "./ids";
import { getAuthedClient } from "./session";

/** Every work site (project). */
export const listProjects = createServerFn({ method: "GET" }).handler(
  async (): Promise<Project[]> => {
    const [{ data, error }, nameByClient] = await Promise.all([
      (await getAuthedClient()).from("projects").select("*").order("id"),
      clientNameById(),
    ]);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) =>
      toProject(row, nameByClient.get(row.client_id) ?? ""),
    );
  },
);

/** One work site, or null for an unknown id. */
export const getProject = createServerFn({ method: "GET" })
  .validator((projectId: string) => projectId)
  .handler(async ({ data: projectId }): Promise<Project | null> => {
    const [{ data, error }, nameByClient] = await Promise.all([
      (await getAuthedClient())
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .maybeSingle(),
      clientNameById(),
    ]);
    if (error) throw new Error(error.message);
    if (!data) return null;
    return toProject(data, nameByClient.get(data.client_id) ?? "");
  });

export type ProjectWorker = Worker & {
  isLead: boolean;
  tasksThisWeek: number;
  hoursThisWeek: number;
};

/**
 * A site's crew, lead first as listed on the site, with the per-week counts the project detail
 * page renders.
 */
export const projectWorkers = createServerFn({ method: "GET" })
  .validator((projectId: string) => projectId)
  .handler(async ({ data: projectId }): Promise<ProjectWorker[]> => {
    const db = await getAuthedClient();

    const { data: project, error: pErr } = await db
      .from("projects")
      .select("lead_worker_id, worker_ids")
      .eq("id", projectId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!project) return [];

    const [{ data: workerRows, error: wErr }, { data: taskRows, error: tErr }] =
      await Promise.all([
        db.from("workers").select("*").in("id", project.worker_ids),
        db
          .from("tasks")
          .select("worker_id, duration")
          .eq("project_id", projectId),
      ]);
    if (wErr) throw new Error(wErr.message);
    if (tErr) throw new Error(tErr.message);

    const byId = new Map((workerRows ?? []).map((w) => [w.id, w]));

    // Ordered by the project's own worker_ids, so the crew list reads the same as before.
    return project.worker_ids.flatMap((id) => {
      const row = byId.get(id);
      if (!row) return [];
      const own = (taskRows ?? []).filter((t) => t.worker_id === id);
      return [
        {
          ...toWorker(row),
          isLead: project.lead_worker_id === id,
          tasksThisWeek: own.length,
          hoursThisWeek: own.reduce((sum, t) => sum + Number(t.duration), 0),
        },
      ];
    });
  });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

export const SiteInput = z.object({
  /** omit to add a new site */
  id: z.string().optional(),
  clientId: z.string().min(1, "Pick a client"),
  name: z.string().trim().min(1, "Name is required"),
  address: z.string().trim().min(1, "Address is required"),
  city: z.string().trim().min(1, "City is required"),
  lat: latitude,
  lng: longitude,
  zones: z.array(z.string().trim().min(1)),
  workerIds: z.array(z.string()),
  leadWorkerId: z.string(),
  visitsPerMonth: z.number().int().min(0),
  monthlyValue: z.number().min(0),
  contractUntil: isoDate.or(z.literal("")),
  status: z.enum(["healthy", "attention", "critical"]),
});
export type SiteInput = z.infer<typeof SiteInput>;

/** Create or update a work site (project). */
export const saveSite = createServerFn({ method: "POST" })
  .validator(SiteInput)
  .handler(async ({ data }): Promise<{ id: string }> => {
    const db = await getAuthedClient();
    const row = {
      client_id: data.clientId,
      name: data.name,
      address: data.address,
      city: data.city,
      lat: data.lat,
      lng: data.lng,
      zones: data.zones,
      worker_ids: data.workerIds,
      lead_worker_id: data.leadWorkerId || null,
      visits_per_month: data.visitsPerMonth,
      monthly_value: data.monthlyValue,
      contract_until: data.contractUntil || null,
      status: data.status,
    };
    if (data.id) {
      const { error } = await db.from("projects").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const id = await nextId(db, "projects", "p");
    const { error } = await db.from("projects").insert({ ...row, id });
    if (error) throw new Error(error.message);
    return { id };
  });

/** Move a site on the map. The weather lookup and route planning follow it. */
export const moveSite = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1), lat: latitude, lng: longitude }))
  .handler(async ({ data }) => {
    const db = await getAuthedClient();
    const { error } = await db
      .from("projects")
      .update({ lat: data.lat, lng: data.lng })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { id: data.id };
  });
