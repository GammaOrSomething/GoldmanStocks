import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  Crosshair,
  Leaf,
  MapPin,
  Move,
  Pencil,
  Plus,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { SiteDialog } from "@/components/forms/SiteDialog";
import { SitesMap } from "@/components/map";
import { StatusDot } from "@/components/StatusDot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRefreshData } from "@/hooks/use-data";
import { useViewer } from "@/hooks/use-viewer";
import { listClients } from "@/lib/api/clients";
import { listPlants } from "@/lib/api/plants";
import { listProjects, moveSite } from "@/lib/api/projects";
import { listWorkers } from "@/lib/api/workers";
import type { LatLng } from "@/lib/geo";
import type { Project } from "@/lib/types";

export const Route = createFileRoute("/projects")({
  head: () => ({
    meta: [
      { title: "Projects — Goldman Stocks" },
      {
        name: "description",
        content:
          "Every maintenance project with its plants, site map, assigned crew and contract value.",
      },
      { property: "og:title", content: "Projects — Goldman Stocks" },
      {
        property: "og:description",
        content:
          "Group plants and areas by project, with a site map and the crew assigned to it.",
      },
    ],
  }),
  loader: async () => {
    const [projects, allPlants, workers, clients] = await Promise.all([
      listProjects(),
      listPlants(),
      listWorkers(),
      listClients(),
    ]);
    return { projects, allPlants, workers, clients };
  },
  component: Projects,
});

function Projects() {
  const { projects, allPlants, workers, clients } = Route.useLoaderData();
  const refresh = useRefreshData();
  const companyArea = useViewer()?.member?.area ?? null;
  const [moving, setMoving] = useState(false);
  const [placing, setPlacing] = useState(false);
  // null = closed; otherwise the site being edited, or where a new one was clicked
  const [dialog, setDialog] = useState<{
    site?: Project;
    at?: LatLng;
  } | null>(null);

  const move = useMutation({
    mutationFn: ({ id, to }: { id: string; to: LatLng }) =>
      moveSite({ data: { id, lat: to.lat, lng: to.lng } }),
    onSuccess: async (_, { id }) => {
      await refresh();
      const name = projects.find((p) => p.id === id)?.name ?? "Site";
      toast.success(`${name} moved — its weather and routes follow`);
    },
    onError: (error) => toast.error(error.message),
  });

  // Derived here rather than per-project queries, which would mean hooks in the render loop.
  const plantCountByProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const plant of allPlants) {
      counts.set(plant.projectId, (counts.get(plant.projectId) ?? 0) + 1);
    }
    return counts;
  }, [allPlants]);
  const workerNameById = useMemo(
    () => new Map(workers.map((w) => [w.id, w.name])),
    [workers],
  );

  return (
    <AppShell
      title="Projects"
      subtitle={`${projects.length} active maintenance projects`}
      actions={
        <Button onClick={() => setDialog({})}>
          <Plus className="size-4" /> Add site
        </Button>
      }
    >
      <Card className="mb-4 shadow-card">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="size-4 text-primary" /> Sites map
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={placing ? "default" : "outline"}
              onClick={() => {
                setPlacing((p) => !p);
                setMoving(false);
              }}
            >
              <Crosshair className="size-4" />
              {placing ? "Click the map…" : "Place new site"}
            </Button>
            <Button
              size="sm"
              variant={moving ? "default" : "outline"}
              onClick={() => {
                setMoving((m) => !m);
                setPlacing(false);
              }}
            >
              <Move className="size-4" />
              {moving ? "Done moving" : "Move sites"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <SitesMap
            projects={projects}
            fallbackCenter={companyArea}
            editable={moving}
            onMove={(id, to) => move.mutate({ id, to })}
            onPick={
              placing
                ? (at) => {
                    setPlacing(false);
                    setDialog({ at });
                  }
                : undefined
            }
            height={380}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {moving
              ? "Drag a pin to where the site really is — it saves when you let go."
              : placing
                ? "Click where the new site is; you can fine-tune it in the form."
                : "Street or satellite view (top right). Click a pin to open the site."}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {projects.map((project) => {
          const plantCount = plantCountByProject.get(project.id) ?? 0;
          const crew = project.workerIds.flatMap((id) => {
            const name = workerNameById.get(id);
            return name ? [{ id, name }] : [];
          });
          return (
            <Card key={project.id} className="shadow-card">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{project.name}</CardTitle>
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="size-3.5" /> {project.address}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <StatusDot status={project.status} />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDialog({ site: project })}
                      aria-label={`Edit ${project.name}`}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-1.5">
                  {project.zones.map((zone) => (
                    <Badge key={zone} variant="secondary">
                      {zone}
                    </Badge>
                  ))}
                </div>

                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Plants & areas
                    </p>
                    <p className="font-medium">{plantCount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Visits / month
                    </p>
                    <p className="font-medium">{project.visitsPerMonth}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Monthly value
                    </p>
                    <p className="font-medium">
                      €{project.monthlyValue.toLocaleString("en-US")}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-sm">
                  <Users className="size-4 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    {crew.map((w) => w.name.split(" ")[0]).join(", ")}
                  </span>
                </div>

                <Link
                  to="/projects/$projectId"
                  params={{ projectId: project.id }}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  <Leaf className="size-4" /> Open project map
                  <ArrowRight className="size-4" />
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <SiteDialog
        site={dialog?.site}
        initialLocation={dialog?.at}
        clients={clients}
        workers={workers}
        open={dialog !== null}
        onOpenChange={(open) => (open ? null : setDialog(null))}
      />
    </AppShell>
  );
}
