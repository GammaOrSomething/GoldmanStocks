import { createServerFn } from "@tanstack/react-start";
import { requireMember } from "@/lib/api/session";

import {
  completeTask as completeTaskImpl,
  createPhotoUploadUrl as createPhotoUploadUrlImpl,
  CompleteTaskInput,
  PHOTO_BUCKET,
  PhotoUploadInput,
} from "@/lib/server/photos";

/**
 * Server-function wrappers for photo proof. They run on the caller's own session, so the
 * storage policies and `complete_task` decide what a worker may do.
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
    const { db, member } = await requireMember();
    const upload = await createPhotoUploadUrlImpl(db, member.companyId, data);
    return { ...upload, bucket: PHOTO_BUCKET };
  });

/** Step 3: record the proof and mark the task done. Rejects a photo that never arrived. */
export const completeTask = createServerFn({ method: "POST" })
  .validator((input: CompleteTaskInput) => CompleteTaskInput.parse(input))
  .handler(async ({ data }) => {
    const { db, member } = await requireMember();
    return completeTaskImpl(db, member.companyId, data);
  });
