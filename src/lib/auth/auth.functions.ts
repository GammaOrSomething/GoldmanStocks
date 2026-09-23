import { createServerFn } from "@tanstack/react-start";

import { getSessionViewer } from "@/lib/api/session";

// Server functions only: safe to import from routes.

/** Who is signed in, or null. The root route's guard reads this on every navigation. */
export const getViewer = createServerFn({ method: "GET" }).handler(() =>
  getSessionViewer(),
);
