import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { signOut } from "@/lib/auth/session-client";

/** Sign out, forget everything cached for this user, and go to the login page. */
export function useSignOut() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  const run = useCallback(async () => {
    setPending(true);
    try {
      await signOut();
      queryClient.clear();
      router.clearCache();
      await router.navigate({ href: "/login", replace: true });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't sign out.",
      );
      setPending(false);
    }
  }, [queryClient, router]);

  return { signOut: run, pending };
}
