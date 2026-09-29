import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { proposeDay } from "@/lib/planner";
import { dataKeys, usePlants, useProjects, useWorkers } from "@/hooks/use-data";
import { getWeekWeather } from "@/lib/weather.functions";
import { useTasks } from "@/hooks/use-tasks";
import { inWeek } from "@/lib/task-schedule";
import {
  applyWeatherRules,
  COMPANY_TZ,
  pickStripForecast,
  planWeekDates,
  todayIndex,
  weatherStrip,
  type ForecastByProject,
} from "@/lib/weather";

const NO_FORECASTS: ForecastByProject = {};

const SHORT_MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(
  " ",
);

/**
 * "YYYY-MM-DD" → "21 Sep" by default (the app's style — ICU would say "Sept"),
 * or any Intl format, e.g. `{ weekday: "long" }` → "Monday".
 */
export function formatDate(iso: string, options?: Intl.DateTimeFormatOptions) {
  if (!options) {
    const [, month = 1, day = 1] = iso.split("-").map(Number);
    return `${String(day).padStart(2, "0")} ${SHORT_MONTHS[month - 1] ?? ""}`;
  }
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
    ...options,
    timeZone: "UTC",
  });
}

/** "morning" / "afternoon" / "evening" in the company's time zone. */
export function partOfDay(now: Date) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: COMPANY_TZ,
    }).format(now),
  );
  return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}

/**
 * Everything the dashboard and schedule need about the plan week: its dates, the
 * live forecast, the tasks with the weather rules applied, the weather strip, and
 * the planner's proposal for any day. Everything comes from the database.
 */
export function useWeekPlan() {
  const now = useMemo(() => new Date(), []);
  const weekDates = useMemo(() => planWeekDates(now), [now]);
  const today = todayIndex(now);

  const weather = useQuery({
    queryKey: dataKeys.weekWeather,
    queryFn: () => getWeekWeather(),
    staleTime: 15 * 60 * 1000,
    retry: 1,
  });
  const forecasts = weather.data?.forecasts ?? NO_FORECASTS;

  const tasks = useTasks();
  const workers = useWorkers();
  const projects = useProjects();
  const plants = usePlants();
  /**
   * Only this week's tasks feed the plan. A task dated in a future month (migration 0004)
   * still carries a weekday, so without this it would be planned, weathered and counted as if
   * it were happening this week. The month view reads `tasks` for the whole picture.
   */
  const weekTasks = useMemo(
    () => tasks.filter((t) => inWeek(t, weekDates)),
    [tasks, weekDates],
  );
  const adjusted = useMemo(
    () => applyWeatherRules(weekTasks, forecasts, weekDates),
    [weekTasks, forecasts, weekDates],
  );

  // The primary site's forecast; until the company has sites, the one for where it's based.
  const area = weather.data?.area ?? null;
  const source = useMemo(
    () => pickStripForecast(projects, forecasts, area),
    [projects, forecasts, area],
  );
  const strip = useMemo(
    () => weatherStrip(source.forecast, weekDates, adjusted),
    [source, weekDates, adjusted],
  );

  const propose = useCallback(
    (day: number) =>
      proposeDay(
        { tasks: weekTasks, workers, projects, plants },
        day,
        forecasts,
        weekDates,
      ),
    [weekTasks, workers, projects, plants, forecasts, weekDates],
  );

  return {
    now,
    weekDates,
    today,
    weather,
    forecasts,
    tasks,
    workers,
    projects,
    plants,
    adjusted,
    strip,
    /** where the strip's forecast comes from: a site, the company's area, or nowhere yet */
    stripSource: source.source,
    /** the forecast behind the strip, if there is one */
    stripForecast: source.forecast,
    /** the city the area forecast is for, when that's what the strip shows */
    areaCity: area?.city ?? null,
    /**
     * No sites and nowhere set, as the server saw it: ask where the company is based. Not taken
     * from `projects`, which is empty while it loads or after an error.
     */
    needsArea: weather.data?.hasSites === false && !area,
    propose,
  };
}
