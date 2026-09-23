import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";

import { getAuthedClient } from "./session";

export type CareEntry = {
  date: string; // YYYY-MM-DD
  action: string;
  workerName: string | null;
  done: boolean;
  /** the job behind this entry was finished with photo proof */
  photo: boolean;
};

/** A plant's care history and plan, from `care_events` (replaces the generated mock calendar). */
export const plantCareEvents = createServerFn({ method: "GET" })
  .validator(z.string().min(1))
  .handler(async ({ data: plantId }): Promise<CareEntry[]> => {
    if (!z.uuid().safeParse(plantId).success) return [];
    const db = await getAuthedClient();
    const [events, workers] = await Promise.all([
      db
        .from("care_events")
        .select("date, action, done, worker_id, task_id")
        .eq("plant_id", plantId)
        .order("date"),
      db.from("workers").select("id, name"),
    ]);
    if (events.error) throw new Error(events.error.message);
    if (workers.error) throw new Error(workers.error.message);

    const taskIds = (events.data ?? []).flatMap((e) =>
      e.task_id ? [e.task_id] : [],
    );
    const photos = taskIds.length
      ? await db.from("task_photos").select("task_id").in("task_id", taskIds)
      : { data: [], error: null };
    if (photos.error) throw new Error(photos.error.message);

    const nameById = new Map((workers.data ?? []).map((w) => [w.id, w.name]));
    const proven = new Set((photos.data ?? []).map((p) => p.task_id));
    return (events.data ?? []).map((e) => ({
      date: e.date,
      action: e.action,
      workerName: e.worker_id ? (nameById.get(e.worker_id) ?? null) : null,
      done: e.done,
      photo: e.task_id ? proven.has(e.task_id) : false,
    }));
  });
