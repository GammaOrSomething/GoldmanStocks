import { describe, expect, test } from "bun:test";

import type { Task } from "../types";
import {
  NewTaskInput,
  TaskPatch,
  patchToRow,
  taskToRow,
  weekdayFromDate,
} from "./task-rows";

const SITE = "11111111-1111-4111-8111-111111111111";
const WORKER = "22222222-2222-4222-8222-222222222222";
const PLANT = "33333333-3333-4333-8333-333333333333";
const TASK = "44444444-4444-4444-8444-444444444444";

const task: Task = {
  id: TASK,
  title: "Water the linden",
  projectId: SITE,
  client: "Harbour Offices",
  site: "North courtyard",
  plantId: PLANT,
  workerId: WORKER,
  day: 0,
  start: 8,
  duration: 1.5,
  kind: "Watering",
  status: "planned",
};

describe("weekdayFromDate", () => {
  test("Monday is 0 and Sunday is 6", () => {
    expect(weekdayFromDate("2026-09-21")).toBe(0);
    expect(weekdayFromDate("2026-09-27")).toBe(6);
  });
});

describe("patchToRow", () => {
  test("maps the app's names to the database's: site is zone", () => {
    expect(patchToRow({ site: "Roof", workerId: WORKER })).toEqual({
      row: { zone: "Roof", worker_id: WORKER },
    });
  });

  test("a date keeps the weekday in step", () => {
    expect(patchToRow({ date: "2026-09-23", day: 0 })).toEqual({
      row: { date: "2026-09-23", day: 2 },
    });
  });

  test("clearing optional fields writes null", () => {
    expect(
      patchToRow({ plantId: undefined, weatherNote: "", date: null }).row,
    ).toEqual({ weather_note: null, date: null });
  });

  test("skipping or reopening goes through set_task_status, not the row", () => {
    expect(patchToRow({ status: "skipped", start: 9 })).toEqual({
      row: { start: 9 },
      status: "skipped",
    });
    expect(patchToRow({ status: "planned" })).toEqual({
      row: {},
      status: "planned",
    });
  });

  test("marking done without a photo is a direct (boss-only) write", () => {
    expect(patchToRow({ status: "done" })).toEqual({
      row: { status: "done" },
    });
  });
});

describe("taskToRow", () => {
  test("a weekly template has no date", () => {
    expect(taskToRow(task)).toEqual({
      title: "Water the linden",
      project_id: SITE,
      zone: "North courtyard",
      plant_id: PLANT,
      worker_id: WORKER,
      day: 0,
      date: null,
      start: 8,
      duration: 1.5,
      kind: "Watering",
      weather_note: null,
      status: "planned",
      approved_at: null,
    });
  });

  test("a one-off task's weekday follows its date", () => {
    expect(taskToRow({ ...task, day: 4, date: "2026-09-23" })).toMatchObject({
      day: 2,
      date: "2026-09-23",
    });
  });
});

describe("validation", () => {
  test("a new task needs real ids and sensible hours", () => {
    const { id: _id, ...fields } = task;
    expect(NewTaskInput.safeParse(fields).success).toBe(true);
    expect(NewTaskInput.safeParse({ ...fields, projectId: "p1" }).success).toBe(
      false,
    );
    expect(NewTaskInput.safeParse({ ...fields, start: 24 }).success).toBe(
      false,
    );
    expect(NewTaskInput.safeParse({ ...fields, duration: 0 }).success).toBe(
      false,
    );
  });

  test("a patch refuses unknown statuses and bad dates", () => {
    expect(TaskPatch.safeParse({ status: "lost" }).success).toBe(false);
    expect(TaskPatch.safeParse({ date: "23.09.2026" }).success).toBe(false);
    expect(TaskPatch.safeParse({ date: null }).success).toBe(true);
  });
});
