/**
 * Tasks as the app sends them -> rows for the `tasks` table, and the validators for both.
 * Kept apart from the server functions in ./tasks so the mapping can be tested on its own.
 */
import { z } from "zod/v4";

import type { Database } from "../supabase/types";

type TaskRow = Database["public"]["Tables"]["tasks"]["Insert"];
type TaskUpdate = Database["public"]["Tables"]["tasks"]["Update"];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Status = z.enum(["planned", "done", "skipped"]);

const fields = {
  title: z.string().trim().min(1).max(200),
  projectId: z.uuid(),
  site: z.string().max(200),
  plantId: z.uuid().optional(),
  workerId: z.uuid(),
  day: z.number().int().min(0).max(6),
  start: z.number().int().min(0).max(23),
  duration: z.number().gt(0).max(24),
  kind: z.enum([
    "Watering",
    "Clipping",
    "Mowing",
    "Planting",
    "Inspection",
    "Feeding",
  ]),
  weatherNote: z.string().max(1000).optional(),
  status: Status,
  approvedAt: z.iso.datetime({ offset: true }).optional(),
};

/** A task to add. `client` is display-only and ignored. */
export const NewTaskInput = z.object({
  ...fields,
  date: isoDate.optional(),
  client: z.string().optional(),
});
/** What taskToRow needs; a `Task` fits. */
export type NewTask = z.infer<typeof NewTaskInput>;

/** A whole task, as "approve the plan" and re-planning write them back. */
export const TaskInput = NewTaskInput.extend({ id: z.uuid() });

/** Some fields of a task. `date: null` turns a one-off back into a weekly template. */
export const TaskPatch = z
  .object({
    ...fields,
    date: isoDate.nullable(),
    plantId: z.uuid().nullable(),
  })
  .partial();
export type TaskPatch = z.infer<typeof TaskPatch>;

/** Monday = 0, matching `Task.day`. Noon avoids any timezone shifting the day. */
export function weekdayFromDate(date: string) {
  return (new Date(`${date}T12:00:00`).getDay() + 6) % 7;
}

/**
 * A patch as column updates, plus the status change to make through `set_task_status`.
 *
 * Skipping a job or putting it back to planned goes through that database function, which a
 * worker may call for their own task; a worker can't update `tasks` directly. "Done" normally
 * comes with photo proof (`complete_task`); setting it here is the boss's manual override.
 */
export function patchToRow(patch: TaskPatch): {
  row: TaskUpdate;
  status?: "planned" | "skipped";
} {
  const row: TaskUpdate = {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.workerId !== undefined ? { worker_id: patch.workerId } : {}),
    // A dated task keeps `day` in step, so the day and week views, which read `day`, still
    // place it on the right weekday.
    ...(patch.date !== undefined
      ? {
          date: patch.date,
          ...(patch.date ? { day: weekdayFromDate(patch.date) } : {}),
        }
      : {}),
    ...(patch.day !== undefined && !patch.date ? { day: patch.day } : {}),
    ...(patch.start !== undefined ? { start: patch.start } : {}),
    ...(patch.duration !== undefined ? { duration: patch.duration } : {}),
    ...(patch.status === "done" ? { status: "done" as const } : {}),
    ...(patch.site !== undefined ? { zone: patch.site } : {}),
    ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
    ...("weatherNote" in patch
      ? { weather_note: patch.weatherNote || null }
      : {}),
    ...(patch.plantId !== undefined ? { plant_id: patch.plantId } : {}),
    ...(patch.approvedAt !== undefined
      ? { approved_at: patch.approvedAt }
      : {}),
  };
  return patch.status && patch.status !== "done"
    ? { row, status: patch.status }
    : { row };
}

/** A whole task as a row. The database makes ids, so `id` is the caller's to add. */
export function taskToRow(task: NewTask): TaskRow {
  return {
    title: task.title,
    project_id: task.projectId,
    zone: task.site,
    plant_id: task.plantId ?? null,
    worker_id: task.workerId,
    day: task.date ? weekdayFromDate(task.date) : task.day,
    date: task.date ?? null,
    start: task.start,
    duration: task.duration,
    kind: task.kind,
    weather_note: task.weatherNote || null,
    status: task.status,
    approved_at: task.approvedAt ?? null,
  };
}
