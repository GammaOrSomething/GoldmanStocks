/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { photoType } from "./photo-types";

describe("photoType", () => {
  test("keeps the types the bucket accepts", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/heic"])
      expect(photoType({ type })).toBe(type as never);
  });

  test("a photo with no type is a JPEG", () => {
    expect(photoType({ type: "" })).toBe("image/jpeg");
  });

  test("anything else is refused, including object keys", () => {
    for (const type of ["image/heif", "image/gif", "text/html", "toString"])
      expect(photoType({ type })).toBeNull();
  });
});
