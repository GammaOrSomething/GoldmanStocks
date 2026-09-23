/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";
import {
  CompleteTaskInput,
  completeTask,
  photoFolder,
  PhotoUploadInput,
  uploadError,
} from "./photos";

// The storage and database rules are covered by the SQL security tests
// (supabase/tests/rls.sql); these cover validation that must hold before anything is sent.

/** A client that fails loudly if anything reaches the database. */
const untouchable = new Proxy(
  {},
  {
    get() {
      throw new Error("database should not be reached");
    },
  },
) as SupabaseClient<Database>;

const COMPANY = "0b4f3d2e-8a41-4c1e-9d1f-2f6a1c9e7b10";
const TASK = "7c1d9e2a-3b4f-4a5e-8c6d-1e2f3a4b5c6d";
const OTHER_TASK = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";

const valid = {
  taskId: TASK,
  photoPath: `${COMPANY}/tasks/${TASK}/abc.jpg`,
  takenAt: "2026-09-21T08:15:00+03:00",
  lat: 59.42,
  lng: 24.8,
};

describe("input validation", () => {
  test("only image types the bucket accepts", () => {
    expect(
      PhotoUploadInput.safeParse({ taskId: TASK, contentType: "image/jpeg" })
        .success,
    ).toBe(true);
    expect(
      PhotoUploadInput.safeParse({ taskId: TASK, contentType: "text/html" })
        .success,
    ).toBe(false);
  });

  test("a task id must be a uuid", () => {
    expect(
      PhotoUploadInput.safeParse({ taskId: "t1", contentType: "image/jpeg" })
        .success,
    ).toBe(false);
    expect(
      CompleteTaskInput.safeParse({ ...valid, taskId: "t1" }).success,
    ).toBe(false);
  });

  test("timestamps need an offset; GPS must be on the globe or null", () => {
    expect(CompleteTaskInput.safeParse(valid).success).toBe(true);
    expect(
      CompleteTaskInput.safeParse({ ...valid, lat: null, lng: null }).success,
    ).toBe(true);
    expect(
      CompleteTaskInput.safeParse({ ...valid, takenAt: "yesterday" }).success,
    ).toBe(false);
    expect(CompleteTaskInput.safeParse({ ...valid, lat: 123 }).success).toBe(
      false,
    );
  });
});

describe("completeTask", () => {
  test("a photo uploaded for another task is refused before any DB call", async () => {
    await expect(
      completeTask(untouchable, COMPANY, {
        ...valid,
        photoPath: `${COMPANY}/tasks/${OTHER_TASK}/abc.jpg`,
      }),
    ).rejects.toThrow("not uploaded for this task");
  });

  test("a photo in another company's folder is refused before any DB call", async () => {
    const otherCompany = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
    await expect(
      completeTask(untouchable, COMPANY, {
        ...valid,
        photoPath: `${otherCompany}/tasks/${TASK}/abc.jpg`,
      }),
    ).rejects.toThrow("not uploaded for this task");
  });

  test("the folder is the company, then the task", () => {
    expect(photoFolder(COMPANY, TASK)).toBe(`${COMPANY}/tasks/${TASK}/`);
  });

  test("a valid photo goes to complete_task with the local work date", async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const row = {
      id: "p1",
      company_id: COMPANY,
      task_id: TASK,
      storage_path: valid.photoPath,
      taken_at: valid.takenAt,
      lat: valid.lat,
      lng: valid.lng,
      created_at: "2026-09-21T05:15:01Z",
    };
    const db = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return { data: row, error: null };
      },
    } as unknown as SupabaseClient<Database>;

    const photo = await completeTask(db, COMPANY, valid);
    expect(calls).toEqual([
      {
        fn: "complete_task",
        args: {
          p_task_id: TASK,
          p_photo_path: valid.photoPath,
          p_taken_at: valid.takenAt,
          p_lat: valid.lat,
          p_lng: valid.lng,
          p_local_date: "2026-09-21",
        },
      },
    ]);
    expect(photo).toEqual({
      id: "p1",
      taskId: TASK,
      storagePath: valid.photoPath,
      takenAt: valid.takenAt,
      lat: valid.lat,
      lng: valid.lng,
      createdAt: "2026-09-21T05:15:01Z",
    });
  });

  test("the database's refusal reaches the caller", async () => {
    const db = {
      rpc: async () => ({
        data: null,
        error: { message: "the photo must have been taken today" },
      }),
    } as unknown as SupabaseClient<Database>;
    await expect(completeTask(db, COMPANY, valid)).rejects.toThrow(
      "the photo must have been taken today",
    );
  });
});

describe("uploadError", () => {
  test("a refusal by the storage policy says so", () => {
    const refused = Object.assign(
      new Error("new row violates row-level security policy"),
      { status: 400, statusCode: "403" },
    );
    expect(uploadError(refused).message).toBe(
      "You can't add a photo to this task",
    );
  });

  test("storage trouble is not reported as a refusal", () => {
    const outage = Object.assign(new Error("Internal Server Error"), {
      status: 500,
      statusCode: "500",
    });
    const error = uploadError(outage);
    expect(error.message).toBe("Couldn't prepare the upload. Try again");
    expect(error.cause).toBe(outage);
  });
});
