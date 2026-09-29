import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod/v4";

import type { Database } from "@/lib/supabase/types";
import { MONTH_RE, monthLabel, monthRangeUtc } from "@/lib/month";
import { localDate, localTime } from "@/lib/weather";
import { PHOTO_BUCKET } from "./photos";

/**
 * The monthly photo report a boss sends a client: one row per photo uploaded that month, with
 * the plant it was taken against, the work done, who did it and when.
 *
 * Like the rest of `src/lib/server/`, every function takes the Supabase client first. It is the
 * boss's own session (`src/lib/reports.functions.ts`), so row-level security keeps the report to
 * their company and the storage policies let them sign its photos.
 *
 * Two things worth knowing before changing this:
 *
 * 1. Most tasks have no date. A weekly task is a template (day 0-6 + hour), so the only real
 *    date on finished work is `task_photos.taken_at`. Every row here is driven by the photo,
 *    which is also why a month with no photos is a normal empty report rather than an error.
 * 2. `tasks.plant_id` is nullable, so `plantName` can be null; the task's zone is what always
 *    locates the work.
 */

export const ClientReportInput = z.object({
  clientId: z.string().min(1),
  /** the calendar month to report on, "YYYY-MM" */
  month: z.string().regex(MONTH_RE, "month must be YYYY-MM"),
});
export type ClientReportInput = z.infer<typeof ClientReportInput>;

// ─── Shapes ──────────────────────────────────────────────────────────────────

/** One uploaded picture, and everything the table says about it. */
export interface ReportRow {
  id: string;
  taskId: string;
  /** raw instant, kept for sorting */
  takenAt: string;
  /** resolved on the company clock here, so the page holds no Intl and cannot drift */
  takenOn: string;
  takenTime: string;
  dayLabel: string;
  siteName: string;
  /** the zone within the site, e.g. "North courtyard" */
  area: string;
  /** null whenever the task is not tied to one plant, which is the norm */
  plantName: string | null;
  work: string;
  kind: string;
  workerName: string;
  lat: number | null;
  lng: number | null;
  mapUrl: string | null;
  /** null when the object could not be signed — the row is still evidence the job happened */
  url: string | null;
}

