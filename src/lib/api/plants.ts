import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";

import type { Plant } from "../types";
import { clientNameByProject } from "./lookups";
import { toPlant } from "./mappers";
import { latLngToPlan } from "../geo";
import { getAuthedClient } from "./session";

/** Every plant and area in the register. */
export const listPlants = createServerFn({ method: "GET" }).handler(
  async (): Promise<Plant[]> => {
    const [{ data, error }, clientByProject] = await Promise.all([
      (await getAuthedClient()).from("plants").select("*").order("code"),
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
    if (!z.uuid().safeParse(projectId).success) return [];
    const [{ data, error }, clientByProject] = await Promise.all([
      (await getAuthedClient())
        .from("plants")
        .select("*")
        .eq("project_id", projectId)
        .order("code"),
      clientNameByProject(),
    ]);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) =>
      toPlant(row, clientByProject.get(row.project_id) ?? ""),
    );
  });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Where `createPlantPhotoUpload` put the picture: <company>/plants/<name>.<ext>. The database
 * also checks the folder is the plant's own company.
 */
const plantPhotoPath = z
  .string()
  .regex(
    /^[0-9a-f-]{36}\/plants\/[A-Za-z0-9_-]+\.(jpe?g|png|webp|heic)$/,
    "That photo was not uploaded for a plant",
  );

export const PlantInput = z.object({
  /** omit to register a new plant */
  id: z.uuid().optional(),
  projectId: z.uuid("Pick a site"),
  common: z.string().trim().min(1, "Name is required").max(200),
  species: z.string().trim().max(200),
  kind: z.enum(["Tree", "Hedge", "Lawn", "Flower bed", "Shrub"]),
  /** zone within the site, e.g. "North courtyard" */
  site: z.string().trim().max(200),
  status: z.enum(["healthy", "attention", "critical"]),
  nextTask: z.string().trim().max(200),
  nextCareDate: isoDate.or(z.literal("")),
  /** where it stands — from the phone's GPS. Without it a new plant goes to the site's centre. */
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  /** the uploaded picture; omit to keep the current one */
  photoPath: plantPhotoPath.optional(),
});
export type PlantInput = z.infer<typeof PlantInput>;

/**
 * Register or update a plant. With GPS it's stored at its real position and also placed on
 * the site plan (x/y); without, a new plant goes to the middle of the plan. The database gives
 * a new plant its id and its readable code (PL-0001, …). The picture is saved in the same
 * write, since only a boss may change a plant afterwards.
 */
export const savePlant = createServerFn({ method: "POST" })
  .validator(PlantInput)
  .handler(async ({ data }): Promise<{ id: string; code: string }> => {
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
      zone: data.site,
      status: data.status,
      next_task: data.nextTask || null,
      next_care: data.nextCareDate || null,
      ...(onPlan ?? {}),
      ...(gps ?? {}),
      ...(data.photoPath ? { photo_path: data.photoPath } : {}),
    };

    if (data.id) {
      const { data: updated, error } = await db
        .from("plants")
        .update(row)
        .eq("id", data.id)
        .select("id, code")
        .single();
      if (error) throw new Error(error.message);
      return updated;
    }

    const { data: created, error } = await db
      .from("plants")
      .insert({ x: 50, y: 50, ...row })
      .select("id, code")
      .single();
    if (error) throw new Error(error.message);
    return created;
  });
