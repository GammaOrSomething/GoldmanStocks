/**
 * The image types the photo bucket accepts (see the storage migration), with the file
 * extension each is stored under. Shared by the browser, which checks a photo before
 * uploading it, and the server, which signs the upload.
 */
export const PHOTO_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
} as const;
export type PhotoType = keyof typeof PHOTO_EXTENSIONS;
export const PHOTO_TYPES = Object.keys(PHOTO_EXTENSIONS) as [
  PhotoType,
  ...PhotoType[],
];

export const PHOTO_TYPE_ERROR = "Use a JPEG, PNG, WebP or HEIC photo";

/**
 * A photo's type as the bucket will take it, or null when it won't. Some phones give a camera
 * photo no type at all; those are JPEGs.
 */
export function photoType(file: { type: string }): PhotoType | null {
  const type = file.type || "image/jpeg";
  return Object.hasOwn(PHOTO_EXTENSIONS, type) ? (type as PhotoType) : null;
}
