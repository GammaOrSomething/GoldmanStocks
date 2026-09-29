import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";

import { listClients } from "@/lib/api/clients";
import { listPlants } from "@/lib/api/plants";
import { listProjects } from "@/lib/api/projects";
import { listWorkers } from "@/lib/api/workers";
import type { Client, Plant, Project, Worker } from "@/lib/types";

/**
 * The company's records, from the database — one cached query per list, shared by every screen
 * that isn't served by a route loader (dashboard, schedule, planner, the worker app).
 */
export const dataKeys = {
  clients: ["clients"],
  workers: ["workers"],
  projects: ["projects"],
  plants: ["plants"],
  tasks: ["tasks"],
  offers: ["offers"],
  /** the week's forecast: it follows the sites (and the company's area), so refresh it with them */
  weekWeather: ["week-weather"],
} as const;

const NO_CLIENTS: Client[] = [];
const NO_WORKERS: Worker[] = [];
const NO_PROJECTS: Project[] = [];
const NO_PLANTS: Plant[] = [];

export function useClients() {
  const q = useQuery({
    queryKey: dataKeys.clients,
    queryFn: () => listClients(),
  });
  return q.data ?? NO_CLIENTS;
}

export function useWorkers() {
  const q = useQuery({
    queryKey: dataKeys.workers,
    queryFn: () => listWorkers(),
  });
  return q.data ?? NO_WORKERS;
}

export function useProjects() {
  const q = useQuery({
    queryKey: dataKeys.projects,
    queryFn: () => listProjects(),
  });
  return q.data ?? NO_PROJECTS;
}

export function usePlants() {
  const q = useQuery({
    queryKey: dataKeys.plants,
    queryFn: () => listPlants(),
  });
  return q.data ?? NO_PLANTS;
}

/**
 * After a write: refetch every cached list and re-run the current route's loader, so pages
 * served by loaders (clients, projects, plants, workers) and hook-driven screens both update.
 */
export function useRefreshData() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useCallback(async () => {
    await Promise.all([
      ...Object.values(dataKeys).map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
      router.invalidate(),
    ]);
  }, [queryClient, router]);
}
