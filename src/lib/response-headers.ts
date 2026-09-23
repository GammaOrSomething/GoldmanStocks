/**
 * Headers on every page and server-function response (set in src/start.ts):
 *
 * - `Cache-Control: private, no-store`: every response is private to the signed-in user, so no
 *   browser or CDN may keep a copy. A cached page would show one person's data to the next.
 * - On Vercel (production and previews), refuse to be framed by another site, so a hidden frame
 *   can't trick a signed-in boss into clicking. Not elsewhere: the Lovable editor shows the app
 *   in a frame of its own. `vercel.json` headers don't apply here, because the build writes
 *   Vercel's output itself.
 */
export function responseHeaders(onVercel: boolean): Record<string, string> {
  return {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    ...(onVercel
      ? {
          "Content-Security-Policy": "frame-ancestors 'self'",
          "X-Frame-Options": "SAMEORIGIN",
        }
      : {}),
  };
}
