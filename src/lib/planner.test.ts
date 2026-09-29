/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import {
  canDo,
  hasAssignedWork,
  haversineKm,
  nearestNeighbor,
  pathLength,
  planDay,
  proposeDay,
  routeOrder,
  type PlanInput,
} from "./planner";
import { plants, projects, tasks, worker, workers } from "./__fixtures__/week";
import type { Project, Task, Worker } from "./types";
import type { SiteForecast } from "./weather";

const WEEK = [
  "2026-09-21",
  "2026-09-22",
  "2026-09-23",
  "2026-09-24",
  "2026-09-25",
];

const crew: Worker[] = [
  worker("head", "Head", "Head gardener", "ET"),
  worker("gard", "Gard", "Gardener", "ET"),
  worker("seas", "Seas", "Seasonal", "LV"),
  worker("tree", "Tree", "Tree care", "EN"),
];

function project(
  id: string,
  city: string,
  lat: number,
  lng: number,
  workerIds: string[],
): Project {
  return {
    id,
    name: id,
    clientId: "c",
    client: "c",
    city,
    address: "",
    lat,
    lng,
    zones: [],
    leadWorkerId: workerIds[0] ?? "",
    workerIds,
    visitsPerMonth: 4,
    monthlyValue: 1000,
    contractUntil: "2027-01-01",
    status: "healthy",
  };
}

const tallinnA = project("ta", "Tallinn", 59.43, 24.75, [
  "head",
  "gard",
  "seas",
  "tree",
]);
const tallinnB = project("tb", "Tallinn", 59.44, 24.79, [
  "head",
  "gard",
  "seas",
  "tree",
]);
const parnu = project("pa", "Pärnu", 58.38, 24.5, [
  "head",
  "gard",
  "seas",
  "tree",
]);
const riga = project("ri", "Riga", 56.97, 24.12, ["gard", "seas"]);

function task(overrides: Partial<Task>): Task {
  return {
    id: "t",
    title: "Job",
    projectId: "ta",
    client: "c",
    site: "s",
    workerId: "head",
    day: 0,
    start: 8,
    duration: 1,
    kind: "Mowing",
    status: "planned",
    ...overrides,
  };
}

function input(
  taskList: Task[],
  projectList = [tallinnA, tallinnB, parnu, riga],
): PlanInput {
  return { tasks: taskList, workers: crew, projects: projectList, plants: [] };
}

function noOverlaps(list: Task[]) {
  for (const a of list) {
    for (const b of list) {
      if (a === b || a.workerId !== b.workerId || a.day !== b.day) continue;
      if (a.status === "skipped" || b.status === "skipped") continue;
      expect(
        a.start < b.start + b.duration && b.start < a.start + a.duration,
      ).toBe(false);
    }
  }
}

describe("routing primitives", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 1, y: 0 },
    { x: 11, y: 0 },
    { x: 2, y: 5 },
    { x: 9, y: 5 },
  ];
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);

  test("2-opt is never longer than nearest-neighbor and keeps the start", () => {
    const nn = nearestNeighbor(points, dist);
    const opt = routeOrder(points, dist);
    expect(pathLength(opt, dist)).toBeLessThanOrEqual(
      pathLength(nn, dist) + 1e-9,
    );
    expect(opt[0]).toBe(points[0]!);
    expect(new Set(opt)).toEqual(new Set(points));
  });

  test("haversine is in the right ballpark (Tallinn–Riga ≈ 280 km)", () => {
    const km = haversineKm(
      { lat: 59.437, lng: 24.745 },
      { lat: 56.949, lng: 24.105 },
    );
    expect(km).toBeGreaterThan(270);
    expect(km).toBeLessThan(290);
  });
});

describe("assignment", () => {
  test("Seasonal is never given an inspection", () => {
    const inspection = task({
      id: "i",
      kind: "Inspection",
      workerId: "seas",
      projectId: "ta",
    });
    const { tasks: out } = planDay(input([inspection]), 0);
    const worker = crew.find((w) => w.id === out[0]?.workerId)!;
    expect(worker.role).not.toBe("Seasonal");
    expect(canDo(worker, "Inspection")).toBe(true);
  });

  test("a valid existing assignment is kept", () => {
    const mowing = task({ id: "m", kind: "Mowing", workerId: "seas" });
    const { tasks: out } = planDay(input([mowing]), 0);
    expect(out[0]?.workerId).toBe("seas");
  });

  test("a worker outside the site's crew is replaced, preferring the local language", () => {
    const job = task({
      id: "r",
      projectId: "ri",
      workerId: "head",
      kind: "Watering",
    });
    const { tasks: out } = planDay(input([job]), 0);
    expect(out[0]?.workerId).toBe("seas"); // LV speaker on the Riga crew
  });

  test("work beyond 8 hours moves to someone with room", () => {
    const long = task({
      id: "long",
      workerId: "gard",
      duration: 7,
      kind: "Planting",
    });
    const extra = task({
      id: "extra",
      workerId: "gard",
      duration: 2,
      kind: "Planting",
    });
    const { tasks: out } = planDay(input([long, extra]), 0);
    expect(out.find((t) => t.id === "long")?.workerId).toBe("gard");
    expect(out.find((t) => t.id === "extra")?.workerId).not.toBe("gard");
  });
});