export interface ClientReport {
  client: { id: string; name: string; city: string; contact: string };
  month: string;
  monthLabel: string;
  generatedOn: string;
  rows: ReportRow[];
  unsignedPhotos: number;
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Collapse one `createSignedUrls` response into path → url.
 *
 * Failures are reported per element rather than on the call, and the response order is not
 * contractually the input order — so this keys on `path` and never zips by index.
 */
export function signedUrlMap(
  results: {
    path?: string | null;
    signedUrl?: string | null;
    error?: string | null;
  }[],
): Map<string, string> {
  const urls = new Map<string, string>();
  for (const result of results) {
    if (result.error || !result.path || !result.signedUrl) continue;
    urls.set(result.path, result.signedUrl);
  }
  return urls;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * "Mon 07 Sep". Built by hand rather than with Intl: ICU versions disagree on en-GB's
 * September ("Sep" or "Sept"), so the report would change with the server's runtime.
 */
export function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${WEEKDAYS[d.getUTCDay()]} ${day} ${MONTHS[d.getUTCMonth()]}`;
}

/** An OpenStreetMap pin for where the photo was taken, when the phone recorded it. */
export function mapLink(lat: number | null, lng: number | null): string | null {
  if (lat === null || lng === null) return null;
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
}

// ─── Signing ─────────────────────────────────────────────────────────────────

const SIGN_BATCH = 100;
const SIGN_TTL = 60 * 60;

/**
 * Sign every photo in the report in as few calls as possible.
 *
 * Batched rather than one `createSignedUrl` per photo: a report can hold every visit of every
 * recurring task in the month, which is the exact thing it exists to show.
 *
 * Storage trouble degrades the report rather than failing it.
 */
export async function signPhotoUrls(
  db: SupabaseClient<Database>,
  paths: string[],
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const unique = [...new Set(paths)];

  for (let i = 0; i < unique.length; i += SIGN_BATCH) {
    const chunk = unique.slice(i, i + SIGN_BATCH);
    const { data, error } = await db.storage
      .from(PHOTO_BUCKET)
      .createSignedUrls(chunk, SIGN_TTL);
    if (error) {
      console.error("signing report photo URLs failed", error);
      continue;
    }
    for (const [path, url] of signedUrlMap(data ?? [])) urls.set(path, url);
  }
  return urls;
}

// ─── The report ──────────────────────────────────────────────────────────────

/**
 * Flat selects joined in memory — the convention the rest of the app follows, and the right
 * shape at this size (five clients, five sites). See `src/lib/api/lookups.ts`.
 *
 * Returns null for an unknown client so the route can `throw notFound()`.
 */
export async function clientReport(
  db: SupabaseClient<Database>,
  input: ClientReportInput,
): Promise<ClientReport | null> {
  const { clientId, month } = ClientReportInput.parse(input);
  // A malformed id in the URL is an unknown client, not a database error.
  if (!z.uuid().safeParse(clientId).success) return null;
  const { startUtc, endUtc } = monthRangeUtc(month);

  const { data: client, error: clientError } = await db
    .from("clients")
    .select("id, name, city, contact")
    .eq("id", clientId)
    .maybeSingle();
  if (clientError) throw clientError;
  if (!client) return null;

  const empty: ClientReport = {
    client,
    month,
    monthLabel: monthLabel(month),
    generatedOn: localDate(new Date()),
    rows: [],
    unsignedPhotos: 0,
  };

  const { data: siteRows, error: siteError } = await db
    .from("projects")
    .select("id, name")
    .eq("client_id", clientId);
  if (siteError) throw siteError;
  const sites = siteRows ?? [];
  if (!sites.length) return empty;

  const { data: taskRows, error: taskError } = await db
    .from("tasks")
    .select("id, title, kind, zone, plant_id, worker_id, project_id")
    .in(
      "project_id",
      sites.map((s) => s.id),
    );
  if (taskError) throw taskError;
  const tasks = taskRows ?? [];
  if (!tasks.length) return empty;

  const { data: photoRows, error: photoError } = await db
    .from("task_photos")
    .select("id, task_id, storage_path, taken_at, lat, lng")
    .in(
      "task_id",
      tasks.map((t) => t.id),
    )
    .gte("taken_at", startUtc)
    .lt("taken_at", endUtc)
    .order("taken_at");
  if (photoError) throw photoError;
  const photos = photoRows ?? [];
  if (!photos.length) return empty;

  // Only now is it worth resolving names: a month with no photos needs none of this.
  const plantIds = [
    ...new Set(tasks.flatMap((t) => (t.plant_id ? [t.plant_id] : []))),
  ];
  const [plantsResult, workersResult] = await Promise.all([
    plantIds.length
      ? db.from("plants").select("id, common").in("id", plantIds)
      : Promise.resolve({ data: [], error: null }),
    db.from("workers").select("id, name"),
  ]);
  if (plantsResult.error) throw plantsResult.error;
  if (workersResult.error) throw workersResult.error;

  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const siteNameById = new Map(sites.map((s) => [s.id, s.name] as const));
  const plantNameById = new Map(
    (plantsResult.data ?? []).map((p) => [p.id, p.common] as const),
  );
  const workerNameById = new Map(
    (workersResult.data ?? []).map((w) => [w.id, w.name] as const),
  );

  const urls = await signPhotoUrls(
    db,
    photos.map((p) => p.storage_path),
  );

  const rows: ReportRow[] = photos.flatMap((photo) => {
    // task_photos cascades with its task, so a miss here should be impossible.
    const task = taskById.get(photo.task_id);
    if (!task) return [];
    const takenOn = localDate(new Date(photo.taken_at));
    return [
      {
        id: photo.id,
        taskId: photo.task_id,
        takenAt: photo.taken_at,
        takenOn,
        takenTime: localTime(photo.taken_at),
        dayLabel: dayLabel(takenOn),
        siteName: siteNameById.get(task.project_id) ?? "",
        area: task.zone,
        plantName: task.plant_id
          ? (plantNameById.get(task.plant_id) ?? null)
          : null,
        work: task.title,
        kind: task.kind,
        workerName: workerNameById.get(task.worker_id) ?? "Unassigned",
        lat: photo.lat,
        lng: photo.lng,
        mapUrl: mapLink(photo.lat, photo.lng),
        url: urls.get(photo.storage_path) ?? null,
      },
    ];
  });

  rows.sort((a, b) => a.takenAt.localeCompare(b.takenAt));

  return {
    ...empty,
    rows,
    unsignedPhotos: rows.filter((r) => r.url === null).length,
  };
}
