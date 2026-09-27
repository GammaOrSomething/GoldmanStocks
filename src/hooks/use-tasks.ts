import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "sonner";

import {
  addTask,
  listTasks,
  removeTask,
  replaceTasks,
  updateTask,
  type TaskPatch,
} from "@/lib/api/tasks";
import { getPref } from "@/lib/phone-prefs";
import { PHOTO_TYPE_ERROR, photoType } from "@/lib/photo-types";
import { completeTask, createPhotoUploadUrl } from "@/lib/photos.functions";
import { supabase } from "@/lib/supabase/client";
import type { Task } from "@/lib/types";

/** Best-effort GPS. Proof is still worth recording without it, so never block on a refusal. */
async function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 5000, maximumAge: 60_000 },
    );
  });
}

const TASKS_KEY = ["tasks"] as const;

/**
 * The week's tasks, from the database.
 *
 * Replaces the in-memory store that used to live in src/lib/task-store.ts, where every edit was
 * lost on reload — which showed up as the boss's approved plan quietly resetting itself.
 */
export function useTasks(): Task[] {
  const { data } = useQuery({
    queryKey: TASKS_KEY,
    queryFn: () => listTasks(),
  });
  return data ?? [];
}

/**
 * Task mutations, mirroring the old `taskActions` object so call sites only had to move from a
 * module import to a hook call. Each one refetches the list, so every view stays in step.
 */
export function useTaskActions() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: TASKS_KEY });
  };
  // These run fire-and-forget, so a refusal (a worker reopening a finished job, say) would
  // otherwise vanish without a word.
  const onError = (error: Error) => toast.error(error.message);

  const update = useMutation({
    mutationFn: (input: { id: string; patch: TaskPatch }) =>
      updateTask({ data: input }),
    onSuccess: invalidate,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeTask({ data: id }),
    onSuccess: invalidate,
    onError,
  });
  const add = useMutation({
    mutationFn: (task: Omit<Task, "id">) => addTask({ data: task }),
    onSuccess: invalidate,
    onError,
  });
  const replace = useMutation({
    mutationFn: (tasks: Task[]) => replaceTasks({ data: tasks }),
    onSuccess: invalidate,
    onError,
  });

  /**
   * Finish a task with photo proof — B5's three steps: ask for a signed upload URL, send the
   * photo straight from the phone to storage, then record it and flip the task to done.
   *
   * The upload deliberately goes browser → storage rather than through a server function, so a
   * multi-megabyte photo never travels through the app server.
   */
  const completeWithPhoto = useMutation({
    mutationFn: async ({ taskId, file }: { taskId: string; file: File }) => {
      const contentType = photoType(file);
      if (!contentType) throw new Error(PHOTO_TYPE_ERROR);
      const upload = await createPhotoUploadUrl({
        data: { taskId, contentType },
      });
      const { error } = await supabase.storage
        .from(upload.bucket)
        .uploadToSignedUrl(upload.path, upload.token, file);
      if (error) throw error;

      // "Stamp photos with location" in the worker app's settings
      const where = getPref("geotag") ? await currentPosition() : null;
      return completeTask({
        data: {
          taskId,
          photoPath: upload.path,
          takenAt: new Date().toISOString(),
          lat: where?.lat ?? null,
          lng: where?.lng ?? null,
        },
      });
    },
    onSuccess: invalidate,
  });

  return useMemo(
    () => ({
      update: (id: string, patch: TaskPatch) => update.mutate({ id, patch }),
      completeWithPhoto: (taskId: string, file: File) =>
        completeWithPhoto.mutateAsync({ taskId, file }),
      remove: (id: string) => remove.mutate(id),
      add: (task: Omit<Task, "id">) => add.mutate(task),
      replace: (tasks: Task[]) => replace.mutate(tasks),
    }),
    [update, remove, add, replace, completeWithPhoto],
  );
}
