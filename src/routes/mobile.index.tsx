import { createFileRoute } from "@tanstack/react-router";
import {
  Camera,
  Check,
  CloudRain,
  CloudSun,
  MapPin,
  RotateCcw,
  Sun,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { setCaptureHandler } from "@/lib/photo-store";
import { weekDays } from "@/lib/labels";
import type { Task } from "@/lib/types";
import { useTaskActions } from "@/hooks/use-tasks";
import { formatDate, useWeekPlan } from "@/hooks/use-week-plan";
import { taskDateIn } from "@/lib/task-schedule";
import { useCurrentWorker, useViewer } from "@/hooks/use-viewer";

export const Route = createFileRoute("/mobile/")({
  component: WorkerDay,
});

const weatherIcon = { rain: CloudRain, cloud: CloudSun, sun: Sun } as const;

function hour(t: Task) {
  return `${String(t.start).padStart(2, "0")}:00`;
}

function WorkerDay() {
  const taskActions = useTaskActions();
  // Same live week as the dashboard: real dates, live forecast, weather rules applied.
  const week = useWeekPlan();
  const tasks = week.adjusted;
  const { weekDates, weather } = week;
  const [day, setDay] = useState(week.today);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingTask = useRef<string | null>(null);

  const worker = useCurrentWorker();
  // Only a boss reopens a finished one-off job (the database refuses a worker). A weekly job is
  // done by this week's photo, which reopening wouldn't undo, so it has no reopen button.
  const isBoss = useViewer()?.member?.role === "boss";
  const canReopen = (t: Task) => isBoss && Boolean(t.date);
  const today = week.strip[day];
  const Icon = weatherIcon[today?.icon ?? "cloud"];

  const myJobs = tasks
    .filter(
      (t) =>
        taskDateIn(t, weekDates) === (weekDates[day] ?? "") &&
        t.workerId === worker?.id,
    )
    .sort((a, b) => a.start - b.start);
  const nextJob = myJobs.find((t) => t.status !== "done");
  const doneCount = myJobs.filter((t) => t.status === "done").length;

  function openCamera(taskId: string) {
    pendingTask.current = taskId;
    fileRef.current?.click();
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const id = pendingTask.current;
    pendingTask.current = null;
    if (!file || !id) return;

    // The photo is the proof, so the job is only done once it is actually stored. Uploading
    // first and marking done second means a failed upload leaves the job open rather than
    // claiming work that has no evidence behind it.
    const pending = toast.loading("Uploading photo…");
    try {
      await taskActions.completeWithPhoto(id, file);
      toast.success("Photo saved — job marked done", { id: pending });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Couldn't save the photo — job left open",
        { id: pending },
      );
    }
  }

  // The floating camera button in the tab bar photographs the next open job.
  useEffect(() => {
    setCaptureHandler(() => {
      // "All jobs done" with an empty list reads as a success and hides the real reason the
      // camera never opens — that nothing is scheduled. Say which it is.
      if (!myJobs.length) {
        toast.info(
          `No jobs scheduled for ${weekDays[day]} — nothing to photograph.`,
        );
        return;
      }
      if (!nextJob) {
        toast.success("All jobs done for today — nice work!");
        return;
      }
      openCamera(nextJob.id);
    });
    return () => setCaptureHandler(null);
  });

  return (
    <div className="space-y-6">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPhoto}
      />

      <div>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-accent-foreground">
          Your workday
        </p>
        <h1 className="font-display text-3xl font-bold text-primary">
          Tere, {worker?.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm font-medium text-muted-foreground">
          {weekDays[day]} {formatDate(weekDates[day] ?? "")} · {doneCount}/
          {myJobs.length} jobs done
        </p>
      </div>

      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
        {weekDays.map((d, i) => (
          <Button
            key={d}
            type="button"
            variant="outline"
            onClick={() => setDay(i)}
            className={`h-auto min-w-14 flex-col rounded-lg px-3 py-2 text-xs shadow-none ${
              i === day
                ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                : "bg-card"
            }`}
          >
            <span className="font-medium">{d}</span>
            <span
              className={
                i === day
                  ? "text-[11px] text-primary-foreground/70"
                  : "text-[11px] text-muted-foreground"
              }
            >
              {Number(weekDates[i]?.slice(8, 10))}
            </span>
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-accent/25 bg-accent/10 p-3.5">
        <Icon className="size-5 text-accent-foreground" />
        <div className="min-w-0 text-sm">
          {weather.isPending ? (
            <p className="text-muted-foreground">Loading forecast…</p>
          ) : weather.isError ? (
            <p className="text-muted-foreground">Weather unavailable</p>
          ) : (
            <>
              <p className="font-medium">
                {today?.temp == null ? "No forecast" : `${today.temp}°C`}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {today?.note}
              </p>
            </>
          )}
        </div>
      </div>

      {myJobs.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          No jobs for {weekDays[day]} — free day.
        </p>
      ) : (
        <div className="space-y-3">
          {myJobs.map((t) => {
            const done = t.status === "done";
            return (
              <article
                key={t.id}
                className={`rounded-lg border bg-card p-4 shadow-card ${done ? "opacity-70" : ""}`}
                style={{ borderLeft: `3px solid ${worker?.color}` }}
              >
                <div className="flex items-start gap-2">
                  <span className="text-sm font-medium tabular-nums text-muted-foreground">
                    {hour(t)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{t.title}</p>
                    <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      <MapPin className="size-3 shrink-0" />
                      {t.client} · {t.site}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {t.duration} h
                  </span>
                </div>

                {t.weatherNote ? (
                  <p className="mt-2 rounded-md bg-status-attention/10 px-2 py-1 text-[11px] text-status-attention">
                    {t.weatherNote}
                  </p>
                ) : null}

                {done ? (
                  <div className="mt-3 flex items-center gap-2">
                    <span className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-status-healthy/10 py-3 text-sm font-semibold text-status-healthy">
                      <Check className="size-4" /> Done · photo saved
                    </span>
                    {canReopen(t) ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() =>
                          taskActions.update(t.id, { status: "planned" })
                        }
                        className="size-11 text-muted-foreground shadow-none"
                        aria-label="Mark as not done"
                      >
                        <RotateCcw className="size-4" />
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      type="button"
                      onClick={() => openCamera(t.id)}
                      className="h-12 flex-1"
                    >
                      <Camera className="size-5" />
                      Take photo & finish
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        taskActions.update(t.id, {
                          status:
                            t.status === "skipped" ? "planned" : "skipped",
                        });
                      }}
                      className={`size-12 shadow-none ${
                        t.status === "skipped"
                          ? "border-primary text-primary"
                          : "text-muted-foreground"
                      }`}
                      aria-label="Skip job"
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
