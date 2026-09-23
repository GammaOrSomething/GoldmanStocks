/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { responseHeaders } from "./response-headers";

describe("responseHeaders", () => {
  test("nothing is ever cached, anywhere", () => {
    for (const onVercel of [true, false])
      expect(responseHeaders(onVercel)["Cache-Control"]).toBe(
        "private, no-store",
      );
  });

  test("on Vercel, only this site may frame the app", () => {
    const headers = responseHeaders(true);
    expect(headers["Content-Security-Policy"]).toBe("frame-ancestors 'self'");
    expect(headers["X-Frame-Options"]).toBe("SAMEORIGIN");
  });

  test("elsewhere the Lovable editor can still frame it", () => {
    const headers = responseHeaders(false);
    expect(headers["Content-Security-Policy"]).toBeUndefined();
    expect(headers["X-Frame-Options"]).toBeUndefined();
  });
});
