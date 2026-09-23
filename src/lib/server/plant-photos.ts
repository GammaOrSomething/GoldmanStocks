import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod/v4";

import type { Database } from "@/lib/supabase/types";
import { PHOTO_BUCKET, PHOTO_EXTENSIONS, PhotoContentType } from "./photos";

/**
 * A plant's own picture, taken when a worker registers it. Same private bucket as job proof,
 * under <company>/plants/:
 *   1. createPlantPhotoUpload → a signed URL for <company>/plants/<uuid>.<ext> (the plant has
 *      no id yet while the worker is still filling in the form)
 *   2. the phone uploads straight to storage
 *   3. savePlant stores that path as `plants.photo_path`, in the same insert as the plant
 *
 * The caller's own client signs, so the storage policies decide who may upload and read.
 */

type Client = SupabaseClient<Database>;

export const PlantPhotoUploadInput = z.object({
  contentType: PhotoContentType,
});

export async function createPlantPhotoUpload(
  db: Client,
  companyId: string,
  input: z.infer<typeof PlantPhotoUploadInput>,
) {
  const { contentType } = PlantPhotoUploadInput.parse(input);
  const path = `${companyId}/plants/${crypto.randomUUID()}.${PHOTO_EXTENSIONS[contentType]}`;
  const { data, error } = await db.storage
    .from(PHOTO_BUCKET)
    .createSignedUploadUrl(path);
  if (error) throw new Error(error.message);
  return { ...data, bucket: PHOTO_BUCKET };
}

/** A signed URL for the plant's picture (1 hour), or null when it has none. */
export async function getPlantPhotoUrl(db: Client, plantId: string) {
  if (!z.uuid().safeParse(plantId).success) return null;
  const { data: plant, error } = await db
    .from("plants")
    .select("photo_path")
    .eq("id", plantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!plant?.photo_path) return null;

  const { data, error: signError } = await db.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(plant.photo_path, 60 * 60);
  if (signError) throw new Error(signError.message);
  return data.signedUrl;
}
