import {
  createStart,
  createCsrfMiddleware,
  createMiddleware,
} from "@tanstack/react-start";
import { isNotFound, isRedirect } from "@tanstack/react-router";

import { renderErrorPage } from "./lib/error-page";

/**
 * Every page and server-function response is private to the signed-in user, so no browser or
 * CDN may keep a copy. A cached page would show one person's data to the next person.
 */
const noStoreMiddleware = createMiddleware().server(async ({ next }) => {
  const result = await next();
  try {
    result.response.headers.set("Cache-Control", "private, no-store");
    return result;
  } catch {
    // Some responses come with read-only headers; copy them into a new one.
    const headers = new Headers(result.response.headers);
    headers.set("Cache-Control", "private, no-store");
    return {
      ...result,
      response: new Response(result.response.body, {
        status: result.response.status,
        statusText: result.response.statusText,
        headers,
      }),
    };
  }
});

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    // Redirects (e.g. to the login page) and not-found are control flow, not failures.
    if (isRedirect(error) || isNotFound(error)) throw error;
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [noStoreMiddleware, errorMiddleware, csrfMiddleware],
}));
