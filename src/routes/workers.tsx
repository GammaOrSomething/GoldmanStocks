import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Pencil, Smartphone, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { WorkerDialog } from "@/components/forms/WorkerDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listTasks } from "@/lib/api/tasks";
import { listWorkers } from "@/lib/api/workers";
import { weekDays } from "@/lib/labels";
import { taskDateIn } from "@/lib/task-schedule";
import type { Worker } from "@/lib/types";
import { planWeekDates } from "@/lib/weather";
import { setActiveWorker } from "@/lib/worker-store";

export const Route = createFileRoute("/workers")({
  head: () => ({
    meta: [
      { title: "Workers — Goldman Stocks" },
      {
        name: "description",
        content:
          "Crew overview: planned hours per worker this week and languages.",
      },
      { property: "og:title", content: "Workers — Goldman Stocks" },
      {
        property: "og:description",
        content: "Crew overview with weekly workload and worker app access.",
      },
    ],
  }),
  loader: async () => {
    const [workers, tasks] = await Promise.all([listWorkers(), listTasks()]);
    return { workers, tasks };
  },
  component: Workers,
});

function Workers() {
  const { workers, tasks } = Route.useLoaderData();
  const navigate = useNavigate();
  // undefined = closed, null = new worker, a worker = editing them
  const [editing, setEditing] = useState<Worker | null | undefined>();
  const languages = [...new Set(workers.map((w) => w.language))].join(", ");
  // The bars below are this week's workload, so a job dated in a future month is not counted.
  const weekDates = useMemo(() => planWeekDates(new Date()), []);

  return (
    <AppShell
      title="Workers"
      subtitle={`Crew of ${workers.length} · speaking ${languages || "—"}`}
      actions={
        <Button onClick={() => setEditing(null)}>
          <UserPlus className="size-4" /> Add worker
        </Button>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        {workers.map((w) => {
          const own = tasks.filter((t) => t.workerId === w.id);
          const hours = own.reduce((s, t) => s + t.duration, 0);
          const done = own.filter((t) => t.status === "done").length;
          return (
            <Card key={w.id} className="shadow-card">
              <CardHeader className="flex-row items-center justify-between">
                <div className="flex items-center gap-3">
                  <span
                    className="flex size-10 items-center justify-center rounded-full text-sm font-semibold"
                    style={{
                      background: `color-mix(in oklab, ${w.color} 20%, white)`,
                      color: w.color,
                    }}
                  >
                    {w.name
                      .split(" ")
                      .map((p) => p[0])
                      .join("")}
                  </span>
                  <div>
                    <CardTitle className="text-base">{w.name}</CardTitle>
                    <p className="text-sm text-muted-foreground">{w.role}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant="secondary">{w.language}</Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditing(w)}
                    aria-label={`Edit ${w.name}`}
                  >
                    <Pencil className="size-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Planned hours
                    </p>
                    <p className="font-medium">{hours} h</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Tasks this week
                    </p>
                    <p className="font-medium">{own.length}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Proven with photo
                    </p>
                    <p className="font-medium">{done}</p>
                  </div>
                </div>

                <div className="flex gap-1.5">
                  {weekDays.map((d, i) => {
                    const dayHours = own
                      .filter(
                        (t) =>
                          taskDateIn(t, weekDates) === (weekDates[i] ?? ""),
                      )
                      .reduce((s, t) => s + t.duration, 0);
                    return (
                      <div key={d} className="flex-1 text-center">
                        <div className="flex h-16 items-end justify-center rounded-md bg-muted/60 p-1">
                          <div
                            className="w-full rounded"
                            style={{
                              height: `${Math.min(100, (dayHours / 8) * 100)}%`,
                              background: w.color,
                            }}
                          />
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {d}
                        </p>
                      </div>
                    );
                  })}
                </div>

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setActiveWorker(w.id);
                    void navigate({ to: "/mobile" });
                  }}
                >
                  <Smartphone className="size-4" /> Open in worker app
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <WorkerDialog
        worker={editing ?? undefined}
        open={editing !== undefined}
        onOpenChange={(open) => (open ? null : setEditing(undefined))}
      />
    </AppShell>
  );
}
