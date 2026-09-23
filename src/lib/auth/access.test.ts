/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { isPublicPath, loginHref, resolveAccess, safeRedirect } from "./access";

const viewer = { userId: "u1", email: "boss@example.com" };

describe("isPublicPath", () => {
  test("login and the auth callbacks are public", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/auth/confirm")).toBe(true);
  });

  test("everything else needs a session", () => {
    for (const path of [
      "/",
      "/clients",
      "/mobile",
      "/mobile/settings",
      "/loginx",
      "/authors",
    ])
      expect(isPublicPath(path)).toBe(false);
  });
});

describe("safeRedirect", () => {
  test("keeps a same-site path, with its query", () => {
    expect(safeRedirect("/clients")).toBe("/clients");
    expect(safeRedirect("/clients/c1/report?month=2026-09")).toBe(
      "/clients/c1/report?month=2026-09",
    );
  });

  test("rejects anything that could leave the site", () => {
    for (const bad of [
      "//evil.com",
      "/\\evil.com",
      "https://evil.com",
      "javascript:alert(1)",
      "evil.com",
      "/\t/evil.com", // browsers strip tabs and newlines: this becomes //evil.com
      "/\n/evil.com",
      "/\r/evil.com",
      "/ /evil.com",
      "/\u0000/evil.com",
      "",
      undefined,
      42,
    ])
      expect(safeRedirect(bad)).toBe("/");
  });

  test("never sends a signed-in user back to the login page", () => {
    expect(safeRedirect("/login")).toBe("/");
    expect(safeRedirect("/login?redirect=%2F")).toBe("/");
  });

  test("keeps an encoded path as it is", () => {
    // Stays on this site: the router decodes it as a path, never as a host.
    expect(safeRedirect("/%2F%2Fevil.com")).toBe("/%2F%2Fevil.com");
  });
});

describe("loginHref", () => {
  test("remembers a safe page to come back to", () => {
    expect(loginHref("/clients?x=1")).toBe(
      "/login?redirect=%2Fclients%3Fx%3D1",
    );
  });

  test("drops an unsafe or missing one", () => {
    expect(loginHref("//evil.com")).toBe("/login");
    expect(loginHref()).toBe("/login");
  });
});

describe("resolveAccess", () => {
  test("signed out on a private page: to login, remembering where they were", () => {
    expect(resolveAccess({ pathname: "/", searchStr: "" }, null)).toBe(
      "/login?redirect=%2F",
    );
    expect(
      resolveAccess(
        { pathname: "/clients/c1/report", searchStr: "?month=2026-09" },
        null,
      ),
    ).toBe("/login?redirect=%2Fclients%2Fc1%2Freport%3Fmonth%3D2026-09");
  });

  test("signed out on the login page: stay", () => {
    expect(
      resolveAccess({ pathname: "/login", searchStr: "" }, null),
    ).toBeNull();
  });

  test("signed in on a private page: stay", () => {
    expect(
      resolveAccess({ pathname: "/mobile", searchStr: "" }, viewer),
    ).toBeNull();
  });

  test("signed in on the login page: on to where they were going", () => {
    expect(
      resolveAccess(
        { pathname: "/login", searchStr: "?redirect=%2Fschedule" },
        viewer,
      ),
    ).toBe("/schedule");
    expect(
      resolveAccess(
        { pathname: "/login", searchStr: "?redirect=%2F%2Fevil.com" },
        viewer,
      ),
    ).toBe("/");
  });

  test("signed in on an auth callback: stay, the callback finishes the job", () => {
    expect(
      resolveAccess({ pathname: "/auth/confirm", searchStr: "" }, viewer),
    ).toBeNull();
  });
});
