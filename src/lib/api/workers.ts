import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";

import type { Worker } from "../types";
import { toWorker } from "./mappers";
import { companyId, nextId } from "./ids";
import { getAuthedClient } from "./session";

/** Every worker in the company. */
export const listWorkers = createServerFn({ method: "GET" }).handler(
  async (): Promise<Worker[]> => {
    const { data, error } = await (
      await getAuthedClient()
    )
      .from("workers")
      .select("*")
      .order("id");
    if (error) throw new Error(error.message);
    return (data ?? []).map(toWorker);
  },
);

/** Worker colours come from the theme's chart palette, so they work in light and dark mode. */
const PALETTE = [1, 2, 3, 4, 5].map((n) => `var(--chart-${n})`);

export const WorkerInput = z.object({
  /** omit to add a new worker */
  id: z.string().optional(),
  name: z.string().trim().min(1, "Name is required"),
  role: z.string().trim().min(1, "Role is required"),
  language: z.enum(["ET", "LV", "EN"]),
  color: z.string().optional(),
});
export type WorkerInput = z.infer<typeof WorkerInput>;

/** Add or update a worker. A new worker gets the least-used palette colour. */
export const saveWorker = createServerFn({ method: "POST" })
  .validator(WorkerInput)
  .handler(async ({ data }): Promise<{ id: string }> => {
    const db = await getAuthedClient();
    const row = { name: data.name, role: data.role, language: data.language };
    if (data.id) {
      const { error } = await db
        .from("workers")
        .update(data.color ? { ...row, color: data.color } : row)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }

    const { data: existing, error: listError } = await db
      .from("workers")
      .select("color");
    if (listError) throw new Error(listError.message);
    const uses = (c: string) =>
      (existing ?? []).filter((w) => w.color === c).length;
    const color =
      data.color ?? [...PALETTE].sort((a, b) => uses(a) - uses(b))[0]!;

    const id = await nextId(db, "workers", "w");
    const { error } = await db
      .from("workers")
      .insert({ ...row, id, color, company_id: await companyId(db) });
    if (error) throw new Error(error.message);
    return { id };
  });
