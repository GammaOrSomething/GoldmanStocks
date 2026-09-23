import { createServerFn } from "@tanstack/react-start";

import type { Task } from "../types";
import { clientNameByProject } from "./lookups";
import { toTask } from "./mappers";
import { getAuthedClient } from "./session";

/** Every task in the plan. */
export const listTasks = createServerFn({ method: "GET" }).handler(
  async (): Promise<Task[]> => {
    const [{ data, error }, clientByProject] = await Promise.all([
      (await getAuthedClient())
        .from("tasks")
        .select("*")
        .order("day")
        .order("start"),
      clientNameByProject(),
    ]);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) =>
      toTask(row, clientByProject.get(row.project_id) ?? ""),
    );
  },
);

/** The tasks at one site. */
export const projectTasks = createServerFn({ method: "GET" })
  .validator((projectId: string) => projectId)
  .handler(async ({ data: projectId }): Promise<Task[]> => {
    const [{ data, error }, clientByProject] = await Promise.all([
      (await getAuthedClient())
        .from("tasks")
        .select("*")
        .eq("project_id", projectId)
        .order("day")
        .order("start"),
      clientNameByProject(),
    ]);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) =>
      toTask(row, clientByProject.get(row.project_id) ?? ""),
    );
  });

// --- mutations -------------------------------------------------------------------------
// These back `useTaskActions()` in src/hooks/use-tasks.ts, which replaced the in-memory
// src/lib/task-store.ts. Call them through that hook rather than directly, so the cached
// task list is refetched and every open view stays in step.

export type TaskPatch = Partial<
  Pick<
    Task,
    | "title"
    | "workerId"
    | "day"
    | "date"
    | "start"
    | "duration"
    | "status"
    | "site"
    | "kind"
    | "weatherNote"
    | "plantId"
    | "approvedAt"
  >
>;

/** PostgREST's answer when a column doesn't exist — i.e. migration 0004 isn't applied yet. */
function isMissingColumn(error: { code?: string; message: string }) {
  return (
    error.code === "PGRST204" || /column .* does not exist/i.test(error.message)
  );
}

/** Monday = 0, matching `Task.day`. Noon avoids any timezone shifting the day. */
export function weekdayFromDate(date: string) {
  return (new Date(`${date}T12:00:00`).getDay() + 6) % 7;
}

/** Drops `date` so a write still lands on a database without migration 0004. */
function withoutDate<T extends { date?: unknown }>(row: T) {
  const { date: _date, ...rest } = row;
  return rest;
}

/** TaskPatch -> column names, in one place so update and replace can't drift apart. */
function toRow(patch: TaskPatch) {
  return {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.workerId !== undefined ? { worker_id: patch.workerId } : {}),
    // A dated task keeps `day` in step, so the day/week views and the worker app — which read
    // `day`, not `date` — still place it on the right weekday.
    ...(patch.date !== undefined
      ? { date: patch.date, day: weekdayFromDate(patch.date) }
      : {}),
    ...(patch.day !== undefined && patch.date === undefined
      ? { day: patch.day }
      : {}),
    ...(patch.start !== undefined ? { start: patch.start } : {}),
    ...(patch.duration !== undefined ? { duration: patch.duration } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.site !== undefined ? { site: patch.site } : {}),
    ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
    ...(patch.weatherNote !== undefined
      ? { weather_note: patch.weatherNote }
      : {}),
    ...(patch.plantId !== undefined ? { plant_id: patch.plantId } : {}),
    ...(patch.approvedAt !== undefined
      ? { approved_at: patch.approvedAt }
      : {}),
  };
}

export const updateTask = createServerFn({ method: "POST" })
  .validator((input: { id: string; patch: TaskPatch }) => input)
  .handler(async ({ data: { id, patch } }) => {
    const db = await getAuthedClient();
    const row = toRow(patch);
    const { error } = await db.from("tasks").update(row).eq("id", id);
    if (error && isMissingColumn(error) && "date" in row) {
      // Migration 0004 isn't applied — save everything but the date.
      const { error: retry } = await db
        .from("tasks")
        .update(withoutDate(row))
        .eq("id", id);
      if (retry) throw new Error(retry.message);
      return { id };
    }
    if (error) throw new Error(error.message);
    return { id };
  });

/**
 * Write a whole set of tasks at once — what "approve today's plan" and the schedule's plan
 * generation do. One upsert rather than a request per task, so a twelve-task plan is a single
 * round trip and cannot half-apply.
 */
export const replaceTasks = createServerFn({ method: "POST" })
  .validator((tasks: Task[]) => tasks)
  .handler(async ({ data: tasks }) => {
    if (tasks.length === 0) return { count: 0 };
    const db = await getAuthedClient();
    const rows = tasks.map((task) => ({
      id: task.id,
      project_id: task.projectId,
      site: task.site,
      worker_id: task.workerId,
      title: task.title,
      day: task.date ? weekdayFromDate(task.date) : task.day,
      date: task.date ?? null,
      start: task.start,
      duration: task.duration,
      kind: task.kind,
      weather_note: task.weatherNote ?? null,
      status: task.status,
      plant_id: task.plantId ?? null,
      approved_at: task.approvedAt ?? null,
    }));
    const { error } = await db.from("tasks").upsert(rows);
    if (error && isMissingColumn(error)) {
      // Migration 0004 isn't applied — the weekly template still round-trips.
      const { error: retry } = await db
        .from("tasks")
        .upsert(rows.map(withoutDate));
      if (retry) throw new Error(retry.message);
      return { count: tasks.length };
    }
    if (error) throw new Error(error.message);
    return { count: tasks.length };
  });

export const removeTask = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const { error } = await (
      await getAuthedClient()
    )
      .from("tasks")
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { id };
  });

export const addTask = createServerFn({ method: "POST" })
  .validator((input: Omit<Task, "id">) => input)
  .handler(async ({ data: task }) => {
    const id = `t${Date.now()}`;
    const db = await getAuthedClient();
    const row = {
      id,
      title: task.title,
      project_id: task.projectId,
      site: task.site,
      worker_id: task.workerId,
      day: task.date ? weekdayFromDate(task.date) : task.day,
      date: task.date ?? null,
      start: task.start,
      duration: task.duration,
      kind: task.kind,
      weather_note: task.weatherNote ?? null,
      status: task.status,
      plant_id: task.plantId ?? null,
    };
    const { error } = await db.from("tasks").insert(row);
    if (error && isMissingColumn(error)) {
      // Migration 0004 isn't applied — the task is created as a weekly template.
      const { error: retry } = await db.from("tasks").insert(withoutDate(row));
      if (retry) throw new Error(retry.message);
      return { id };
    }
    if (error) throw new Error(error.message);
    return { id };
  });
