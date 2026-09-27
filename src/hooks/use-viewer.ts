import { useRouteContext } from "@tanstack/react-router";
import { useMemo } from "react";

import { useProjects, useWorkers } from "@/hooks/use-data";
import type { Viewer } from "@/lib/auth/access";
import type { Project, Worker } from "@/lib/types";

/** The signed-in person, as the root route's guard resolved them. */
export function useViewer(): Viewer {
  return useRouteContext({ from: "__root__" }).viewer;
}

/**
 * The signed-in person's worker record. A boss has one too, so the worker app shows a boss
 * their own jobs. Undefined while the worker list loads; the guard keeps anyone without a
 * company out of the pages that use it.
 */
export function useCurrentWorker(): Worker | undefined {
  const workerId = useViewer()?.member?.workerId;
  const workers = useWorkers();
  return workerId ? workers.find((w) => w.id === workerId) : undefined;
}

/** Sites the given worker is on, as crew or lead. */
export function useWorkerProjects(workerId: string | undefined): Project[] {
  const projects = useProjects();
  return useMemo(
    () =>
      workerId
        ? projects.filter(
            (p) =>
              p.workerIds.includes(workerId) || p.leadWorkerId === workerId,
          )
        : [],
    [projects, workerId],
  );
}
