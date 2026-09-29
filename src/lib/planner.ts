import type { Plant, Project, Task, Worker } from "./types";
import { applyWeatherRules, type ForecastByProject } from "./weather";

/** Task kinds each job title may be given. Titles not listed may do anything. */
export const SKILLS: Record<string, Task["kind"][]> = {
  "Head gardener": [
    "Watering",
    "Clipping",
    "Mowing",
    "Planting",
    "Inspection",
    "Feeding",
  ],
  Gardener: ["Watering", "Clipping", "Mowing", "Planting", "Feeding"],
  Seasonal: ["Watering", "Clipping", "Mowing", "Planting"],
  "Tree care": ["Inspection", "Clipping", "Watering", "Feeding"],
};

/** Language spoken at sites in each city — a soft preference when picking a worker. */
const CITY_LANGUAGE: Record<string, string> = {
  Tallinn: "ET",
  Pärnu: "ET",
  Riga: "LV",
};

export const DAY_START = 8;
export const MAX_HOURS = 8;
/** Sites closer than this count as the same stop area — no travel gap between them. */
const LOCAL_KM = 5;
const DRIVE_KMH = 50;

export type PlanInput = {
  tasks: Task[];
  workers: Worker[];
  projects: Project[];
  plants: Plant[];
};

export type DayPlan = {
  workerId: string;
  /** planned and done tasks in route order */
  stops: Task[];
  /** tasks called off (e.g. by rain) — not routed */
  skipped: Task[];
  hours: number;
  km: number;
};

export type DayPlanResult = {
  /** the full task list, with `day`'s tasks replaced by their planned versions */
  tasks: Task[];
  byWorker: DayPlan[];
};

/**
 * Whether anyone has work in a day plan, including jobs the weather called off: what makes it
 * worth reviewing, approving and explaining. A task nobody could be assigned doesn't count.
 */
export function hasAssignedWork(
  byWorker: readonly {
    stops: readonly unknown[];
    skipped: readonly unknown[];
  }[],
): boolean {
  return byWorker.some((w) => w.stops.length > 0 || w.skipped.length > 0);
}

// ─── Geometry and routing ────────────────────────────────────────────────────

type LatLng = { lat: number; lng: number };

export function haversineKm(a: LatLng, b: LatLng) {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function pathLength<T>(path: T[], dist: (a: T, b: T) => number) {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += dist(path[i - 1]!, path[i]!);
  return total;
}

/** Greedy route: from `points[0]`, always go to the closest unvisited point. */
export function nearestNeighbor<T>(
  points: T[],
  dist: (a: T, b: T) => number,
): T[] {
  const [first, ...rest] = points;
  if (first === undefined) return [];
  const path = [first];
  const left = [...rest];
  while (left.length) {
    const here = path[path.length - 1]!;
    let best = 0;
    for (let i = 1; i < left.length; i++) {
      if (dist(here, left[i]!) < dist(here, left[best]!)) best = i;
    }
    path.push(left.splice(best, 1)[0]!);
  }
  return path;
}

/** Improve an open path (fixed start, free end) by reversing segments while that shortens it. */
export function twoOpt<T>(path: T[], dist: (a: T, b: T) => number): T[] {
  const p = [...path];
  const d = (i: number, j: number) =>
    p[i] === undefined || p[j] === undefined ? 0 : dist(p[i]!, p[j]!);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < p.length - 1; i++) {
      for (let k = i + 1; k < p.length; k++) {
        const delta = d(i - 1, k) + d(i, k + 1) - d(i - 1, i) - d(k, k + 1);
        if (delta < -1e-9) {
          p.splice(i, k - i + 1, ...p.slice(i, k + 1).reverse());
          improved = true;
        }
      }
    }
  }
  return p;
}

/** Nearest-neighbor from `points[0]`, then 2-opt. */
export function routeOrder<T>(points: T[], dist: (a: T, b: T) => number): T[] {
  return twoOpt(nearestNeighbor(points, dist), dist);
}

// ─── Assignment ──────────────────────────────────────────────────────────────

