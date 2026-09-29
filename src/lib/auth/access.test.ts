/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import {
  afterEmailLink,
  cameFromEmailLink,
  isPublicPath,
  loginHref,
  resolveAccess,
  safeRedirect,
  type Member,
} from "./access";

const member = (role: Member["role"]): Member => ({
  workerId: "w1",
  companyId: "c1",
  companyName: "Alpha Gardens",
  area: null,
  role,
  name: "Anna",
});
const viewer = {
  userId: "u1",
  email: "boss@example.com",
  member: member("boss"),
  invitation: null,
};
const worker = { ...viewer, member: member("worker") };
const newcomer = { ...viewer, member: null };
const invitee = {
  ...viewer,
  member: null,
  invitation: { companyName: "Alpha Gardens" },
};
const at = (pathname: string, searchStr = "") => ({ pathname, searchStr });

describe("isPublicPath", () => {
  test("login, signup and the auth callbacks are public", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/signup")).toBe(true);
    expect(isPublicPath("/auth/confirm")).toBe(true);
  });

  test("everything else needs a session", () => {
    for (const path of [
      "/",
      "/clients",
      "/mobile",
      "/mobile/settings",
      "/loginx",
      "/signups",
      "/onboarding",
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

  test("never sends a signed-in user back to the login or signup page", () => {
    expect(safeRedirect("/login")).toBe("/");
    expect(safeRedirect("/login?redirect=%2F")).toBe("/");
    expect(safeRedirect("/signup")).toBe("/");
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

describe("resolveAccess: signup and companies", () => {
  test("signed out on the signup page: stay", () => {
    expect(resolveAccess(at("/signup"), null)).toBeNull();
  });

  test("signed out on onboarding: to login first", () => {
    expect(resolveAccess(at("/onboarding"), null)).toBe(
      "/login?redirect=%2Fonboarding",
    );
  });

  test("signed in without a company: everything leads to onboarding", () => {
    for (const path of ["/", "/clients", "/mobile", "/login", "/signup"])
      expect(resolveAccess(at(path), newcomer)).toBe("/onboarding");
    expect(resolveAccess(at("/onboarding"), newcomer)).toBeNull();
  });

  test("signed in without a company: auth callbacks still finish", () => {
    expect(resolveAccess(at("/auth/confirm"), newcomer)).toBeNull();
  });

  test("a member on onboarding: on to their home page", () => {
    expect(resolveAccess(at("/onboarding"), viewer)).toBe("/");
    expect(resolveAccess(at("/onboarding"), worker)).toBe("/mobile");
  });

  test("signed in on the signup page: on, like the login page", () => {
    expect(resolveAccess(at("/signup"), viewer)).toBe("/");
    expect(resolveAccess(at("/signup"), worker)).toBe("/mobile");
  });
});

describe("resolveAccess: bosses and workers", () => {
  test("a boss may open the office and the worker app", () => {
    for (const path of ["/", "/clients", "/schedule", "/mobile"])
      expect(resolveAccess(at(path), viewer)).toBeNull();
  });

  test("a worker stays in the worker app", () => {
    for (const path of ["/mobile", "/mobile/settings", "/mobile/new-plant"])
      expect(resolveAccess(at(path), worker)).toBeNull();
    for (const path of ["/", "/clients", "/clients/c1/report", "/workers"])
      expect(resolveAccess(at(path), worker)).toBe("/mobile");
    expect(resolveAccess(at("/mobilex"), worker)).toBe("/mobile");
  });

  test("a worker signing in is sent on only to a worker page", () => {
    expect(
      resolveAccess(at("/login", "?redirect=%2Fmobile%2Fsettings"), worker),
    ).toBe("/mobile/settings");
    expect(resolveAccess(at("/login", "?redirect=%2Fclients"), worker)).toBe(
      "/mobile",
    );
    expect(resolveAccess(at("/login"), worker)).toBe("/mobile");
  });
});

describe("resolveAccess: password reset", () => {
  test("forgot-password is public, and never a place to be sent back to", () => {
    expect(isPublicPath("/forgot-password")).toBe(true);
    expect(resolveAccess(at("/forgot-password"), null)).toBeNull();
    expect(safeRedirect("/forgot-password")).toBe("/");
  });

  test("signed in on forgot-password: on home, like the login page", () => {
    expect(resolveAccess(at("/forgot-password"), viewer)).toBe("/");
    expect(resolveAccess(at("/forgot-password"), worker)).toBe("/mobile");
  });

  test("set-password opens for anyone; the page itself explains an expired link", () => {
    for (const who of [null, newcomer, viewer, worker])
      expect(resolveAccess(at("/auth/set-password"), who)).toBeNull();
  });
});

describe("resolveAccess: invitations", () => {
  test("an invitation waiting for an answer: everything leads to /join", () => {
    for (const path of ["/", "/mobile", "/onboarding", "/login", "/clients"])
      expect(resolveAccess(at(path), invitee)).toBe("/join");
    expect(resolveAccess(at("/join"), invitee)).toBeNull();
  });

  test("the email links still finish their job first", () => {
    expect(resolveAccess(at("/auth/set-password"), invitee)).toBeNull();
  });

  test("/join is only for someone with an invitation", () => {
    expect(resolveAccess(at("/join"), newcomer)).toBe("/onboarding");
    expect(resolveAccess(at("/join"), viewer)).toBe("/");
    expect(resolveAccess(at("/join"), worker)).toBe("/mobile");
    expect(resolveAccess(at("/join"), null)).toBe("/login?redirect=%2Fjoin");
  });
});

describe("afterEmailLink", () => {
  test("the link's type decides where it leads, never a parameter in the link", () => {
    expect(afterEmailLink("invite")).toBe("/auth/set-password");
    expect(afterEmailLink("recovery")).toBe("/auth/set-password");
    expect(afterEmailLink("email")).toBe("/onboarding");
    expect(afterEmailLink("signup")).toBe("/onboarding");
    expect(afterEmailLink("email_change")).toBe("/");
  });
});

describe("cameFromEmailLink", () => {
  const now = 1_790_000_000;

  test("a session an invite or reset link started in the last hour may choose a password", () => {
    for (const method of ["invite", "recovery", "otp", "magiclink"])
      expect(cameFromEmailLink([{ method, timestamp: now - 600 }], now)).toBe(
        true,
      );
  });

  test("a password sign-in, an old link, or no claim at all may not", () => {
    expect(
      cameFromEmailLink([{ method: "password", timestamp: now }], now),
    ).toBe(false);
    expect(
      cameFromEmailLink(
        [{ method: "recovery", timestamp: now - 2 * 3600 }],
        now,
      ),
    ).toBe(false);
    expect(cameFromEmailLink(undefined, now)).toBe(false);
    expect(cameFromEmailLink(["recovery"], now)).toBe(false);
  });
});
