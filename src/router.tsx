import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter, isRedirect } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

import { isPublicPath, loginHref } from "./lib/auth/access";

export const getRouter = () => {
  /**
   * A server function whose session has ended throws a redirect to the login page. Route loaders
   * follow it on their own; hooks (`useQuery`, `useMutation`) surface it as an error, so it's
   * caught here: forget everything cached for the old session (React Query's and the router's
   * loader data) and go to the login page, remembering the page the user was on.
   */
  const onError = (error: unknown) => {
    if (!isRedirect(error)) return;
    // `latestLocation` updates as soon as a navigation starts, so when several queries fail at
    // once, the later ones see that the first has already sent the user to the login page.
    const here = router.latestLocation;
    if (isPublicPath(here.pathname)) return;
    queryClient.clear();
    router.clearCache();
    void router.navigate({
      href: loginHref(`${here.pathname}${here.searchStr}`),
      replace: true,
    });
  };

  const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    // A redirect won't go away by asking again; the default 3 retries would only delay it.
    defaultOptions: {
      queries: {
        retry: (failures, error) => !isRedirect(error) && failures < 3,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