export function canDo(worker: Worker, kind: Task["kind"]) {
  const skills = SKILLS[worker.role];
  return !skills || skills.includes(kind);
}

function driveHours(km: number) {
  return km >= LOCAL_KM ? Math.ceil(km / DRIVE_KMH) : 0;
}

function assign(dayTasks: Task[], input: PlanInput): Task[] {
  const projectById = new Map(input.projects.map((p) => [p.id, p]));
  // hours of work + driving already on each worker's day, and the sites they're at
  const load = new Map(input.workers.map((w) => [w.id, 0]));
  const sites = new Map<string, string[]>(input.workers.map((w) => [w.id, []]));
  for (const t of dayTasks) {
    if (t.status !== "done") continue;
    load.set(t.workerId, (load.get(t.workerId) ?? 0) + t.duration);
    sites.get(t.workerId)?.push(t.projectId);
  }

  const assigned = new Map<string, Task>();
  const planned = dayTasks
    .filter((t) => t.status === "planned")
    .sort((a, b) => b.duration - a.duration || a.id.localeCompare(b.id));

  for (const task of planned) {
    const project = projectById.get(task.projectId);
    const crew = project?.workerIds.length
      ? input.workers.filter((w) => project.workerIds.includes(w.id))
      : input.workers;
    const eligible = crew.filter((w) => canDo(w, task.kind));
    // Driving from the nearest site the worker is already at today, if any.
    const travel = (w: Worker) => {
      const km = Math.min(
        ...(sites.get(w.id) ?? []).map((id) => {
          const there = projectById.get(id);
          return there && project ? haversineKm(there, project) : 0;
        }),
      );
      return Number.isFinite(km) ? driveHours(km) : 0;
    };
    const cost = (w: Worker) => task.duration + travel(w);
    const fits = (w: Worker) => (load.get(w.id) ?? 0) + cost(w) <= MAX_HOURS;
    const current = eligible.find((w) => w.id === task.workerId);

    let chosen: Worker | undefined;
    if (current && fits(current)) {
      chosen = current; // keep the boss's choice while it still works
    } else {
      const siteLanguage = project ? CITY_LANGUAGE[project.city] : undefined;
      const pool = eligible.filter(fits);
      const ranked = (pool.length ? pool : eligible).sort(
        (a, b) =>
          travel(a) - travel(b) ||
          Number(b.language === siteLanguage) -
            Number(a.language === siteLanguage) ||
          (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) ||
          crew.indexOf(a) - crew.indexOf(b),
      );
      chosen = pool.length || !current ? ranked[0] : current;
    }

    const worker = chosen ?? input.workers.find((w) => w.id === task.workerId);
    const workerId = worker?.id ?? task.workerId;
    load.set(
      workerId,
      (load.get(workerId) ?? 0) + (worker ? cost(worker) : task.duration),
    );
    sites.get(workerId)?.push(task.projectId);
    assigned.set(task.id, { ...task, workerId });
  }

  return dayTasks.map((t) => assigned.get(t.id) ?? t);
}

// ─── Routing + timing per worker ─────────────────────────────────────────────

function overlaps(a: Task, start: number, duration: number) {
  return start < a.start + a.duration && a.start < start + duration;
}

