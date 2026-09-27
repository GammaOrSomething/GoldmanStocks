/**
 * Who may see which page. Pure, so it's unit-tested and shared by the root route's guard.
 *
 * This decides where to *send* people. It is not the security boundary: every server function
 * checks the session itself (`getAuthedClient`), and the database's row-level security decides
 * what that session may read or write.
 */

/** The company a signed-in person works for, and what they are there. */
export type Member = {
  workerId: string;
  companyId: string;
  companyName: string;
  role: "boss" | "worker";
  name: string;
};

/**
 * The signed-in person, or null when signed out. `member` is null until they have set up a
 * company (or, from D2, accepted an invitation).
 */
export type Viewer = {
  userId: string;
  email: string;
  member: Member | null;
} | null;

const LOGIN = "/login";
const SIGNUP = "/signup";
const FORGOT_PASSWORD = "/forgot-password";
const ONBOARDING = "/onboarding";
const WORKER_APP = "/mobile";

/** The pages for getting in: a signed-in member is sent on from them. */
const isEntryPage = (pathname: string) =>
  pathname === LOGIN || pathname === SIGNUP || pathname === FORGOT_PASSWORD;

/**
 * Pages anyone may open: login, signup, asking for a password reset, and the email-link
 * callbacks under /auth/ (confirming, then choosing a password).
 */
export function isPublicPath(pathname: string): boolean {
  return isEntryPage(pathname) || pathname.startsWith("/auth/");
}

const isWorkerPage = (pathname: string) =>
  pathname === WORKER_APP || pathname.startsWith(`${WORKER_APP}/`);

/** Where a member lands by default: the office for a boss, the worker app for a worker. */
export function homeFor(member: Member): string {
  return member.role === "boss" ? "/" : WORKER_APP;
}

/**
 * A `?redirect=` target that is safe to follow: a path on this site. Anything that could point
 * elsewhere (`//host`, `/\host`, `https://…`, `javascript:…`) falls back to the home page, as
 * do the login, signup and reset pages themselves, so a signed-in user can't loop.
 *
 * Control characters and spaces are refused outright: browsers delete tabs and newlines from
 * URLs, so `/<tab>/evil.com` in a Location header becomes `//evil.com`, another site.
 */
export function safeRedirect(target: unknown, fallback = "/"): string {
  if (typeof target !== "string") return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x20\x7f\\]/.test(target)) return fallback;
  if (!target.startsWith("/") || target.startsWith("//")) return fallback;
  const base = "http://same-site.invalid";
  const url = new URL(target, base);
  if (url.origin !== base) return fallback;
  if (isEntryPage(url.pathname)) return fallback;
  return target;
}

/** The login page, remembering where to go afterwards. */
export function loginHref(returnTo?: string): string {
  const target = safeRedirect(returnTo, "");
  return target
    ? `${LOGIN}?${new URLSearchParams({ redirect: target })}`
    : LOGIN;
}

/** Where to send this viewer instead of `location` (a same-site href), or null to let them through. */
export function resolveAccess(
  location: { pathname: string; searchStr: string },
  viewer: Viewer,
): string | null {
  const { pathname, searchStr } = location;

  if (!viewer)
    return isPublicPath(pathname) ? null : loginHref(`${pathname}${searchStr}`);
  // An email link finishes its own job, whatever state the account is in.
  if (pathname.startsWith("/auth/")) return null;

  const { member } = viewer;
  if (!member) return pathname === ONBOARDING ? null : ONBOARDING;

  const home = homeFor(member);
  if (isEntryPage(pathname)) {
    const next = safeRedirect(
      new URLSearchParams(searchStr).get("redirect"),
      home,
    );
    return member.role === "worker" && !isWorkerPage(next.split("?")[0]!)
      ? home
      : next;
  }
  if (pathname === ONBOARDING) return home;
  if (member.role === "worker" && !isWorkerPage(pathname)) return home;
  return null;
}
