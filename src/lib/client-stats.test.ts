/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { emptyClientStats, summarizeClients } from "./client-stats";

const projects = [
  { id: "p1", clientId: "c1" },
  { id: "p2", clientId: "c1" },
  { id: "p3", clientId: "c2" },
];
const plants = [
  { projectId: "p1" },
  { projectId: "p1" },
  { projectId: "p2" },
  { projectId: "p3" },
];
const tasks = [
  { id: "t1", projectId: "p1", duration: 2 },
  { id: "t2", projectId: "p2", duration: 1.5 },
  { id: "t3", projectId: "p3", duration: 3 },
];

describe("summarizeClients", () => {
  test("counts each client's sites and plants", () => {
    const stats = summarizeClients({ projects, plants, tasks, photos: [] });
    expect(stats.get("c1")).toEqual({ sites: 2, plants: 3, hoursThisMonth: 0 });
    expect(stats.get("c2")).toEqual({ sites: 1, plants: 1, hoursThisMonth: 0 });
  });

  test("a client with no sites has no entry; callers fall back to emptyClientStats", () => {
    const stats = summarizeClients({ projects, plants, tasks, photos: [] });
    expect(stats.get("c9")).toBeUndefined();
    expect(emptyClientStats).toEqual({
      sites: 0,
      plants: 0,
      hoursThisMonth: 0,
    });
  });

  test("hours are the durations of jobs proven with a photo", () => {
    const stats = summarizeClients({
      projects,
      plants,
      tasks,
      photos: [
        { taskId: "t1", takenAt: "2026-09-10T07:00:00Z" },
        { taskId: "t2", takenAt: "2026-09-11T07:00:00Z" },
        { taskId: "t3", takenAt: "2026-09-12T07:00:00Z" },
      ],
    });
    expect(stats.get("c1")?.hoursThisMonth).toBe(3.5);
    expect(stats.get("c2")?.hoursThisMonth).toBe(3);
  });

  test("several photos of the same job on the same day count once", () => {
    const stats = summarizeClients({
      projects,
      plants,
      tasks,
      photos: [
        { taskId: "t1", takenAt: "2026-09-10T07:00:00Z" },
        { taskId: "t1", takenAt: "2026-09-10T09:30:00Z" },
        { taskId: "t1", takenAt: "2026-09-17T07:00:00Z" }, // a week later: a second visit
      ],
    });
    expect(stats.get("c1")?.hoursThisMonth).toBe(4);
  });

  test("a photo whose task is gone is ignored", () => {
    const stats = summarizeClients({
      projects,
      plants,
      tasks,
      photos: [{ taskId: "gone", takenAt: "2026-09-10T07:00:00Z" }],
    });
    expect(stats.get("c1")?.hoursThisMonth).toBe(0);
  });
});
