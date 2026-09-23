import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";

import type { Worker } from "../types";
import { toWorker } from "./mappers";
import { getAuthedClient } from "./session";

const Language = z.enum(["ET", "LV", "EN"]);

/** Everyone in the company, archived people left out. */
export const listWorkers = createServerFn({ method: "GET" }).handler(
  async (): Promise<Worker[]> => {
    const { data, error } = await (
      await getAuthedClient()
    )
      .from("workers")
      .select("*")
      .is("archived_at", null)
      .order("name");
    if (error) throw new Error(error.message);
    return (data ?? []).map(toWorker);
  },
);

/** Worker colours come from the theme's chart palette, so they work in light and dark mode. */
const PALETTE = [1, 2, 3, 4, 5].map((n) => `var(--chart-${n})`);

export const WorkerInput = z.object({
  /** omit to add a new worker */
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Name is required").max(200),
  /** job title, e.g. "Head gardener" */
  role: z.string().trim().min(1, "Role is required").max(100),
  language: Language,
  color: z.string().max(32).optional(),
});
export type WorkerInput = z.infer<typeof WorkerInput>;

/** Add or update a worker (boss only). A new worker gets the least-used palette colour. */
export const saveWorker = createServerFn({ method: "POST" })
  .validator(WorkerInput)
  .handler(async ({ data }): Promise<{ id: string }> => {
    const db = await getAuthedClient();
    const row = {
      name: data.name,
      job_title: data.role,
      language: data.language,
    };
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

    const { data: created, error } = await db
      .from("workers")
      .insert({ ...row, color })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: created.id };
  });

/** The signed-in person changes the language they speak; the only edit a worker makes. */
export const updateMyLanguage = createServerFn({ method: "POST" })
  .validator(Language)
  .handler(async ({ data: language }) => {
    const { error } = await (
      await getAuthedClient()
    ).rpc("update_my_profile", { p_language: language });
    if (error) throw new Error(error.message);
    return { language };
  });
