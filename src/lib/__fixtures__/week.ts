/**
 * A small, realistic week for tests only: three cities, five sites, four crew members and one
 * week of jobs. Never import this from app code — the app reads everything from the database.
 */
import type { Client, Plant, Project, Task, Worker } from "../types";

export const workers: Worker[] = [
  { id: "w1", name: "Head", role: "Head gardener", language: "ET", color: "" },
  { id: "w2", name: "Gardener", role: "Gardener", language: "ET", color: "" },
  { id: "w3", name: "Seasonal", role: "Seasonal", language: "LV", color: "" },
  { id: "w4", name: "Arborist", role: "Tree care", language: "EN", color: "" },
];

function client(id: string, city: string, monthlyValue: number): Client {
  return {
    id,
    name: `Client ${id}`,
    city,
    sites: 1,
    plants: 3,
    contact: `Contact ${id}`,
    hoursThisMonth: 0,
    monthlyValue,
    contractUntil: "2027-03-31",
    health: "good",
  };
}

export const clients: Client[] = [
  client("c1", "Tallinn", 2400),
  client("c2", "Tallinn", 1150),
  client("c3", "Pärnu", 890),
  client("c4", "Riga", 2760),
  client("c5", "Tallinn", 420),
];

function project(
  id: string,
  clientId: string,
  city: string,
  [lat, lng]: [number, number],
  workerIds: string[],
  visitsPerMonth: number,
  monthlyValue: number,
): Project {
  return {
    id,
    name: `Site ${id}`,
    clientId,
    client: `Client ${clientId}`,
    city,
    address: "",
    lat,
    lng,
    zones: [],
    leadWorkerId: workerIds[0] ?? "",
    workerIds,
    visitsPerMonth,
    monthlyValue,
    contractUntil: "2027-03-31",
    status: "healthy",
  };
}

export const projects: Project[] = [
  project(
    "p1",
    "c1",
    "Tallinn",
    [59.4196, 24.8048],
    ["w1", "w4", "w2"],
    8,
    2400,
  ),
  project("p2", "c2", "Tallinn", [59.4335, 24.7581], ["w2", "w1"], 6, 1150),
  project("p3", "c3", "Pärnu", [58.376, 24.5], ["w2", "w3"], 4, 890),
  project("p4", "c4", "Riga", [56.9776, 24.1368], ["w3", "w4"], 8, 2760),
  project("p5", "c5", "Tallinn", [59.4379, 24.7801], ["w1", "w3"], 4, 420),
];

function plant(
  id: string,
  projectId: string,
  kind: Plant["kind"],
  lastCareDate: string,
  nextCareDate: string,
  [x, y]: [number, number],
): Plant {
  return {
    id,
    projectId,
    species: kind,
    common: `${kind} ${id}`,
    kind,
    client: `Client c${projectId.slice(1)}`,
    site: "Zone",
    status: "healthy",
    lastCare: lastCareDate,
    nextCare: nextCareDate,
    nextTask: "Maintenance",
    x,
    y,
    lastCareDate,
    nextCareDate,
  };
}

export const plants: Plant[] = [
  plant("PL-0142", "p1", "Tree", "2026-09-12", "2026-09-24", [28, 24]),
  plant("PL-0143", "p1", "Hedge", "2026-09-02", "2026-09-21", [68, 38]),
  plant("PL-0156", "p1", "Tree", "2026-09-10", "2026-10-05", [46, 72]),
  plant("PL-0161", "p1", "Lawn", "2026-09-13", "2026-09-22", [18, 55]),
  plant("PL-0210", "p2", "Lawn", "2026-09-15", "2026-09-22", [32, 30]),
  plant("PL-0288", "p2", "Shrub", "2026-08-28", "2026-09-21", [70, 62]),
  plant("PL-0292", "p2", "Shrub", "2026-09-12", "2026-09-30", [50, 20]),
  plant("PL-0301", "p3", "Flower bed", "2026-09-09", "2026-09-23", [24, 66]),
  plant("PL-0455", "p3", "Flower bed", "2026-09-14", "2026-09-28", [62, 34]),
  plant("PL-0461", "p3", "Shrub", "2026-09-08", "2026-10-12", [40, 80]),
  plant("PL-0355", "p4", "Tree", "2026-09-11", "2026-10-02", [30, 26]),
  plant("PL-0372", "p4", "Hedge", "2026-08-30", "2026-09-21", [64, 48]),
  plant("PL-0380", "p4", "Flower bed", "2026-09-01", "2026-09-25", [44, 76]),
  plant("PL-0398", "p5", "Shrub", "2026-08-18", "2026-09-21", [66, 58]),
  plant("PL-0401", "p5", "Lawn", "2026-09-16", "2026-09-26", [28, 34]),
];

function task(
  id: string,
  projectId: string,
  plantId: string,
  workerId: string,
  day: number,
  start: number,
  duration: number,
  kind: Task["kind"],
  extra: Partial<Task> = {},
): Task {
  return {
    id,
    title: `${kind} job`,
    projectId,
    client: `Client c${projectId.slice(1)}`,
    site: "Zone",
    plantId,
    workerId,
    day,
    start,
    duration,
    kind,
    status: "planned",
    ...extra,
  };
}

export const tasks: Task[] = [
  task("t1", "p1", "PL-0143", "w1", 0, 8, 3, "Clipping"),
  task("t2", "p1", "PL-0142", "w4", 0, 9, 2, "Inspection"),
  task("t3", "p2", "PL-0288", "w2", 0, 8, 2, "Watering", {
    weatherNote: "Skipped — 9 mm rain overnight",
    status: "skipped",
  }),
  task("t4", "p2", "PL-0210", "w2", 1, 8, 3, "Mowing"),
  task("t5", "p4", "PL-0372", "w3", 1, 9, 4, "Clipping"),
  task("t6", "p3", "PL-0301", "w2", 2, 10, 2, "Clipping"),
  task("t7", "p5", "PL-0398", "w1", 2, 8, 2, "Watering"),
  task("t8", "p4", "PL-0355", "w3", 3, 8, 3, "Feeding"),
  task("t9", "p1", "PL-0142", "w4", 3, 12, 2, "Inspection"),
  task("t10", "p3", "PL-0455", "w2", 4, 9, 4, "Planting"),
  task("t11", "p5", "PL-0401", "w1", 4, 8, 2, "Mowing"),
  task("t13", "p1", "PL-0142", "w1", 5, 9, 2, "Watering"),
  task("t14", "p1", "PL-0143", "w1", 5, 11, 1, "Inspection"),
  task("t12", "p5", "PL-0398", "w3", 0, 13, 2, "Watering", { status: "done" }),
];
