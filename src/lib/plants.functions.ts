import { createServerFn } from "@tanstack/react-start";
import { getAuthedClient } from "@/lib/api/session";
import { z } from "zod/v4";

import {
  attachPlantPhoto as attachPlantPhotoImpl,
  AttachPlantPhotoInput,
  createPlantPhotoUpload as createPlantPhotoUploadImpl,
  getPlantPhotoUrl as getPlantPhotoUrlImpl,
  PlantPhotoUploadInput,
} from "@/lib/server/plant-photos";

// Server functions only: safe to import from routes. They use the service-role client because
// the photo bucket is private with no storage policies (see photos.functions.ts); it is imported
// inside the handlers because @/lib/supabase/server is server-only.

/** Step 1: a signed URL the phone uploads a new plant's picture to. */
export const createPlantPhotoUpload = createServerFn({ method: "POST" })
  .validator(PlantPhotoUploadInput)
  .handler(async ({ data }) => {
    await getAuthedClient(); // signed-in callers only
    const { getAdminClient } = await import("@/lib/supabase/server");
    return createPlantPhotoUploadImpl(getAdminClient(), data);
  });

/** Step 3: attach the uploaded picture to the saved plant. */
export const attachPlantPhoto = createServerFn({ method: "POST" })
  .validator(AttachPlantPhotoInput)
  .handler(async ({ data }) => {
    await getAuthedClient(); // signed-in callers only
    const { getAdminClient } = await import("@/lib/supabase/server");
    return attachPlantPhotoImpl(getAdminClient(), data);
  });

/** The plant's picture, if it has one. */
export const getPlantPhotoUrl = createServerFn({ method: "GET" })
  .validator(z.string().min(1))
  .handler(async ({ data: plantId }) => {
    await getAuthedClient(); // signed-in callers only
    const { getAdminClient } = await import("@/lib/supabase/server");
    return getPlantPhotoUrlImpl(getAdminClient(), plantId);
  });
