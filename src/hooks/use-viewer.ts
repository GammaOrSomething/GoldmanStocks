import { useRouteContext } from "@tanstack/react-router";

import type { Viewer } from "@/lib/auth/access";

/** The signed-in person, as the root route's guard resolved them. */
export function useViewer(): Viewer {
  return useRouteContext({ from: "__root__" }).viewer;
}
