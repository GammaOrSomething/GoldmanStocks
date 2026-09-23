import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter, isRedirect } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

import { loginHref } from "./lib/auth/access";

export const getRouter = () => {
  /**
   * A server function whose session has ended throws a redirect to the login page. Route loaders
   * follow it on their own; hooks (`useQuery`, `useMutation`) surface it as an error, so it's
   * caught here: forget everything cached for the old session and go to the login page,
   * remembering the page the user was on.
   */
  const onError = (error: unknown) => {
    if (!isRedirect(error)) return;
    const here = router.state.location;
    queryClient.clear();
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
