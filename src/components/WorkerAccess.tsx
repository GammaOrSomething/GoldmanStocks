import { useMutation } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRefreshData } from "@/hooks/use-data";
import { useViewer } from "@/hooks/use-viewer";
import { formatDate } from "@/hooks/use-week-plan";
import {
  inviteWorker,
  removeAccess,
  resendInvite,
} from "@/lib/invites.functions";
import type { Worker } from "@/lib/types";
import { localDate } from "@/lib/weather";
import { accessState } from "@/lib/worker-access";

type Action = "invite" | "resend" | "remove";

const CALLS = {
  invite: inviteWorker,
  resend: resendInvite,
  remove: removeAccess,
} as const;

/**
 * A worker card's account row on /workers: their email, whether they can sign in, and the
 * boss's buttons to invite them, resend or cancel the invitation, or remove their access.
 */
export function WorkerAccess({ worker }: { worker: Worker }) {
  const viewer = useViewer();
  const refresh = useRefreshData();
  const [confirming, setConfirming] = useState(false);
  const state = accessState(worker);
  // The server refuses these too: a company must not be able to lock itself out.
  const removable =
    viewer?.member?.workerId !== worker.id && worker.appRole !== "boss";

  const act = useMutation({
    mutationFn: (action: Action) => CALLS[action]({ data: worker.id }),
    onSuccess: async (_, action) => {
      await refresh();
      setConfirming(false);
      toast.success(
        action === "invite"
          ? `Invitation sent to ${worker.email}`
          : action === "resend"
            ? `Invitation sent again to ${worker.email}`
            : state === "invited"
              ? "Invitation cancelled"
              : `${worker.name}'s access removed`,
      );
    },
    // The row may have changed underneath (another tab, another boss): show it as it is now.
    onError: async (error) => {
      toast.error(error.message);
      await refresh();
    },
  });

  const label =
    state === "active"
      ? "Can sign in"
      : state === "invited"
        ? `Invited ${worker.invitedAt ? formatDate(localDate(new Date(worker.invitedAt))) : ""}`.trim()
        : "No login";

  return (
    <div className="space-y-2 border-t pt-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <Mail className="size-4 shrink-0" />
          <span className="truncate">{worker.email || "No email"}</span>
        </p>
        <Badge variant={state === "active" ? "secondary" : "outline"}>
          {label}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {state === "none" ? (
          worker.email ? (
            <Button
              size="sm"
              variant="outline"
              disabled={act.isPending}
              onClick={() => act.mutate("invite")}
            >
              Invite to the app
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              Add an email to invite them to the app.
            </p>
          )
        ) : null}

        {state === "invited" ? (
          <>
            {removable ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={act.isPending}
                onClick={() => act.mutate("remove")}
              >
                Cancel invitation
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={act.isPending}
              onClick={() => act.mutate("resend")}
            >
              Resend
            </Button>
          </>
        ) : null}

        {state === "active" && removable ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={act.isPending}
            onClick={() => setConfirming(true)}
          >
            Remove access
          </Button>
        ) : null}
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {worker.name}'s access?</DialogTitle>
            <DialogDescription>
              Their login is deleted and they're signed out of the app. They
              stay in the crew with their jobs and history, and you can invite
              them again later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep access
            </Button>
            <Button
              variant="destructive"
              disabled={act.isPending}
              onClick={() => act.mutate("remove")}
            >
              Remove access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
