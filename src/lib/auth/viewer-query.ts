import { getViewer } from "./auth.functions";

/** Cache key for the signed-in viewer. Clear the query cache on sign-in and sign-out. */
export const VIEWER_KEY = ["viewer"] as const;

/** The signed-in viewer, fetched once and kept until the cache is cleared. */
export const viewerQuery = {
  queryKey: VIEWER_KEY,
  queryFn: () => getViewer(),
  staleTime: Number.POSITIVE_INFINITY,
};
