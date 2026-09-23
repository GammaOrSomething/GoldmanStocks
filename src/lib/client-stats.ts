import { localDate } from "./weather";

export type ClientStats = {
  sites: number;
  plants: number;
  /** hours of proven work this month — see `summarizeClients` */
  hoursThisMonth: number;
};

export type ClientActivity = {
  projects: { id: string; clientId: string }[];
  plants: { projectId: string }[];
  tasks: { id: string; projectId: string; duration: number }[];
  /** proof photos already limited to the month being summarised */
  photos: { taskId: string; takenAt: string }[];
};

/** What a client with no sites yet shows. */
export const emptyClientStats: ClientStats = {
  sites: 0,
  plants: 0,
  hoursThisMonth: 0,
};

/**
 * Per-client counts, worked out from the records rather than stored as counters that drift.
 *
 * Hours are the planned durations of jobs proven with a photo. A job counts once per local day
 * however many photos it has, so a recurring weekly task done four times counts four times.
 * They use each task's *current* duration and site, so editing a task changes the hours already
 * counted for it this month, and deleting one removes them (its photos go with it).
 */
export function summarizeClients(
  activity: ClientActivity,
): Map<string, ClientStats> {
  const clientOf = new Map(activity.projects.map((p) => [p.id, p.clientId]));
  const stats = new Map<string, ClientStats>();
  const bump = (clientId: string | undefined, patch: Partial<ClientStats>) => {
    if (!clientId) return;
    const current = stats.get(clientId) ?? emptyClientStats;
    stats.set(clientId, {
      sites: current.sites + (patch.sites ?? 0),
      plants: current.plants + (patch.plants ?? 0),
      hoursThisMonth: current.hoursThisMonth + (patch.hoursThisMonth ?? 0),
    });
  };

  for (const project of activity.projects) bump(project.clientId, { sites: 1 });
  for (const plant of activity.plants)
    bump(clientOf.get(plant.projectId), { plants: 1 });

  const taskById = new Map(activity.tasks.map((t) => [t.id, t]));
  const visits = new Set(
    activity.photos.map(
      (photo) => `${photo.taskId}|${localDate(new Date(photo.takenAt))}`,
    ),
  );
  for (const visit of visits) {
    const task = taskById.get(visit.split("|")[0] ?? "");
    if (task)
      bump(clientOf.get(task.projectId), { hoursThisMonth: task.duration });
  }

  return stats;
}
