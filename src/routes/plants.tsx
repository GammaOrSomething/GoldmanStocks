import { createFileRoute, Link } from "@tanstack/react-router";
import { Camera, MapPin, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { PlantDialog } from "@/components/forms/PlantDialog";
import {
  PlantCalendarDialog,
  PlantTableSection,
} from "@/components/PlantTable";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { listPlants } from "@/lib/api/plants";
import { listProjects } from "@/lib/api/projects";
import { listWorkers } from "@/lib/api/workers";
import type { Plant } from "@/lib/types";

export const Route = createFileRoute("/plants")({
  head: () => ({
    meta: [
      { title: "Plant & area register — Goldman Stocks" },
      {
        name: "description",
        content:
          "Every tree, hedge, lawn and flower bed by project, with ID, species, care schedule and history.",
      },
      {
        property: "og:title",
        content: "Plant & area register — Goldman Stocks",
      },
      {
        property: "og:description",
        content:
          "Searchable register of every managed plant and area, grouped by project.",
      },
    ],
  }),
  loader: async () => {
    const [plants, projects, workers] = await Promise.all([
      listPlants(),
      listProjects(),
      listWorkers(),
    ]);
    return { plants, projects, workers };
  },
  component: Plants,
});

const filters = [
  "All",
  "Tree",
  "Hedge",
  "Lawn",
  "Flower bed",
  "Shrub",
] as const;

function Plants() {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<(typeof filters)[number]>("All");
  const [openPlant, setOpenPlant] = useState<Plant | null>(null);
  // undefined = closed, null = new plant, a plant = editing it
  const [editing, setEditing] = useState<Plant | null | undefined>();

  const { plants, projects, workers } = Route.useLoaderData();

  // Crew names per project, derived from the worker list — a query inside the render loop
  // below would break the rules of hooks.
  const workerNameById = useMemo(
    () => new Map(workers.map((w) => [w.id, w.name])),
    [workers],
  );

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects
      .map((project) => ({
        project,
        rows: plants.filter((p) => {
          if (p.projectId !== project.id) return false;
          if (kind !== "All" && p.kind !== kind) return false;
          if (!q) return true;
          return [
            p.code,
            p.species,
            p.common,
            p.client,
            p.site,
            project.name,
          ].some((v) => v.toLowerCase().includes(q));
        }),
      }))
      .filter((g) => g.rows.length > 0);
  }, [query, kind, plants, projects]);

  return (
    <AppShell
      title="Plants & areas"
      subtitle={`${plants.length} registered items across ${projects.length} projects`}
      actions={
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/mobile/new-plant">
              <Camera className="size-4" /> Add by photo
            </Link>
          </Button>
          <Button onClick={() => setEditing(null)}>
            <Plus className="size-4" /> Register plant
          </Button>
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ID, species, project…"
            className="pl-9"
          />
        </div>
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setKind(f)}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              kind === f
                ? "border-primary bg-primary text-primary-foreground"
                : "hover:bg-muted"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="space-y-6">
        {groups.map(({ project, rows }) => {
          const crew = project.workerIds.flatMap((id) => {
            const name = workerNameById.get(id);
            return name ? [{ id, name }] : [];
          });
          return (
            <PlantTableSection
              key={project.id}
              title={project.name}
              crew={crew.map((w) => w.name)}
              rows={rows}
              footerLabel={project.name}
              action={
                <Link
                  to="/projects/$projectId"
                  params={{ projectId: project.id }}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  <MapPin className="size-4" /> View map
                </Link>
              }
              onOpenCalendar={setOpenPlant}
              onEdit={setEditing}
            />
          );
        })}
        {groups.length === 0 ? (
          <Card className="shadow-card">
            <CardContent className="py-10 text-center text-muted-foreground">
              Nothing matches that search.
            </CardContent>
          </Card>
        ) : null}
      </div>

      <PlantDialog
        plant={editing ?? undefined}
        projects={projects}
        open={editing !== undefined}
        onOpenChange={(open) => (open ? null : setEditing(undefined))}
      />

      <PlantCalendarDialog
        plant={openPlant}
        onClose={() => setOpenPlant(null)}
      />
    </AppShell>
  );
}