function routeWorker(workerTasks: Task[], input: PlanInput): Task[] {
  const projectById = new Map(input.projects.map((p) => [p.id, p]));
  const plantById = new Map(input.plants.map((p) => [p.id, p]));
  const fixed = workerTasks.filter((t) => t.status === "done");
  const open = [...workerTasks.filter((t) => t.status === "planned")].sort(
    (a, b) => a.start - b.start || a.id.localeCompare(b.id),
  );
  if (!open.length) return workerTasks;

  // Sites first (real distances), starting where the worker's day currently starts.
  const siteIds = [...new Set(open.map((t) => t.projectId))];
  const siteKm = (a: string, b: string) => {
    const pa = projectById.get(a);
    const pb = projectById.get(b);
    return pa && pb ? haversineKm(pa, pb) : 0;
  };
  const siteOrder = routeOrder(siteIds, siteKm);

  // Then stops within each site (plant position on the site plan, in %).
  const at = (t: Task) => {
    const plant = t.plantId ? plantById.get(t.plantId) : undefined;
    return plant ? { x: plant.x, y: plant.y } : { x: 50, y: 50 };
  };
  const planDist = (a: Task, b: Task) =>
    Math.hypot(at(a).x - at(b).x, at(a).y - at(b).y);
  const ordered = siteOrder.flatMap((siteId) =>
    routeOrder(
      open.filter((t) => t.projectId === siteId),
      planDist,
    ),
  );

  // Timing: whole hours from DAY_START, around done tasks, with a drive gap between far sites.
  const placed: Task[] = [...fixed];
  let cursor = DAY_START;
  let previousSite: string | undefined;
  for (const task of ordered) {
    if (previousSite && previousSite !== task.projectId) {
      cursor += driveHours(siteKm(previousSite, task.projectId));
    }
    let start = cursor;
    while (placed.some((p) => overlaps(p, start, task.duration))) start++;
    placed.push({ ...task, start });
    cursor = start + task.duration;
    previousSite = task.projectId;
  }

  const byId = new Map(placed.map((t) => [t.id, t]));
  return workerTasks.map((t) => byId.get(t.id) ?? t);
}

// ─── Public API ──────────────────────────────────────────────────────────────

function summarize(dayTasks: Task[], input: PlanInput): DayPlan[] {
  const projectById = new Map(input.projects.map((p) => [p.id, p]));
  return input.workers.map((w) => {
    const own = dayTasks.filter((t) => t.workerId === w.id);
    const stops = own
      .filter((t) => t.status !== "skipped")
      .sort((a, b) => a.start - b.start);
    let km = 0;
    for (let i = 1; i < stops.length; i++) {
      const a = projectById.get(stops[i - 1]!.projectId);
      const b = projectById.get(stops[i]!.projectId);
      if (a && b) km += haversineKm(a, b);
    }
    return {
      workerId: w.id,
      stops,
      skipped: own.filter((t) => t.status === "skipped"),
      hours: stops.reduce((sum, t) => sum + t.duration, 0),
      km: Math.round(km),
    };
  });
}

/**
 * Assign `day`'s planned tasks to workers (skills, crew, language, 8 h cap), then order
 * and time each worker's stops: sites by real distance, stops within a site by their
 * position on the site plan. Done and skipped tasks keep their worker and time. An
 * approved day is returned as it is.
 */
export function planDay(input: PlanInput, day: number): DayPlanResult {
  const dayTasks = input.tasks.filter((t) => t.day === day);
  if (dayTasks.some((t) => t.approvedAt)) {
    return { tasks: input.tasks, byWorker: summarize(dayTasks, input) };
  }

  const assigned = assign(dayTasks, input);
  const routed = input.workers.flatMap((w) =>
    routeWorker(
      assigned.filter((t) => t.workerId === w.id),
      input,
    ),
  );
  const unrouted = assigned.filter(
    (t) => !input.workers.some((w) => w.id === t.workerId),
  );
  const byId = new Map([...routed, ...unrouted].map((t) => [t.id, t]));
  const planned = dayTasks.map((t) => byId.get(t.id) ?? t);

  return {
    tasks: input.tasks.map((t) => byId.get(t.id) ?? t),
    byWorker: summarize(planned, input),
  };
}

/**
 * The full proposal for a day: weather rules, then the planner (rained-off tasks are not
 * routed), then the weather rules again so warm-spell moves apply to the new times.
 */
export function proposeDay(
  input: PlanInput,
  day: number,
  forecastByProject: ForecastByProject,
  weekDates: string[],
): DayPlanResult {
  const weathered = applyWeatherRules(
    input.tasks,
    forecastByProject,
    weekDates,
  );
  const planned = planDay({ ...input, tasks: weathered }, day);
  const tasks = applyWeatherRules(planned.tasks, forecastByProject, weekDates);
  const dayTasks = tasks.filter((t) => t.day === day);
  return { tasks, byWorker: summarize(dayTasks, input) };
}
