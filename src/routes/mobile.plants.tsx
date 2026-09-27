import { createFileRoute } from "@tanstack/react-router";
import { ChevronRight, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { PlantCalendar } from "@/components/PlantCalendar";
import { PlantPhoto } from "@/components/PlantPhoto";
import { usePlants } from "@/hooks/use-data";
import type { PlantStatus } from "@/lib/types";
import { useCurrentWorker, useWorkerProjects } from "@/hooks/use-viewer";

const dotClass: Record<PlantStatus, string> = {
  healthy: "bg-status-healthy",
  attention: "bg-status-attention",
  critical: "bg-status-critical",
};

export const Route = createFileRoute("/mobile/plants")({
  component: MobilePlants,
});

function MobilePlants() {
  const worker = useCurrentWorker();
  const myProjects = useWorkerProjects(worker?.id);
  const plants = usePlants();
  const myPlants = useMemo(
    () => plants.filter((p) => myProjects.some((pr) => pr.id === p.projectId)),
    [plants, myProjects],
  );
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return myPlants.filter((p) =>
      q
        ? [p.code, p.species, p.common, p.client, p.site].some((v) =>
            v.toLowerCase().includes(q),
          )
        : true,
    );
  }, [query, myPlants]);

  const open = openId ? myPlants.find((p) => p.id === openId) : undefined;

  if (open) {
    return (
      <div className="space-y-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpenId(null)}
          className="-ml-3 text-xs text-muted-foreground"
        >
          <X className="size-3.5" /> Close calendar
        </Button>
        <div>
          <p className="font-display text-2xl font-bold text-primary">
            {open.common}
          </p>
          <p className="text-xs text-muted-foreground">
            {open.code} · {open.species}
          </p>
          <p className="text-xs text-muted-foreground">
            {open.client} · {open.site}
          </p>
        </div>
        <PlantPhoto plantId={open.id} />
        <PlantCalendar plant={open} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-accent-foreground">
          Care register
        </p>
        <h1 className="font-display text-3xl font-bold text-primary">
          Plants & areas
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {results.length} of {myPlants.length} items on{" "}
          {worker?.name.split(" ")[0]}'s sites
        </p>
      </div>

      <label className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5 shadow-sm focus-within:ring-2 focus-within:ring-ring">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search plant, site or client"
          className="w-full bg-transparent text-sm outline-none"
        />
      </label>

      <div className="space-y-4">
        {myProjects.map((project) => {
          const own = results.filter((p) => p.projectId === project.id);
          if (!own.length) return null;
          return (
            <section key={project.id} className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                {project.name} · {own.length}
              </p>
              <div className="overflow-hidden rounded-lg border bg-card shadow-card">
                {own.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setOpenId(p.id)}
                    className="flex w-full items-center gap-3 border-b p-3.5 text-left transition-colors hover:bg-secondary/60 last:border-b-0"
                  >
                    <span
                      className={`size-2.5 shrink-0 rounded-full ${dotClass[p.status]}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.common}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {p.site} · next: {p.nextTask} {p.nextCare}
                      </p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