describe("routing and timing", () => {
  test("stops at the same site stay together", () => {
    const list = [
      task({ id: "a", projectId: "ta", start: 8 }),
      task({ id: "b", projectId: "pa", start: 9 }),
      task({ id: "c", projectId: "ta", start: 10 }),
    ];
    const { byWorker } = planDay(input(list), 0);
    const order = byWorker
      .find((p) => p.workerId === "head")!
      .stops.map((t) => t.projectId);
    expect(order).toEqual(["ta", "ta", "pa"]);
  });

  test("a drive between cities leaves a travel gap", () => {
    const list = [
      task({ id: "a", projectId: "ta", start: 8, duration: 2 }),
      task({ id: "b", projectId: "pa", start: 13, duration: 2 }),
    ];
    const { tasks: out } = planDay(input(list), 0);
    const a = out.find((t) => t.id === "a")!;
    const b = out.find((t) => t.id === "b")!;
    expect(a.start).toBe(8);
    expect(b.start).toBeGreaterThanOrEqual(a.start + a.duration + 2); // ~130 km
  });

  test("done and skipped tasks keep their time; nothing overlaps them", () => {
    const done = task({ id: "done", status: "done", start: 9, duration: 2 });
    const skipped = task({ id: "skip", status: "skipped", start: 8 });
    const open = task({ id: "open", start: 12, duration: 2 });
    const { tasks: out } = planDay(input([done, skipped, open]), 0);
    expect(out.find((t) => t.id === "done")?.start).toBe(9);
    expect(out.find((t) => t.id === "skip")?.start).toBe(8);
    noOverlaps(out);
  });

  test("an approved day is returned untouched", () => {
    const list = [
      task({ id: "a", start: 15, approvedAt: "2026-09-21T06:00:00Z" }),
    ];
    expect(planDay(input(list), 0).tasks).toEqual(list);
  });
});

describe("a sample week", () => {
  const week: PlanInput = { tasks, workers, projects, plants };

  test("every day plans without losing tasks or double-booking anyone", () => {
    for (let day = 0; day < 5; day++) {
      const { tasks: out, byWorker } = planDay(week, day);
      expect(out.map((t) => t.id).sort()).toEqual(
        tasks.map((t) => t.id).sort(),
      );
      noOverlaps(out.filter((t) => t.day === day));
      for (const plan of byWorker) expect(plan.hours).toBeLessThanOrEqual(8);
    }
  });

  test("feeding is taken off the seasonal worker", () => {
    const { tasks: out } = planDay(week, 3);
    const feeding = out.find((t) => t.id === "t8")!;
    expect(workers.find((w) => w.id === feeding.workerId)?.role).not.toBe(
      "Seasonal",
    );
  });

  test("nobody is sent between cities in one day when someone local can go", () => {
    for (let day = 0; day < 5; day++) {
      for (const plan of planDay(week, day).byWorker)
        expect(plan.km).toBeLessThan(50);
    }
  });

  test("proposeDay: rain skips watering, and the skipped task is not routed", () => {
    const wet: SiteForecast = {
      hourly: [{ time: "2026-09-20T23:00", precipMm: 9 }],
      daily: WEEK.map((date) => ({
        date,
        precipMm: 0,
        tempMaxC: 12,
        weatherCode: 61,
      })),
    };
    const { tasks: out, byWorker } = proposeDay(week, 0, { p2: wet }, WEEK);
    const t3 = out.find((t) => t.id === "t3")!; // watering at Hotel Nordic Grand (p2)
    expect(t3.status).toBe("skipped");
    expect(t3.weatherNote).toBe("Skipped — 9 mm rain overnight");
    const liis = byWorker.find((p) => p.workerId === t3.workerId)!;
    expect(liis.stops.some((t) => t.id === "t3")).toBe(false);
    expect(liis.skipped.some((t) => t.id === "t3")).toBe(true);
  });
});

describe("hasAssignedWork", () => {
  const task = tasks[0]!;

  test("someone with a job, or a job the weather skipped, is a plan to review", () => {
    expect(hasAssignedWork([{ stops: [task], skipped: [] }])).toBe(true);
    expect(hasAssignedWork([{ stops: [], skipped: [task] }])).toBe(true);
  });

  test("nobody, or nobody with anything assigned, is no plan", () => {
    expect(hasAssignedWork([])).toBe(false);
    expect(
      hasAssignedWork([
        { stops: [], skipped: [] },
        { stops: [], skipped: [] },
      ]),
    ).toBe(false);
  });
});
