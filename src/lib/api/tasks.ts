import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";

import type { Task } from "../types";
import { clientNameByProject } from "./lookups";
import { toTask } from "./mappers";
import { getAuthedClient, requireBoss } from "./session";
import {
  NewTaskInput,
  TaskInput,
  TaskPatch,
  patchToRow,
  taskToRow,
} from "./task-rows";

export type { TaskPatch } from "./task-rows";

/** Every task in the plan. */
export const listTasks = createServerFn({ method: "GET" }).handler(
  async (): Promise<Task[]> => {
    const [{ data, error }, clientByProject] = await Promise.all([
      (await getAuthedClient())
        .from("tasks")
        .select("*")
        .order("day")
        .order("start")
        .order("title"),
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
    if (!z.uuid().safeParse(projectId).success) return [];
    const [{ data, error }, clientByProject] = await Promise.all([
      (await getAuthedClient())
        .from("tasks")
        .select("*")
        .eq("project_id", projectId)
        .order("day")
        .order("start")
        .order("title"),
      clientNameByProject(),
    ]);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) =>
      toTask(row, clientByProject.get(row.project_id) ?? ""),
    );
  });

// --- mutations -------------------------------------------------------------------------
// These back `useTaskActions()` in src/hooks/use-tasks.ts. Call them through that hook rather
// than directly, so the cached task list is refetched and every open view stays in step.
//
// Only a boss writes `tasks` directly (requireBoss, and row-level security behind it). An
// update that matches no rows means the task is gone, so it asks for the rows back.

/**
 * Change some fields of a task. Skipping or reopening goes through `set_task_status`, which a
 * worker may call for their own task; everything else is the boss's.
 */
export const updateTask = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.uuid(), patch: TaskPatch }))
  .handler(async ({ data: { id, patch } }) => {
    const { row, status } = patchToRow(patch);
    const hasRow = Object.keys(row).length > 0;
    const db = hasRow ? await requireBoss() : await getAuthedClient();
    if (status) {
      const { error } = await db.rpc("set_task_status", {
        p_task_id: id,
        p_status: status,
      });
      if (error) throw new Error(error.message);
    }
    if (hasRow) {
      const { data, error } = await db
        .from("tasks")
        .update(row)
        .eq("id", id)
        .select("id");
      if (error) throw new Error(error.message);
      if (!data?.length) throw new Error("Task not found");
    }
    return { id };
  });

/**
 * Write a whole set of existing tasks at once: what "approve today's plan" and re-planning do.
 * One upsert rather than a request per task, so a twelve-task plan is a single round trip and
 * cannot half-apply.
 */
export const replaceTasks = createServerFn({ method: "POST" })
  .validator(z.array(TaskInput).max(500))
  .handler(async ({ data: tasks }) => {
    if (tasks.length === 0) return { count: 0 };
    const { error } = await (
      await requireBoss()
    )
      .from("tasks")
      .upsert(tasks.map((task) => ({ ...taskToRow(task), id: task.id })));
    if (error) throw new Error(error.message);
    return { count: tasks.length };
  });

export const removeTask = createServerFn({ method: "POST" })
  .validator(z.uuid())
  .handler(async ({ data: id }) => {
    const { error } = await (
      await requireBoss()
    )
      .from("tasks")
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { id };
  });

export const addTask = createServerFn({ method: "POST" })
  .validator(NewTaskInput)
  .handler(async ({ data: task }) => {
    const { data, error } = await (
      await requireBoss()
    )
      .from("tasks")
      .insert(taskToRow(task))
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: data.id };
  });
