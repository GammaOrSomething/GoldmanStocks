import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";

import type { Plant } from "../types";
import { clientNameByProject } from "./lookups";
import { toPlant } from "./mappers";
import { latLngToPlan } from "../geo";
import { nextId } from "./ids";
import { getAuthedClient } from "./session";

/** Every plant and area in the register. */
export const listPlants = createServerFn({ method: "GET" }).handler(
  async (): Promise<Plant[]> => {
    const [{ data, error }, clientByProject] = await Promise.all([
      (await getAuthedClient()).from("plants").select("*").order("id"),
      clientNameByProject(),
    ]);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) =>
      toPlant(row, clientByProject.get(row.project_id) ?? ""),
    );
  },
);

/** The plants and areas at one site. */
export const projectPlants = createServerFn({ method: "GET" })
  .validator((projectId: string) => projectId)
  .handler(async ({ data: projectId }): Promise<Plant[]> => {
    const [{ data, error }, clientByProject] = await Promise.all([
      (await getAuthedClient())
        .from("plants")
        .select("*")
        .eq("project_id", projectId)
        .order("id"),
      clientNameByProject(),
    ]);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) =>
      toPlant(row, clientByProject.get(row.project_id) ?? ""),
    );
  });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const PlantInput = z.object({
  /** omit to register a new plant */
  id: z.string().optional(),
  projectId: z.string().min(1, "Pick a site"),
  common: z.string().trim().min(1, "Name is required"),
  species: z.string().trim(),
  kind: z.enum(["Tree", "Hedge", "Lawn", "Flower bed", "Shrub"]),
  /** zone within the site, e.g. "North courtyard" */
  site: z.string().trim(),
  status: z.enum(["healthy", "attention", "critical"]),
  nextTask: z.string().trim(),
  nextCareDate: isoDate.or(z.literal("")),
  /** where it stands — from the phone's GPS. Without it a new plant goes to the site's centre. */
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});
export type PlantInput = z.infer<typeof PlantInput>;

/** PostgREST's answer when a column doesn't exist — i.e. migration 0003 isn't applied yet. */
function isMissingColumn(error: { code?: string; message: string }) {
  return (
    error.code === "PGRST204" || /column .* does not exist/i.test(error.message)
  );
}

/**
 * Register or update a plant. With GPS it's stored at its real position (plants.lat/lng,
 * migration 0003) and also placed on the site plan (x/y); before that migration is applied the
 * write quietly falls back to x/y only.
 */
export const savePlant = createServerFn({ method: "POST" })
  .validator(PlantInput)
  .handler(async ({ data }): Promise<{ id: string }> => {
    const db = await getAuthedClient();
    const { data: project, error: projectError } = await db
      .from("projects")
      .select("lat, lng")
      .eq("id", data.projectId)
      .single();
    if (projectError) throw new Error(projectError.message);

    const gps =
      data.lat != null && data.lng != null
        ? { lat: data.lat, lng: data.lng }
        : null;
    const onPlan = gps
      ? latLngToPlan(
          { lat: Number(project.lat), lng: Number(project.lng) },
          gps,
        )
      : null;

    const row = {
      project_id: data.projectId,
      common: data.common,
      species: data.species,
      kind: data.kind,
      site: data.site,
      status: data.status,
      next_task: data.nextTask || null,
      next_care: data.nextCareDate || null,
      ...(onPlan ?? {}),
    };
    const withGps = gps ? { ...row, lat: gps.lat, lng: gps.lng } : row;

    if (data.id) {
      const id = data.id;
      const update = (values: typeof row) =>
        db.from("plants").update(values).eq("id", id);
      let { error } = await update(withGps);
      if (error && gps && isMissingColumn(error))
        ({ error } = await update(row));
      if (error) throw new Error(error.message);
      return { id };
    }

    const id = await nextId(db, "plants", "PL-", 4);
    const insert = (values: typeof row) =>
      db.from("plants").insert({ x: 50, y: 50, ...values, id });
    let { error } = await insert(withGps);
    if (error && gps && isMissingColumn(error)) ({ error } = await insert(row));
    if (error) throw new Error(error.message);
    return { id };
  });
