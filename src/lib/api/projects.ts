import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";

import type { Database } from "../supabase/types";
import type { Project, Worker } from "../types";
import { clientNameById } from "./lookups";
import { crewsBySite, toProject, toWorker, type Terms } from "./mappers";
import { getAuthedClient, requireBoss } from "./session";

type Db = SupabaseClient<Database>;

/** Sites with their client's name, crew and (for a boss) terms; one site when `id` is given. */
async function loadSites(db: Db, id?: string): Promise<Project[]> {
  let projects = db.from("projects").select("*").order("name");
  let crews = db
    .from("project_workers")
    .select("project_id, worker_id, is_lead");
  // Boss-only; a worker gets no rows, and sees no money.
  let terms = db
    .from("project_terms")
    .select("project_id, monthly_value, contract_until");
  if (id) {
    projects = projects.eq("id", id);
    crews = crews.eq("project_id", id);
    terms = terms.eq("project_id", id);
  }

  const [projectRows, crewRows, termRows, nameByClient] = await Promise.all([
    projects,
    crews,
    terms,
    clientNameById(),
  ]);
  for (const result of [projectRows, crewRows, termRows])
    if (result.error) throw new Error(result.error.message);

  const crewById = crewsBySite(crewRows.data ?? []);
  const termsById = new Map<string, Terms>(
    (termRows.data ?? []).map((t) => [t.project_id, t]),
  );
  return (projectRows.data ?? []).map((row) =>
    toProject(
      row,
      nameByClient.get(row.client_id) ?? "",
      crewById.get(row.id),
      termsById.get(row.id),
    ),
  );
}

/** Every work site (project). */
export const listProjects = createServerFn({ method: "GET" }).handler(
  async (): Promise<Project[]> => loadSites(await getAuthedClient()),
);

/** One work site, or null for an unknown or malformed id. */
export const getProject = createServerFn({ method: "GET" })
  .validator((projectId: string) => projectId)
  .handler(async ({ data: projectId }): Promise<Project | null> => {
    if (!z.uuid().safeParse(projectId).success) return null;
    const [site] = await loadSites(await getAuthedClient(), projectId);
    return site ?? null;
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
    if (!z.uuid().safeParse(projectId).success) return [];
    const db = await getAuthedClient();

    const [crewRows, taskRows] = await Promise.all([
      db
        .from("project_workers")
        .select("project_id, worker_id, is_lead")
        .eq("project_id", projectId),
      db
        .from("tasks")
        .select("worker_id, duration")
        .eq("project_id", projectId),
    ]);
    if (crewRows.error) throw new Error(crewRows.error.message);
    if (taskRows.error) throw new Error(taskRows.error.message);

    const crew = crewsBySite(crewRows.data ?? []).get(projectId);
    if (!crew) return [];
    const { data: workerRows, error: wErr } = await db
      .from("workers")
      .select("*")
      .in("id", crew.workerIds);
    if (wErr) throw new Error(wErr.message);
    const rowById = new Map((workerRows ?? []).map((w) => [w.id, w]));

    // Lead first, then the crew, as the site lists them.
    return crew.workerIds.flatMap((id) => {
      const row = rowById.get(id);
      if (!row) return [];
      const own = (taskRows.data ?? []).filter((t) => t.worker_id === id);
      return [
        {
          ...toWorker(row),
          isLead: crew.leadWorkerId === id,
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
  id: z.uuid().optional(),
  clientId: z.uuid("Pick a client"),
  name: z.string().trim().min(1, "Name is required").max(200),
  address: z.string().trim().min(1, "Address is required").max(500),
  city: z.string().trim().min(1, "City is required").max(200),
  lat: latitude,
  lng: longitude,
  zones: z.array(z.string().trim().min(1).max(100)).max(100),
  workerIds: z.array(z.uuid()).max(100),
  /** "" for a site without a lead */
  leadWorkerId: z.uuid().or(z.literal("")),
  visitsPerMonth: z.number().int().min(0),
  monthlyValue: z.number().min(0),
  contractUntil: isoDate.or(z.literal("")),
  status: z.enum(["healthy", "attention", "critical"]),
});
export type SiteInput = z.infer<typeof SiteInput>;

/** Create or update a work site (project), its crew and its contract terms. */
export const saveSite = createServerFn({ method: "POST" })
  .validator(SiteInput)
  .handler(async ({ data }): Promise<{ id: string }> => {
    const db = await requireBoss();
    const row = {
      client_id: data.clientId,
      name: data.name,
      address: data.address,
      city: data.city,
      lat: data.lat,
      lng: data.lng,
      zones: data.zones,
      visits_per_month: data.visitsPerMonth,
      status: data.status,
    };

    let id = data.id;
    if (id) {
      const { error } = await db.from("projects").update(row).eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const { data: created, error } = await db
        .from("projects")
        .insert(row)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      id = created.id;
    }

    const [crew, terms] = await Promise.all([
      db.rpc("set_project_crew", {
        p_project_id: id,
        p_worker_ids: data.workerIds,
        p_lead_id: data.leadWorkerId || null,
      }),
      db.from("project_terms").upsert({
        project_id: id,
        monthly_value: data.monthlyValue,
        contract_until: data.contractUntil || null,
      }),
    ]);
    if (crew.error) throw new Error(crew.error.message);
    if (terms.error) throw new Error(terms.error.message);
    return { id };
  });

/** Move a site on the map. The weather lookup and route planning follow it. */
export const moveSite = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.uuid(), lat: latitude, lng: longitude }))
  .handler(async ({ data }) => {
    const db = await requireBoss();
    const { error } = await db
      .from("projects")
      .update({ lat: data.lat, lng: data.lng })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { id: data.id };
  });
