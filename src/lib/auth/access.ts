/**
 * Who may see which page. Pure, so it's unit-tested and shared by the root route's guard.
 *
 * This decides where to *send* people. It is not the security boundary: every server function
 * checks the session itself (`getAuthedClient`), and the database's row-level security decides
 * what that session may read or write.
 */

/** The signed-in person, or null when signed out. */
export type Viewer = { userId: string; email: string } | null;

const LOGIN = "/login";

/** Pages anyone may open: the login page and the email-link callbacks under /auth/. */
export function isPublicPath(pathname: string): boolean {
  return pathname === LOGIN || pathname.startsWith("/auth/");
}

/**
 * A `?redirect=` target that is safe to follow: a path on this site. Anything that could point
 * elsewhere (`//host`, `/\host`, `https://…`, `javascript:…`) falls back to the home page, as
 * does the login page itself so a signed-in user can't loop.
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
  if (url.pathname === LOGIN) return fallback;
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

  if (pathname === LOGIN)
    return safeRedirect(new URLSearchParams(searchStr).get("redirect"));
  return null;
}
