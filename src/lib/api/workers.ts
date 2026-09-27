import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";

import type { Worker } from "../types";
import { toWorker } from "./mappers";
import { getAuthedClient, requireBoss } from "./session";

const Language = z.enum(["ET", "LV", "EN"]);

/**
 * Everyone in the company, archived people left out. For a boss, each login also says whether
 * it has been confirmed (`joinedAt`); `worker_logins` returns nothing to anyone else.
 */
export const listWorkers = createServerFn({ method: "GET" }).handler(
  async (): Promise<Worker[]> => {
    const db = await getAuthedClient();
    const [workers, logins] = await Promise.all([
      db.from("workers").select("*").is("archived_at", null).order("name"),
      db.rpc("worker_logins"),
    ]);
    if (workers.error) throw new Error(workers.error.message);
    if (logins.error) throw new Error(logins.error.message);
    const joinedAt = new Map(
      (logins.data ?? []).flatMap((l) =>
        l.confirmed_at ? [[l.worker_id, l.confirmed_at] as const] : [],
      ),
    );
    return (workers.data ?? []).map((row) => {
      const worker = toWorker(row);
      const joined = joinedAt.get(row.id);
      return joined ? { ...worker, joinedAt: joined } : worker;
    });
  },
);

/** Worker colours come from the theme's chart palette, so they work in light and dark mode. */
const PALETTE = [1, 2, 3, 4, 5].map((n) => `var(--chart-${n})`);

/**
 * A palette colour or a plain hex one. The colour is written into inline styles, so nothing
 * else (a `url(...)`, say) may get in.
 */
export const WorkerColor = z
  .string()
  .regex(/^(var\(--chart-[1-5]\)|#[0-9a-fA-F]{6})$/, "Pick a colour");

/**
 * The address an invitation goes to, stored lowercased. "" means none. Once the worker has a
 * login it can't change: it is their login (the database refuses).
 */
const WorkerEmail = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z.union([
      z.literal(""),
      z.email("That email address doesn't look right").max(320),
    ]),
  );

export const WorkerInput = z.object({
  /** omit to add a new worker */
  id: z.uuid().optional(),
  email: WorkerEmail.optional(),
  name: z.string().trim().min(1, "Name is required").max(200),
  /** job title, e.g. "Head gardener" */
  role: z.string().trim().min(1, "Role is required").max(100),
  language: Language,
  color: WorkerColor.optional(),
});
export type WorkerInput = z.infer<typeof WorkerInput>;

/** Add or update a worker (boss only). A new worker gets the least-used palette colour. */
export const saveWorker = createServerFn({ method: "POST" })
  .validator(WorkerInput)
  .handler(async ({ data }): Promise<{ id: string }> => {
    const db = await requireBoss();
    const row = {
      name: data.name,
      job_title: data.role,
      language: data.language,
      ...(data.email !== undefined ? { email: data.email || null } : {}),
    };
    if (data.id) {
      const { error } = await db
        .from("workers")
        .update(data.color ? { ...row, color: data.color } : row)
        .eq("id", data.id);
      if (error) throw new Error(saveError(error));
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
    if (error) throw new Error(saveError(error));
    return { id: created.id };
  });

/** Emails are unique within a company (`workers_company_email_key`). */
function saveError(error: { code?: string; message: string }): string {
  return error.code === "23505"
    ? "Another worker in your company already has this email"
    : error.message;
}

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
