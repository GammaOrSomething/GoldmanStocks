import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Field } from "@/components/forms/ClientDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRefreshData } from "@/hooks/use-data";
import { saveWorker, type WorkerInput } from "@/lib/api/workers";
import { SKILLS } from "@/lib/planner";
import type { Worker } from "@/lib/types";

/** The planner assigns jobs by these titles (see SKILLS in planner.ts). */
const ROLES = Object.keys(SKILLS);
const LANGUAGES = [
  { code: "ET", label: "Estonian" },
  { code: "LV", label: "Latvian" },
  { code: "EN", label: "English" },
] as const;

/** Add a worker, or edit one when `worker` is given. */
export function WorkerDialog({
  worker,
  open,
  onOpenChange,
}: {
  worker?: Worker | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <WorkerForm
            key={worker?.id ?? "new"}
            worker={worker}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function WorkerForm({
  worker,
  onDone,
}: {
  worker: Worker | undefined;
  onDone: () => void;
}) {
  const refresh = useRefreshData();
  const [form, setForm] = useState<WorkerInput>({
    ...(worker ? { id: worker.id } : {}),
    name: worker?.name ?? "",
    email: worker?.email ?? "",
    role: worker?.role ?? "Gardener",
    language: (worker?.language as WorkerInput["language"]) ?? "ET",
  });
  const set = <K extends keyof WorkerInput>(key: K, value: WorkerInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    // Once it's their login the email can't change, so it isn't sent at all.
    mutationFn: () => {
      const { email: _email, ...rest } = form;
      return saveWorker({ data: worker?.hasLogin ? rest : form });
    },
    onSuccess: async () => {
      await refresh();
      toast.success(
        worker ? "Worker updated" : `${form.name} added to the crew`,
      );
      onDone();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="grid gap-4"
    >
      <DialogHeader>
        <DialogTitle>
          {worker ? `Edit ${worker.name}` : "Add worker"}
        </DialogTitle>
        <DialogDescription>
          The planner only gives a worker jobs their role allows, and prefers
          sites where their language is spoken.
        </DialogDescription>
      </DialogHeader>

      <Field label="Full name">
        <Input
          required
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Karl Saar"
        />
      </Field>
      <Field label="Email">
        <Input
          type="email"
          inputMode="email"
          autoComplete="off"
          value={form.email ?? ""}
          onChange={(e) => set("email", e.target.value)}
          readOnly={worker?.hasLogin}
          aria-describedby="worker-email-hint"
          placeholder="for their invitation to the app"
        />
        <p id="worker-email-hint" className="text-xs text-muted-foreground">
          {worker?.hasLogin
            ? "Their email is their login, so it can't be changed here."
            : "Optional. You can invite them to the app once it's set."}
        </p>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Role">
          <Select value={form.role} onValueChange={(v) => set("role", v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Language">
          <Select
            value={form.language}
            onValueChange={(v) => set("language", v as WorkerInput["language"])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((l) => (
                <SelectItem key={l.code} value={l.code}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          {worker ? "Save changes" : "Add worker"}
        </Button>
      </DialogFooter>
    </form>
  );
}
