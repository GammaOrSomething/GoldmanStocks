import {
  createStart,
  createCsrfMiddleware,
  createMiddleware,
} from "@tanstack/react-start";
import { isNotFound, isRedirect } from "@tanstack/react-router";

import { renderErrorPage } from "./lib/error-page";
import { responseHeaders } from "./lib/response-headers";

// Vercel sets VERCEL=1 at runtime; see ./lib/response-headers for what each header is for.
const HEADERS = responseHeaders(globalThis.process?.env?.["VERCEL"] === "1");

const headersMiddleware = createMiddleware().server(async ({ next }) => {
  const result = await next();
  try {
    for (const [name, value] of Object.entries(HEADERS))
      result.response.headers.set(name, value);
    return result;
  } catch {
    // Some responses come with read-only headers; copy them into a new one.
    const headers = new Headers(result.response.headers);
    for (const [name, value] of Object.entries(HEADERS))
      headers.set(name, value);
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
  requestMiddleware: [headersMiddleware, errorMiddleware, csrfMiddleware],
}));
