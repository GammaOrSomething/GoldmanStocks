import { createFileRoute } from "@tanstack/react-router";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudRain,
  Plus,
  Sparkles,
  Sun,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate, useWeekPlan } from "@/hooks/use-week-plan";
import { useTaskActions } from "@/hooks/use-tasks";
import { useProjects, useWorkers } from "@/hooks/use-data";
import { weekDays } from "@/lib/labels";
import { inWeek, taskDateIn } from "@/lib/task-schedule";
import { cn } from "@/lib/utils";
import { localDate } from "@/lib/weather";
import type { Task } from "@/lib/types";

export const Route = createFileRoute("/schedule")({
  head: () => ({
    meta: [
      { title: "Crew schedule — Goldman Stocks" },
      {
        name: "description",
        content:
          "Review and edit the AI-generated day plan for every worker, then approve it for the worker app.",
      },
      { property: "og:title", content: "Crew schedule — Goldman Stocks" },
      {
        property: "og:description",
        content:
          "Weekly and daily crew calendars you can edit before approving.",
      },
    ],
  }),
  component: Schedule,
});

const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
const ROW = 56;
const START = 7;
const weatherIcon = { rain: CloudRain, cloud: Cloud, sun: Sun } as const;
const KINDS: Task["kind"][] = [
  "Watering",
  "Clipping",
  "Mowing",
  "Planting",
  "Inspection",
  "Feeding",
];

