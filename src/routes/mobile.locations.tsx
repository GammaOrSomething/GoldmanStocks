import { createFileRoute } from "@tanstack/react-router";
import { MapPin, Users } from "lucide-react";

import { SiteMap } from "@/components/map";
import { usePlants, useWorkers } from "@/hooks/use-data";
import { useCurrentWorker, useWorkerProjects } from "@/hooks/use-viewer";

export const Route = createFileRoute("/mobile/locations")({
  component: MobileLocations,
  head: () => ({
    meta: [
      { title: "Work sites — Goldman Stocks worker app" },
      {
        name: "description",
        content:
          "Every site on the crew's list, with its address, crew and plant map.",
      },
      {
        property: "og:title",
        content: "Work sites — Goldman Stocks worker app",
      },
      {
        property: "og:description",
        content:
          "Every site on the crew's list, with its address, crew and plant map.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function MobileLocations() {
  const worker = useCurrentWorker();
  const myProjects = useWorkerProjects(worker?.id);
  const allPlants = usePlants();
  const workers = useWorkers();

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-accent-foreground">
          Assigned sites
        </p>
        <h1 className="font-display text-3xl font-bold text-primary">
          Locations
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {myProjects.length} sites for {worker?.name.split(" ")[0]} — tap a dot
          on a map to see a plant.
        </p>
      </div>

      {myProjects.map((project) => {
        const crew = project.workerIds.flatMap((id) => {
          const w = workers.find((x) => x.id === id);
          return w ? [{ ...w, isLead: project.leadWorkerId === id }] : [];
        });
        const plants = allPlants.filter((p) => p.projectId === project.id);
        return (
          <section
            key={project.id}
            className="space-y-3 rounded-lg border bg-card p-4 shadow-card"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-display text-xl font-bold leading-tight text-primary">
                  {project.name}
                </h2>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {project.address}, {project.city}
                  </span>
                </p>
              </div>
              <span className="shrink-0 rounded-md bg-accent/12 px-2.5 py-1 text-[11px] font-semibold text-accent-foreground">
                {plants.length} plants
              </span>
            </div>

            <SiteMap project={project} plants={plants} height={260} />

            <div className="flex items-center gap-2 border-t pt-3">
              <Users className="size-4 shrink-0 text-muted-foreground" />
              <div className="flex flex-wrap gap-1.5">
                {crew.map((w) => (
                  <span
                    key={w.id}
                    className="flex items-center gap-1.5 rounded-md bg-secondary px-2.5 py-1 text-[11px] font-medium"
                  >
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: w.color }}
                    />
                    {w.name.split(" ")[0]}
                    {w.isLead ? " · lead" : ""}
                  </span>
                ))}
              </div>
            </div>
          </section>
        );
      })}

      {myProjects.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          No sites assigned to {worker?.name.split(" ")[0]} yet.
        </p>
      ) : null}
    </div>
  );
}
