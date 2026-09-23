/**
 * Database rows -> the domain types the screens already use.
 *
 * The UI types in `@/lib/types` are the contract here: every screen, plus the maps and
 * PlantCalendar, is written against them.
 *
 * Two gaps the live schema leaves us to fill:
 *  - projects/plants/tasks have no denormalised `client` name, so callers pass one in.
 *  - dates are real `date` columns, but the UI renders short display strings ("12 Sep",
 *    "Today"), so they are formatted here.
 */
import { format, parseISO } from "date-fns";

import type { ClientStats } from "../client-stats";
import { localDate } from "../weather";
import type { Client, Plant, Project, Task, Worker } from "../types";
import type { Database } from "../supabase/types";

type Row<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

/** "2026-09-12" -> "12 Sep", and today's date -> "Today". */
export function toShortDate(value: string | null): string {
  if (!value) return "";
  if (value === localDate(new Date())) return "Today";
  return format(parseISO(value), "dd MMM");
}

/** The stored counter columns are ignored — they drift. `stats` is worked out from the records. */
export function toClient(row: Row<"clients">, stats: ClientStats): Client {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    ...stats,
    contact: row.contact,
    monthlyValue: Number(row.monthly_value),
    contractUntil: row.contract_until ?? "",
    health: row.health as Client["health"],
  };
}

export function toWorker(row: Row<"workers">): Worker {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    language: row.language,
    color: row.color,
  };
}

export function toProject(row: Row<"projects">, clientName: string): Project {
  return {
    id: row.id,
    name: row.name,
    clientId: row.client_id,
    client: clientName,
    city: row.city,
    address: row.address,
    // Track B's weather lookup and inter-site route ordering read these.
    lat: Number(row.lat),
    lng: Number(row.lng),
    zones: row.zones,
    leadWorkerId: row.lead_worker_id ?? "",
    workerIds: row.worker_ids,
    visitsPerMonth: row.visits_per_month,
    monthlyValue: Number(row.monthly_value),
    contractUntil: row.contract_until ?? "",
    status: row.status as Project["status"],
  };
}

export function toPlant(row: Row<"plants">, clientName: string): Plant {
  return {
    id: row.id,
    projectId: row.project_id,
    species: row.species,
    common: row.common,
    kind: row.kind as Plant["kind"],
    client: clientName,
    site: row.site,
    status: row.status as Plant["status"],
    lastCare: toShortDate(row.last_care),
    nextCare: toShortDate(row.next_care),
    nextTask: row.next_task ?? "",
    x: Number(row.x),
    y: Number(row.y),
    ...(row.last_care ? { lastCareDate: row.last_care } : {}),
    ...(row.next_care ? { nextCareDate: row.next_care } : {}),
    // Real GPS once migration 0003 is applied; until then the columns don't exist and the map
    // derives a position from x/y (src/lib/geo.ts).
    ...(row.lat != null && row.lng != null
      ? { lat: Number(row.lat), lng: Number(row.lng) }
      : {}),
  };
}

export function toTask(row: Row<"tasks">, clientName: string): Task {
  return {
    id: row.id,
    title: row.title,
    projectId: row.project_id,
    client: clientName,
    site: row.site,
    workerId: row.worker_id,
    day: row.day,
    start: row.start,
    duration: Number(row.duration),
    kind: row.kind as Task["kind"],
    ...(row.weather_note ? { weatherNote: row.weather_note } : {}),
    status: row.status as Task["status"],
    // Optional on Task, so omitting them typechecks — but dropping them loses the planner's
    // plant-level location and makes an approved plan read back as unapproved.
    ...(row.plant_id ? { plantId: row.plant_id } : {}),
    ...(row.approved_at ? { approvedAt: row.approved_at } : {}),
    // `date` is absent from the row until migration 0004 is applied; undefined then means the
    // task is the recurring weekly template, which is exactly how the views read it.
    ...(row.date ? { date: row.date } : {}),
  };
}