/** Colour per job type, so a month cell reads without opening anything. */
const taskTone: Record<Task["kind"], string> = {
  Watering: "border-data-cyan/40 bg-data-cyan/10",
  Clipping: "border-data-violet/40 bg-data-violet/10",
  Mowing: "border-data-lime/40 bg-data-lime/10",
  Planting: "border-data-gold/40 bg-data-gold/10",
  Inspection: "border-data-coral/40 bg-data-coral/10",
  Feeding: "border-border bg-muted",
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** Local YYYY-MM-DD — built from the parts, never via toISOString, which shifts by timezone. */
function toDateKey(year: number, month: number, date: number) {
  return `${year}-${pad(month + 1)}-${pad(date)}`;
}

function dateKeyOf(date: Date) {
  return toDateKey(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Monday = 0, matching `Task.day`. Noon keeps any timezone from shifting the day. */
function weekdayFromDate(date: string) {
  return (new Date(`${date}T12:00:00`).getDay() + 6) % 7;
}

/** The six-week Monday-first grid covering `month`, with the padding days either side. */
function monthCells(year: number, month: number) {
  const firstDay = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const previousDays = new Date(year, month, 0).getDate();

  return Array.from({ length: 42 }, (_, index) => {
    const date = index - firstDay + 1;
    if (date < 1) return new Date(year, month - 1, previousDays + date);
    if (date > days) return new Date(year, month + 1, date - days);
    return new Date(year, month, date);
  });
}

function Schedule() {
  const taskActions = useTaskActions();
  const week = useWeekPlan();
  const { weekDates, strip, weather, workers } = week;
  // tasks as the plan stands: stored tasks with the live weather rules applied
  const tasks = week.adjusted;
  /**
   * Everything the month grid can show: this week with the weather rules applied, plus tasks
   * dated in other weeks, which no forecast reaches.
   */
  const calendarTasks = useMemo(
    () => [...tasks, ...week.tasks.filter((t) => !inWeek(t, weekDates))],
    [tasks, week.tasks, weekDates],
  );
  const [view, setView] = useState<"day" | "week" | "month">("day");
  const [day, setDay] = useState(week.today);
  const [active, setActive] = useState<string | "all">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const todayKey = weekDates[week.today] ?? weekDates[0] ?? "";
  const [monthCursor, setMonthCursor] = useState(
    () => new Date(`${todayKey || localDate(week.now)}T12:00:00`),
  );
  const [selectedDate, setSelectedDate] = useState(todayKey);

  const taskDate = (t: Task) => taskDateIn(t, weekDates);

  const crew =
    active === "all" ? workers : workers.filter((w) => w.id === active);
  /** Tasks on the calendar date the given weekday holds this week. */
  const onWeekday = (d: number) =>
    tasks.filter((t) => taskDate(t) === (weekDates[d] ?? ""));
  const dayTasks = onWeekday(day);
  const editing = calendarTasks.find((t) => t.id === editingId) ?? null;
  const isApproved = (d: number) => onWeekday(d).some((t) => t.approvedAt);
  const days = view === "day" ? [day] : weekDays.map((_, i) => i);
  const DayIcon = weatherIcon[strip[day]?.icon ?? "cloud"];

  // What Approve acts on: the selected date in month view, the day or week otherwise.
  const scope =
    view === "month"
      ? calendarTasks.filter((t) => taskDate(t) === selectedDate)
      : days.flatMap(onWeekday);
  const scopeApproved =
    scope.length > 0 && scope.every((t) => Boolean(t.approvedAt));

  function approve() {
    const approvedAt = new Date().toISOString();
    taskActions.replace(scope.map((t) => ({ ...t, approvedAt })));
    toast.success(
      view === "day"
        ? `${weekDays[day]} plan approved`
        : view === "week"
          ? "Week plan approved"
          : `Plan approved for ${formatDate(selectedDate)}`,
    );
  }

  function replan() {
    const open = days.filter((d) => !isApproved(d));
    let changed = 0;
    for (const d of open) {
      const planned = week.propose(d).tasks.filter((t) => t.day === d);
      changed += planned.filter((t) => {
        const before = tasks.find((o) => o.id === t.id);
        return before?.workerId !== t.workerId || before.start !== t.start;
      }).length;
      taskActions.replace(planned);
    }
    toast.success(
      open.length === 0
        ? "Already approved — nothing to re-plan"
        : changed === 0
          ? "The plan is already optimal"
          : `Re-planned: ${changed} ${changed === 1 ? "job" : "jobs"} moved or reassigned`,
    );
  }

  return (
    <AppShell
      title="Crew schedule"
      subtitle="Generated each morning from plant schedules and weather — edit anything before you approve"
      actions={
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Add task
          </Button>
          {/* The planner works a weekday at a time against this week's forecast, so it has
              nothing to say about a future month. */}
          {view === "month" ? null : (
            <Button variant="outline" onClick={replan}>
              <Sparkles className="size-4" /> Plan with AI
            </Button>
          )}
          <Button
            onClick={approve}
            disabled={scopeApproved || scope.length === 0}
          >
            <Check className="size-4" /> Approve{" "}
            {view === "day" ? "day" : view === "week" ? "week" : "date"}
          </Button>
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-full border p-0.5">
          {(["day", "week", "month"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-full px-3 py-1.5 text-sm capitalize transition-colors ${
                view === v
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <span className="mx-1 h-6 w-px bg-border" />
        <FilterChip
          label="All workers"
          active={active === "all"}
          onClick={() => setActive("all")}
        />
        {workers.map((w) => (
          <FilterChip
            key={w.id}
            label={w.name}
            color={w.color}
            active={active === w.id}
            onClick={() => setActive(w.id)}
          />
        ))}
      </div>

      {view === "day" ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {weekDays.map((d, i) => (
              <button
                key={d}
                onClick={() => setDay(i)}
                className={`rounded-lg border px-3 py-1.5 text-left text-sm transition-colors ${
                  day === i ? "border-primary bg-primary/10" : "hover:bg-muted"
                }`}
              >
                <span className="font-medium">{d}</span>{" "}
                <span className="text-xs text-muted-foreground">
                  {formatDate(weekDates[i] ?? "")}
                </span>
                {isApproved(i) ? (
                  <Check className="ml-1 inline size-3.5 text-status-healthy" />
                ) : null}
              </button>
            ))}
            <span className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground">
              {weather.isPending ? (
                "Loading forecast…"
              ) : weather.isError ? (
                "Weather unavailable — no weather changes applied"
              ) : (
                <>
                  <DayIcon className="size-4" />
                  {strip[day]?.temp === null
                    ? "No forecast"
                    : `${strip[day]?.temp}°C`}{" "}
                  · {strip[day]?.note}
                </>
              )}
            </span>
          </div>

          <Card className="overflow-hidden shadow-card">
            <CardContent className="overflow-x-auto p-0">
              <div style={{ minWidth: 200 + crew.length * 180 }}>
                <div
                  className="grid border-b bg-muted/40"
                  style={{
                    gridTemplateColumns: `64px repeat(${crew.length}, 1fr)`,
                  }}
                >
                  <div />
                  {crew.map((w) => (
                    <div key={w.id} className="border-l px-3 py-2">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <span
                          className="size-2.5 rounded-full"
                          style={{ background: w.color }}
                        />
                        {w.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {dayTasks
                          .filter((t) => t.workerId === w.id)
                          .reduce((s, t) => s + t.duration, 0)}{" "}
                        h planned
                      </p>
                    </div>
                  ))}
                </div>

                <div
                  className="grid"
                  style={{
                    gridTemplateColumns: `64px repeat(${crew.length}, 1fr)`,
                  }}
                >
                  <HourColumn />
                  {crew.map((w) => (
                    <div key={w.id} className="relative border-l">
                      {HOURS.map((h) => (
                        <div
                          key={h}
                          style={{ height: ROW }}
                          className="border-b"
                        />
                      ))}
                      {dayTasks
                        .filter((t) => t.workerId === w.id)
                        .map((t) => (
                          <TaskBlock
                            key={t.id}
                            task={t}
                            onClick={() => setEditingId(t.id)}
                          />
                        ))}
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="size-3.5" /> Tap any job to change the worker,
            time, length or status.
          </p>
        </>
      ) : view === "week" ? (
        <Card className="overflow-hidden shadow-card">
          <CardContent className="overflow-x-auto p-0">
            <div className="min-w-[860px]">
              <div className="grid grid-cols-[64px_repeat(7,1fr)] border-b bg-muted/40">
                <div />
                {weekDays.map((d, i) => (
                  <div key={d} className="border-l px-3 py-2">
                    <p className="text-sm font-medium">
                      {d}
                      {isApproved(i) ? (
                        <Check className="ml-1 inline size-3.5 text-status-healthy" />
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(weekDates[i] ?? "")} · {strip[i]?.temp ?? "—"}
                      °
                    </p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-[64px_repeat(7,1fr)]">
                <HourColumn />
                {weekDays.map((d, dayIndex) => (
                  <div key={d} className="relative border-l">
                    {HOURS.map((h) => (
                      <div
                        key={h}
                        style={{ height: ROW }}
                        className="border-b"
                      />
                    ))}
                    {onWeekday(dayIndex)
                      .filter((t) => active === "all" || t.workerId === active)
                      .map((t) => (
                        <TaskBlock
                          key={t.id}
                          task={t}
                          onClick={() => setEditingId(t.id)}
                        />
                      ))}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <MonthCalendar
          tasks={calendarTasks.filter(
            (t) => active === "all" || t.workerId === active,
          )}
          dateOf={taskDate}
          cursor={monthCursor}
          today={todayKey}
          selected={selectedDate}
          onCursorChange={setMonthCursor}
          onSelect={setSelectedDate}
          onEdit={(t) => setEditingId(t.id)}
          onAdd={(date) => {
            setSelectedDate(date);
            setCreating(true);
          }}
        />
      )}

      <TaskDialog
        task={editing}
        open={Boolean(editing)}
        onClose={() => setEditingId(null)}
        fallbackDate={weekDates[editing?.day ?? day] ?? todayKey}
      />
      <NewTaskDialog
        open={creating}
        day={day}
        // In month view the job belongs to the date the manager clicked, not to this week.
        {...(view === "month" ? { date: selectedDate } : {})}
        onClose={() => setCreating(false)}
      />
    </AppShell>
  );
}

function MonthCalendar({
  tasks,
  dateOf,
  cursor,
  today,
  selected,
  onCursorChange,
  onSelect,
  onEdit,
  onAdd,
}: {
  tasks: Task[];
  dateOf: (task: Task) => string;
  cursor: Date;
  today: string;
  selected: string;
  onCursorChange: (date: Date) => void;
  onSelect: (date: string) => void;
  onEdit: (task: Task) => void;
  onAdd: (date: string) => void;
}) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const cells = monthCells(year, month);
  const monthLabel = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
  }).format(cursor);

  return (
    <Card className="overflow-hidden border-border/80 shadow-card">
      <CardContent className="bg-muted/15 p-3">
        <div className="mb-3 flex items-center justify-between rounded-lg border bg-card px-3 py-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous month"
            onClick={() => onCursorChange(new Date(year, month - 1, 1))}
          >
            <ChevronLeft />
          </Button>
          <h2 className="text-sm font-semibold">{monthLabel}</h2>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next month"
            onClick={() => onCursorChange(new Date(year, month + 1, 1))}
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[840px] overflow-hidden rounded-lg border bg-card">
            <div className="grid grid-cols-7 border-b bg-muted/30">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                (label) => (
                  <div
                    key={label}
                    className="border-r px-3 py-2 text-[10px] font-semibold uppercase last:border-r-0"
                  >
                    {label}
                  </div>
                ),
              )}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((date) => {
                const key = dateKeyOf(date);
                const dateTasks = tasks
                  .filter((task) => dateOf(task) === key)
                  .sort((a, b) => a.start - b.start);
                const inMonth = date.getMonth() === month;
                return (
                  <div
                    key={key}
                    onClick={() => onSelect(key)}
                    className={cn(
                      "group min-h-32 border-r border-b p-2 [&:nth-child(7n)]:border-r-0",
                      !inMonth && "bg-muted/20 text-muted-foreground",
                      key === selected &&
                        "bg-data-violet/5 ring-1 ring-data-violet/30 ring-inset",
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span
                        className={cn(
                          "text-xs font-semibold tabular-nums",
                          key === today &&
                            "inline-flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground",
                        )}
                      >
                        {date.getDate()}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Add task on ${key}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onAdd(key);
                        }}
                        className="size-6 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
                      >
                        <Plus className="size-3" />
                      </Button>
                    </div>
                    <div className="grid gap-1">
                      {dateTasks.slice(0, 3).map((task) => (
                        <button
                          key={task.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEdit(task);
                          }}
                          className={cn(
                            "flex min-w-0 items-center gap-1 overflow-hidden rounded-md border px-2 py-1 text-left text-[10px]",
                            taskTone[task.kind],
                            task.status === "skipped" &&
                              "opacity-60 line-through",
                          )}
                        >
                          <span className="shrink-0 tabular-nums">
                            {pad(task.start)}:00
                          </span>
                          <span className="truncate">{task.title}</span>
                        </button>
                      ))}
                      {dateTasks.length > 3 ? (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="ghost"
                              onClick={(e) => e.stopPropagation()}
                              className="h-7 justify-start px-2 text-[10px]"
                            >
                              +{dateTasks.length - 3} more tasks
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-72 p-2">
                            <div className="grid gap-1">
                              {dateTasks.slice(3).map((task) => (
                                <Button
                                  key={task.id}
                                  variant="ghost"
                                  onClick={() => onEdit(task)}
                                  className="h-auto justify-start px-2 py-2 text-xs"
                                >
                                  {pad(task.start)}:00 · {task.title}
                                </Button>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function HourColumn() {
  return (
    <div>
      {HOURS.map((h) => (
        <div
          key={h}
          style={{ height: ROW }}
          className="border-b pr-2 text-right text-xs text-muted-foreground tabular-nums"
        >
          {String(h).padStart(2, "0")}:00
        </div>
      ))}
    </div>
  );
}

function TaskBlock({ task, onClick }: { task: Task; onClick: () => void }) {
  const workers = useWorkers();
  const worker = workers.find((w) => w.id === task.workerId);
  const color = worker?.color ?? "var(--chart-1)";
  return (
    <button
      onClick={onClick}
      style={{
        top: (task.start - START) * ROW + 3,
        height: task.duration * ROW - 6,
        borderLeftColor: color,
        backgroundColor: `color-mix(in oklab, ${color} 12%, white)`,
      }}
      className={`absolute inset-x-1.5 overflow-hidden rounded-lg border border-l-4 px-2 py-1.5 text-left transition-shadow hover:shadow-card ${
        task.status === "skipped" ? "opacity-60 line-through" : ""
      }`}
    >
      <p className="truncate text-xs font-semibold">{task.title}</p>
      <p className="truncate text-[11px] text-muted-foreground">
        {task.client}
      </p>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
        {task.site}
      </p>
      {task.weatherNote ? (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-status-attention">
          <CloudRain className="size-3 shrink-0" />
          <span className="truncate">{task.weatherNote}</span>
        </p>
      ) : null}
      {task.status === "done" ? (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-status-healthy">
          <Check className="size-3" /> photo proof added
        </p>
      ) : null}
    </button>
  );
}

function TaskDialog({
  task,
  open,
  onClose,
  fallbackDate,
}: {
  task: Task | null;
  open: boolean;
  onClose: () => void;
  /** Shown for a task that has no date of its own — the date its weekday holds this week. */
  fallbackDate: string;
}) {
  const taskActions = useTaskActions();
  const workers = useWorkers();
  if (!task) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{task.title}</DialogTitle>
          <DialogDescription>
            {task.client} · {task.site}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Job</Label>
            <Input
              value={task.title}
              onChange={(e) =>
                taskActions.update(task.id, { title: e.target.value })
              }
            />
          </div>

          <div className="grid gap-2">
            <Label>Worker</Label>
            <Select
              value={task.workerId}
              onValueChange={(v) =>
                taskActions.update(task.id, { workerId: v })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {workers.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name} · {w.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-2">
              <Label>Date</Label>
              {/* A date, not a weekday, so a job can be moved into a future month. The
                  weekday is kept in step server-side, which is what the worker app reads. */}
              <Input
                type="date"
                value={task.date ?? fallbackDate}
                onChange={(e) => {
                  const date = e.target.value;
                  if (!date) return;
                  taskActions.update(task.id, { date });
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label>Start</Label>
              <Select
                value={String(task.start)}
                onValueChange={(v) =>
                  taskActions.update(task.id, { start: Number(v) })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOURS.map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {String(h).padStart(2, "0")}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Hours</Label>
              <Select
                value={String(task.duration)}
                onValueChange={(v) =>
                  taskActions.update(task.id, { duration: Number(v) })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5, 6].map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {h} h
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Status</Label>
            <Select
              value={task.status}
              onValueChange={(v) =>
                taskActions.update(task.id, { status: v as Task["status"] })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="planned">Planned</SelectItem>
                <SelectItem value="done">Done</SelectItem>
                <SelectItem value="skipped">Skipped</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            className="text-destructive"
            onClick={() => {
              taskActions.remove(task.id);
              onClose();
              toast("Job removed from the plan");
            }}
          >
            <Trash2 className="size-4" /> Remove job
          </Button>
          <Button
            onClick={() => {
              onClose();
              toast.success("Changes saved to the day plan");
            }}
          >
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewTaskDialog({
  open,
  day,
  date,
  onClose,
}: {
  open: boolean;
  day: number;
  /** Set from the month view — the job lands on this calendar date rather than this week. */
  date?: string;
  onClose: () => void;
}) {
  const taskActions = useTaskActions();
  const projects = useProjects();
  const workers = useWorkers();
  const [title, setTitle] = useState("");
  // Empty until picked — then default to the first site/worker once the lists have loaded.
  const [pickedProject, setProjectId] = useState("");
  const [pickedWorker, setWorkerId] = useState("");
  const projectId = pickedProject || projects[0]?.id || "";
  const workerId = pickedWorker || workers[0]?.id || "";
  const [start, setStart] = useState("8");
  const [duration, setDuration] = useState("2");
  const [kind, setKind] = useState<Task["kind"]>("Watering");

  const project = projects.find((p) => p.id === projectId);

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a job</DialogTitle>
          <DialogDescription>
            It lands on{" "}
            {date
              ? formatDate(date, { day: "numeric", month: "long" })
              : weekDays[day]}{" "}
            and appears in the worker's list once you approve the day.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Job</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Hedge clipping"
            />
          </div>
          <div className="grid gap-2">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Worker</Label>
            <Select value={workerId} onValueChange={setWorkerId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {workers.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-2">
              <Label>Start</Label>
              <Select value={start} onValueChange={setStart}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOURS.map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {String(h).padStart(2, "0")}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Hours</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5, 6].map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {h} h
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Type</Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as Task["kind"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            disabled={!title.trim()}
            onClick={() => {
              taskActions.add({
                title: title.trim(),
                projectId,
                client: project?.client ?? "",
                site: project?.zones[0] ?? "",
                workerId,
                // The server derives `day` from `date` when one is given, so the two agree.
                day: date ? weekdayFromDate(date) : day,
                ...(date ? { date } : {}),
                start: Number(start),
                duration: Number(duration),
                kind,
                status: "planned",
              });
              setTitle("");
              onClose();
              toast.success("Job added to the plan");
            }}
          >
            Add job
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FilterChip({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "hover:bg-muted"
      }`}
    >
      {color ? (
        <span className="size-2.5 rounded-full" style={{ background: color }} />
      ) : null}
      {label}
    </button>
  );
}
