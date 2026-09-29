import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { AuthCard, FormError } from "@/components/AuthCard";
import { Button } from "@/components/ui/button";
import { useSignOut } from "@/hooks/use-sign-out";
import { useViewer } from "@/hooks/use-viewer";
import { acceptInvite, declineInvite } from "@/lib/invites.functions";

// Where an invited person answers. Their login is linked to a worker row, but it counts as
// membership only once they press Join here; the guard sends them nowhere else until then.
export const Route = createFileRoute("/join")({
  head: () => ({
    meta: [
      { title: "Join your company — Goldman Stocks" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Join,
});

function Join() {
  const viewer = useViewer();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { signOut, pending: signingOut } = useSignOut();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"join" | "decline" | null>(null);

  const companyName = viewer?.invitation?.companyName ?? "your company";

  async function answer(choice: "join" | "decline") {
    setBusy(choice);
    setError(null);
    try {
      await (choice === "join" ? acceptInvite() : declineInvite());
      // Membership just changed: drop the cached viewer and pages, then let the guard send
      // them on (a worker to the app, a boss to the office, someone who declined to setup).
      queryClient.clear();
      router.clearCache();
      await router.navigate({ href: "/", replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(null);
    }
  }

  return (
    <AuthCard
      title={`Join ${companyName}?`}
      subtitle={`${companyName} has invited ${viewer?.email ?? "you"} to its crew on Goldman Stocks. You'll see your jobs and take photo proof in the app.`}
      footer={
        <button
          type="button"
          className="font-medium text-primary underline disabled:opacity-60"
          disabled={signingOut}
          onClick={() => void signOut()}
        >
          Sign out
        </button>
      }
    >
      <div className="mt-5 space-y-3">
        <FormError message={error} />
        <Button
          type="button"
          size="lg"
          className="w-full"
          disabled={busy !== null}
          onClick={() => void answer("join")}
        >
          {busy === "join" ? "Joining…" : `Join ${companyName}`}
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="w-full"
          disabled={busy !== null}
          onClick={() => void answer("decline")}
        >
          {busy === "decline" ? "One moment…" : "This isn't me"}
        </Button>
        <p className="text-xs text-muted-foreground">
          "This isn't me" removes you from their list. You can then set up your
          own company with this account.
        </p>
      </div>
    </AuthCard>
  );
}
