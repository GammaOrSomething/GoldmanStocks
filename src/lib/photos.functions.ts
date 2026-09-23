import { createServerFn } from "@tanstack/react-start";
import { getAuthedClient } from "@/lib/api/session";

import {
  completeTask as completeTaskImpl,
  createPhotoUploadUrl as createPhotoUploadUrlImpl,
  CompleteTaskInput,
  PHOTO_BUCKET,
  PhotoUploadInput,
} from "@/lib/server/photos";

/**
 * Server-function wrappers for B5's photo proof, the pieces `src/lib/server/photos.ts` left for
 * track A's client to supply.
 *
 * These use the service-role client rather than the request's session: the bucket is private with
 * no storage policies, so only the service role can mint a signed upload URL. It is imported
 * inside the handler because `@/lib/supabase/server` is marked server-only — a static import
 * would put it in the client's module graph.
 */

/**
 * Step 1: a one-time signed URL the worker's phone uploads the photo straight to.
 *
 * The bucket name comes back with it. The client needs it to address the upload, and any module
 * inside a `server/` directory is denied in the browser — so the server hands the name over
 * rather than the caller importing the constant.
 */
export const createPhotoUploadUrl = createServerFn({ method: "POST" })
  .validator((input: PhotoUploadInput) => PhotoUploadInput.parse(input))
  .handler(async ({ data }) => {
    await getAuthedClient(); // signed-in callers only
    const { getAdminClient } = await import("@/lib/supabase/server");
    const upload = await createPhotoUploadUrlImpl(getAdminClient(), data);
    return { ...upload, bucket: PHOTO_BUCKET };
  });

/** Step 3: record the proof and mark the task done. Rejects a photo that never arrived. */
export const completeTask = createServerFn({ method: "POST" })
  .validator((input: CompleteTaskInput) => CompleteTaskInput.parse(input))
  .handler(async ({ data }) => {
    await getAuthedClient(); // signed-in callers only
    const { getAdminClient } = await import("@/lib/supabase/server");
    return completeTaskImpl(getAdminClient(), data);
  });
