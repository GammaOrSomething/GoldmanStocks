import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod/v4";

import { MONTH_RE, monthLabel, monthRangeUtc } from "@/lib/month";
import { localDate, localTime } from "@/lib/weather";
import { PHOTO_BUCKET } from "./photos";

/**
 * The monthly photo report a boss sends a client: one row per photo uploaded that month, with
 * the plant it was taken against, the work done, who did it and when.
 *
 * Like the rest of `src/lib/server/`, every function takes the Supabase client first. Signing
 * storage URLs needs the service-role client — the bucket is private and has no storage
 * policies — so `src/lib/reports.functions.ts` hands over the admin one.
 *
 * Three things worth knowing before changing this:
 *
 * 1. `tasks` has no date. It is a recurring weekly template (day 0-6 + hour), so the only real
 *    date on finished work is `task_photos.taken_at`. Every row here is driven by the photo,
 *    which is also why a month with no photos is a normal empty report rather than an error.
 * 2. `tasks.plant_id` is nullable, so `plantName` can be null; the task's zone (`tasks.site`)
 *    is what always locates the work.
 * 3. The report runs on the service-role client with a `clientId` straight off the URL, so it
 *    bypasses RLS. The caller must be signed in, and while there is one company in the database
 *    that's enough, but it is the seam to cut when real tenancy arrives (docs/production/):
 *    `signPhotoUrls` is separate so the data queries can move to `getAuthedClient()` and only
 *    the signing stays on the admin client.
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

/** "Mon 07 Sep" */
export function dayLabel(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
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
 * Deliberately not `getTaskPhotoUrl` (`./photos`), which signs one task's *latest* photo per
 * round trip: for a report that would be one HTTP call per photo, and it would hide the second
 * and later visits of every recurring task — the exact thing this report exists to show.
 *
 * Storage trouble degrades the report rather than failing it.
 */
export async function signPhotoUrls(
  db: SupabaseClient,
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
  db: SupabaseClient,
  input: ClientReportInput,
): Promise<ClientReport | null> {
  const { clientId, month } = ClientReportInput.parse(input);
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
    .select("id, title, kind, site, plant_id, worker_id, project_id")
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
  // plants.lat/lng are deliberately not selected — migration 0003 is unapplied and PostgREST
  // answers with 42703 if you ask for them.
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
        area: task.site,
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
