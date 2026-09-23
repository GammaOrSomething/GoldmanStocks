import { getViewer } from "./auth.functions";

/** Cache key for the signed-in viewer. Clear the query cache on sign-in and sign-out. */
export const VIEWER_KEY = ["viewer"] as const;

/** The signed-in viewer, fetched once and kept until the cache is cleared. */
export const viewerQuery = {
  queryKey: VIEWER_KEY,
  queryFn: () => getViewer(),
  staleTime: Number.POSITIVE_INFINITY,
  // Every navigation waits on this, so fail fast rather than back off for seconds, and try even
  // when the browser thinks it's offline (a worker's phone often does, wrongly).
  retry: 1,
  networkMode: "always" as const,
};
