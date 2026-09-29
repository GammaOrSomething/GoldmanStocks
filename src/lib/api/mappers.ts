/**
 * Database rows -> the domain types the screens use (`@/lib/types`).
 *
 * Gaps the schema leaves for the caller to fill:
 *  - projects/plants/tasks don't carry the client's name, so callers pass one in.
 *  - a site's crew and lead live in `project_workers`, and money lives in the boss-only
 *    `client_terms` / `project_terms`; callers pass what they fetched (terms are absent for
 *    workers, who can't read them).
 *  - dates are real `date` columns, but the UI renders short strings ("12 Sep", "Today"), so
 *    they are formatted here.
 */
import { format, parseISO } from "date-fns";

import type { ClientStats } from "../client-stats";
import { localDate } from "../weather";
import type { Client, Plant, Project, Task, Worker } from "../types";
import type { Database } from "../supabase/types";

type Row<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

/** Money a boss sees; workers get none of it. */
export type Terms = { monthly_value: number; contract_until: string | null };

/** A site's crew, in the order it should be listed: the lead first. */
export type Crew = { workerIds: string[]; leadWorkerId: string };

/** "2026-09-12" -> "12 Sep", and today's date -> "Today". */
export function toShortDate(value: string | null): string {
  if (!value) return "";
  if (value === localDate(new Date())) return "Today";
  return format(parseISO(value), "dd MMM");
}

/** Group `project_workers` rows by site, lead first. */
export function crewsBySite(
  rows: Pick<Row<"project_workers">, "project_id" | "worker_id" | "is_lead">[],
): Map<string, Crew> {
  const crews = new Map<string, Crew>();
  for (const row of rows) {
    const crew = crews.get(row.project_id) ?? {
      workerIds: [],
      leadWorkerId: "",
    };
    crews.set(
      row.project_id,
      row.is_lead
        ? {
            workerIds: [row.worker_id, ...crew.workerIds],
            leadWorkerId: row.worker_id,
          }
        : { ...crew, workerIds: [...crew.workerIds, row.worker_id] },
    );
  }
  return crews;
}

export function toClient(
  row: Row<"clients">,
  stats: ClientStats,
  terms: Terms | undefined,
): Client {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    ...stats,
    contact: row.contact,
    monthlyValue: Number(terms?.monthly_value ?? 0),
    contractUntil: terms?.contract_until ?? "",
    health: row.health,
  };
}

export function toWorker(row: Row<"workers">): Worker {
  return {
    id: row.id,
    name: row.name,
    role: row.job_title,
    language: row.language,
    color: row.color,
    email: row.email ?? "",
    appRole: row.app_role,
    hasLogin: row.user_id !== null,
    ...(row.invited_at ? { invitedAt: row.invited_at } : {}),
    // Linked but not accepted is an invitation still waiting for an answer.
    ...(row.user_id && row.accepted_at ? { joinedAt: row.accepted_at } : {}),
  };
}

export function toProject(
  row: Row<"projects">,
  clientName: string,
  crew: Crew | undefined,
  terms: Terms | undefined,
): Project {
  return {
    id: row.id,
    name: row.name,
    clientId: row.client_id,
    client: clientName,
    city: row.city,
    address: row.address,
    // The weather lookup and the route ordering between sites read these.
    lat: Number(row.lat),
    lng: Number(row.lng),
    zones: row.zones,
    leadWorkerId: crew?.leadWorkerId ?? "",
    workerIds: crew?.workerIds ?? [],
    visitsPerMonth: row.visits_per_month,
    monthlyValue: Number(terms?.monthly_value ?? 0),
    contractUntil: terms?.contract_until ?? "",
    status: row.status,
  };
}

export function toPlant(row: Row<"plants">, clientName: string): Plant {
  return {
    id: row.id,
    code: row.code,
    projectId: row.project_id,
    species: row.species,
    common: row.common,
    kind: row.kind,
    client: clientName,
    site: row.zone,
    status: row.status,
    lastCare: toShortDate(row.last_care),
    nextCare: toShortDate(row.next_care),
    nextTask: row.next_task ?? "",
    x: Number(row.x),
    y: Number(row.y),
    ...(row.last_care ? { lastCareDate: row.last_care } : {}),
    ...(row.next_care ? { nextCareDate: row.next_care } : {}),
    // Without GPS, the map places the plant from x/y on its site (src/lib/geo.ts).
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
    site: row.zone,
    workerId: row.worker_id,
    day: row.day,
    start: row.start,
    duration: Number(row.duration),
    kind: row.kind,
    ...(row.weather_note ? { weatherNote: row.weather_note } : {}),
    status: row.status,
    // Optional on Task, so omitting them typechecks — but dropping them loses the planner's
    // plant-level location and makes an approved plan read back as unapproved.
    ...(row.plant_id ? { plantId: row.plant_id } : {}),
    ...(row.approved_at ? { approvedAt: row.approved_at } : {}),
    // No date means the task is a weekly template, repeating on `day`.
    ...(row.date ? { date: row.date } : {}),
  };
}
