import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod/v4";

import type { Database } from "@/lib/supabase/types";
import type { TaskPhoto } from "@/lib/types";
import { localDate } from "@/lib/weather";

/**
 * Photo proof of work. The flow the worker app uses:
 *   1. createPhotoUploadUrl(taskId) → a one-time signed upload URL
 *   2. upload the photo with `supabase.storage.from(PHOTO_BUCKET).uploadToSignedUrl(path, token, file)`
 *   3. completeTask({ taskId, photoPath: path, takenAt, lat, lng }) → task is done, with proof
 *
 * Every function takes the caller's own Supabase client, so row-level security and the storage
 * policies decide: a worker can sign an upload only for a task assigned to them, and
 * `complete_task` checks the rest in one transaction.
 */

type Client = SupabaseClient<Database>;

export const PHOTO_BUCKET = "task-photos";

export const PHOTO_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
} as const;
export type PhotoContentType = keyof typeof PHOTO_EXTENSIONS;
export const PhotoContentType = z.enum(
  Object.keys(PHOTO_EXTENSIONS) as [PhotoContentType],
);

export const PhotoUploadInput = z.object({
  taskId: z.uuid(),
  contentType: PhotoContentType,
});
export type PhotoUploadInput = z.infer<typeof PhotoUploadInput>;

export const CompleteTaskInput = z.object({
  taskId: z.uuid(),
  /** the `path` returned by createPhotoUploadUrl */
  photoPath: z.string().min(1).max(300),
  /** when the photo was taken, ISO 8601 with offset */
  takenAt: z.iso.datetime({ offset: true }),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
});
export type CompleteTaskInput = z.infer<typeof CompleteTaskInput>;

/** A photo may only be attached to the task it was uploaded for, inside the caller's company. */
export function photoFolder(companyId: string, taskId: string) {
  return `${companyId}/tasks/${taskId}/`;
}

/** Step 1: a signed URL the worker's phone can upload one photo to (valid for 2 hours). */
export async function createPhotoUploadUrl(
  db: Client,
  companyId: string,
  input: PhotoUploadInput,
) {
  const { taskId, contentType } = PhotoUploadInput.parse(input);
  const { data: task, error: taskError } = await db
    .from("tasks")
    .select("id")
    .eq("id", taskId)
    .maybeSingle();
  if (taskError) throw new Error(taskError.message);
  if (!task) throw new Error("Task not found");

  const path = `${photoFolder(companyId, taskId)}${crypto.randomUUID()}.${PHOTO_EXTENSIONS[contentType]}`;
  const { data, error } = await db.storage
    .from(PHOTO_BUCKET)
    .createSignedUploadUrl(path);
  // The storage policy refuses a task assigned to someone else.
  if (error) throw new Error("You can't add a photo to this task");
  return data; // { signedUrl, token, path }
}

type PhotoRow = Database["public"]["Tables"]["task_photos"]["Row"];

const fromRow = (r: PhotoRow): TaskPhoto => ({
  id: r.id,
  taskId: r.task_id,
  storagePath: r.storage_path,
  takenAt: r.taken_at,
  lat: r.lat,
  lng: r.lng,
  createdAt: r.created_at,
});

/**
 * Step 3: record the proof and mark the task done. `complete_task` does it in one transaction:
 * it refuses someone else's task, a photo that wasn't uploaded for this task or never arrived,
 * a photo not taken today, and a second proof for the same week. A retry with the same photo
 * returns the first result.
 */
export async function completeTask(
  db: Client,
  companyId: string,
  input: CompleteTaskInput,
): Promise<TaskPhoto> {
  const { taskId, photoPath, takenAt, lat, lng } =
    CompleteTaskInput.parse(input);
  if (!photoPath.startsWith(photoFolder(companyId, taskId))) {
    throw new Error("That photo was not uploaded for this task");
  }

  const { data, error } = await db.rpc("complete_task", {
    p_task_id: taskId,
    p_photo_path: photoPath,
    p_taken_at: takenAt,
    p_lat: lat,
    p_lng: lng,
    p_local_date: localDate(new Date(takenAt)),
  });
  if (error) throw new Error(error.message);
  return fromRow(data);
}
