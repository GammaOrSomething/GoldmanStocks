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
import { savePlant, type PlantInput } from "@/lib/api/plants";
import { statusLabel } from "@/lib/labels";
import type { Plant, Project } from "@/lib/types";

const KINDS: PlantInput["kind"][] = [
  "Tree",
  "Hedge",
  "Lawn",
  "Flower bed",
  "Shrub",
];
const STATUSES: PlantInput["status"][] = ["healthy", "attention", "critical"];

/** Register a plant or area, or edit one when `plant` is given. */
export function PlantDialog({
  plant,
  projects,
  defaultProjectId,
  open,
  onOpenChange,
}: {
  plant?: Plant | undefined;
  projects: Project[];
  defaultProjectId?: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        {open ? (
          <PlantForm
            key={plant?.id ?? "new"}
            plant={plant}
            projects={projects}
            defaultProjectId={defaultProjectId}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PlantForm({
  plant,
  projects,
  defaultProjectId,
  onDone,
}: {
  plant: Plant | undefined;
  projects: Project[];
  defaultProjectId: string | undefined;
  onDone: () => void;
}) {
  const refresh = useRefreshData();
  const [form, setForm] = useState<PlantInput>({
    ...(plant ? { id: plant.id } : {}),
    projectId: plant?.projectId ?? defaultProjectId ?? projects[0]?.id ?? "",
    common: plant?.common ?? "",
    species: plant?.species ?? "",
    kind: plant?.kind ?? "Shrub",
    site: plant?.site ?? "",
    status: plant?.status ?? "healthy",
    nextTask: plant?.nextTask ?? "",
    nextCareDate: plant?.nextCareDate ?? "",
  });
  const set = <K extends keyof PlantInput>(key: K, value: PlantInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const zones = projects.find((p) => p.id === form.projectId)?.zones ?? [];

  const save = useMutation({
    mutationFn: () => savePlant({ data: form }),
    onSuccess: async ({ id }) => {
      await refresh();
      toast.success(
        plant ? "Plant updated" : `${form.common} registered as ${id}`,
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
          {plant ? `Edit ${plant.common}` : "Register plant or area"}
        </DialogTitle>
        <DialogDescription>
          {plant
            ? `${plant.code} · changes are saved for everyone.`
            : "It's placed at the site's centre — register it from the worker app to pin it by GPS."}
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Site">
          <Select
            value={form.projectId}
            onValueChange={(v) => {
              set("projectId", v);
              set("site", "");
            }}
            disabled={Boolean(plant)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Pick a site" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Zone">
          <Input
            list="plant-zones"
            value={form.site}
            onChange={(e) => set("site", e.target.value)}
            placeholder={zones[0] ?? "e.g. Front garden"}
          />
          <datalist id="plant-zones">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <Input
            required
            value={form.common}
            onChange={(e) => set("common", e.target.value)}
            placeholder="e.g. Boxwood hedge"
          />
        </Field>
        <Field label="Species (Latin)">
          <Input
            value={form.species}
            onChange={(e) => set("species", e.target.value)}
            placeholder="e.g. Buxus sempervirens"
            className="italic"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <Select
            value={form.kind}
            onValueChange={(v) => set("kind", v as PlantInput["kind"])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Status">
          <Select
            value={form.status}
            onValueChange={(v) => set("status", v as PlantInput["status"])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {statusLabel[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Next task">
          <Input
            value={form.nextTask}
            onChange={(e) => set("nextTask", e.target.value)}
            placeholder="e.g. Clipping"
          />
        </Field>
        <Field label="Next care date">
          <Input
            type="date"
            value={form.nextCareDate}
            onChange={(e) => set("nextCareDate", e.target.value)}
          />
        </Field>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending || !form.projectId}>
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          {plant ? "Save changes" : "Register"}
        </Button>
      </DialogFooter>
    </form>
  );
}
