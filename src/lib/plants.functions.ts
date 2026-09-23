import { createServerFn } from "@tanstack/react-start";
import { getAuthedClient, requireMember } from "@/lib/api/session";
import { z } from "zod/v4";

import {
  createPlantPhotoUpload as createPlantPhotoUploadImpl,
  getPlantPhotoUrl as getPlantPhotoUrlImpl,
  PlantPhotoUploadInput,
} from "@/lib/server/plant-photos";

// Server functions only: safe to import from routes. They run on the caller's own session, so
// the storage policies decide who may upload and read a plant's picture.

/** Step 1: a signed URL the phone uploads a new plant's picture to. */
export const createPlantPhotoUpload = createServerFn({ method: "POST" })
  .validator(PlantPhotoUploadInput)
  .handler(async ({ data }) => {
    const { db, member } = await requireMember();
    return createPlantPhotoUploadImpl(db, member.companyId, data);
  });

/** The plant's picture, if it has one. */
export const getPlantPhotoUrl = createServerFn({ method: "GET" })
  .validator(z.string().min(1))
  .handler(async ({ data: plantId }) =>
    getPlantPhotoUrlImpl(await getAuthedClient(), plantId),
  );
