import { weekDays } from "./labels";
import type { DayWeather, Project, Task, WeatherIcon } from "./types";

/**
 * Forecast for one site in the site's local time (Open-Meteo `timezone=auto`).
 * `time` is "YYYY-MM-DDTHH:MM", `date` is "YYYY-MM-DD".
 */
export type SiteForecast = {
  /** rain per hour — hours without rain may be left out */
  hourly: { time: string; precipMm: number }[];
  daily: {
    date: string;
    precipMm: number;
    tempMaxC: number;
    weatherCode: number;
  }[];
};

export type ForecastByProject = Record<string, SiteForecast | undefined>;

/** Rain from the evening before plus the day itself at or above this skips watering. */
export const RAIN_SKIP_MM = 5;
/** A day whose max temperature reaches this pulls clipping and watering earlier. */
export const WARM_C = 18;

const DAY_START = 7;
/** Tasks starting at or before this hour already run in the cool of the morning. */
const MORNING_END = 8;

const SKIP_PREFIX = "Skipped —";
const MOVED_NOTE = "Moved earlier — warm spell";

// ─── Dates ───────────────────────────────────────────────────────────────────

/** All sites are in the Baltics; dates are the company's local calendar days. */
export const COMPANY_TZ = "Europe/Tallinn";

export function addDays(date: string, days: number): string {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" for `now` in the company's time zone (same on server and browser). */
export function localDate(now: Date, timeZone = COMPANY_TZ): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** "08:15" for an ISO instant on the company's clock — the time a photo was actually taken. */
export function localTime(iso: string, timeZone = COMPANY_TZ): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** 0 = Monday … 6 = Sunday */
function weekday(date: string) {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/**
 * Mon–Sun of the week being planned — the week `now` is actually in.
 *
 * Weekends are ordinary days: grounds still need watering on a Saturday, and a week that stopped
 * on Friday left the worker app with nothing to show for two days out of seven.
 */
export function planWeekDates(now: Date): string[] {
  const today = localDate(now);
  const monday = addDays(today, -weekday(today));
  return [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(monday, i));
}

/** Index of today in `planWeekDates(now)`. */
export function todayIndex(now: Date): number {
  return weekday(localDate(now));
}

// ─── Forecast readings ───────────────────────────────────────────────────────

function rainBetween(forecast: SiteForecast, from: string, to: string) {
  return forecast.hourly
    .filter((h) => h.time >= from && h.time < to)
    .reduce((sum, h) => sum + h.precipMm, 0);
}

/** Rain from 18:00 the evening before until 06:00 on `date`. */
export function overnightRainMm(forecast: SiteForecast, date: string) {
  return rainBetween(forecast, `${addDays(date, -1)}T18:00`, `${date}T06:00`);
}

/** Rain from 06:00 to 18:00 on `date`. */
export function daytimeRainMm(forecast: SiteForecast, date: string) {
  return rainBetween(forecast, `${date}T06:00`, `${date}T18:00`);
}

export function maxTempC(forecast: SiteForecast, date: string) {
  return forecast.daily.find((d) => d.date === date)?.tempMaxC;
}

// ─── Rules ───────────────────────────────────────────────────────────────────

function isWeatherNote(note: string | undefined) {
  return Boolean(note && (note.startsWith(SKIP_PREFIX) || note === MOVED_NOTE));
}

/** Drop the effects of a previous rule run so the rules are re-evaluated from scratch. */
function baseline(task: Task): Task {
  if (!isWeatherNote(task.weatherNote)) return task;
  const { weatherNote, ...rest } = task;
  return weatherNote?.startsWith(SKIP_PREFIX) && task.status === "skipped"
    ? { ...rest, status: "planned" }
    : rest;
}

function overlaps(
  a: { start: number; duration: number },
  start: number,
  duration: number,
) {
  return start < a.start + a.duration && a.start < start + duration;
}

/**
 * Apply the weather rules to a week of tasks and return new task objects (inputs are
 * never mutated). `weekDates[task.day]` is the task's date. Done tasks and days that
 * are already approved are left exactly as they are. Tasks at sites with no forecast
 * lose any earlier weather adjustment — without live data we make no weather claims.
 */
export function applyWeatherRules(
  tasks: Task[],
  forecastByProject: ForecastByProject,
  weekDates: string[],
): Task[] {
  const approvedDays = new Set(
    tasks.filter((t) => t.approvedAt).map((t) => t.day),
  );
  const frozen = (t: Task) => t.status === "done" || approvedDays.has(t.day);
  const context = (t: Task) => {
    const date = weekDates[t.day];
    const forecast = forecastByProject[t.projectId];
    return date && forecast ? { date, forecast } : null;
  };

  // Rain: skip watering.
  const out = tasks.map((task): Task => {
    if (frozen(task)) return task;
    const base = baseline(task);
    const ctx = context(base);
    if (!ctx || base.kind !== "Watering" || base.status !== "planned")
      return base;

    const overnight = overnightRainMm(ctx.forecast, ctx.date);
    const total = overnight + daytimeRainMm(ctx.forecast, ctx.date);
    if (total < RAIN_SKIP_MM) return base;
    const weatherNote =
      overnight >= RAIN_SKIP_MM
        ? `${SKIP_PREFIX} ${Math.round(overnight)} mm rain overnight`
        : `${SKIP_PREFIX} ${Math.round(total)} mm rain expected`;
    return { ...base, status: "skipped", weatherNote };
  });

  // Warm spell: pull clipping and watering into the earliest free earlier slot.
  const candidates = out
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => {
      if (
        frozen(task) ||
        task.status !== "planned" ||
        task.start <= MORNING_END
      )
        return false;
      if (task.kind !== "Clipping" && task.kind !== "Watering") return false;
      const ctx = context(task);
      return (
        ctx !== null &&
        (maxTempC(ctx.forecast, ctx.date) ?? -Infinity) >= WARM_C
      );
    })
    .sort((a, b) => a.task.start - b.task.start);

  for (const { task, index } of candidates) {
    const busy = out.filter(
      (o) =>
        o.id !== task.id &&
        o.workerId === task.workerId &&
        o.day === task.day &&
        o.status !== "skipped",
    );
    for (let hour = DAY_START; hour + task.duration <= task.start; hour++) {
      if (busy.some((b) => overlaps(b, hour, task.duration))) continue;
      out[index] = { ...task, start: hour, weatherNote: MOVED_NOTE };
      break;
    }
  }

  return out;
}

/** One-line summary of what the weather changed on `day`, for the weather strip. */
export function summarizeDay(tasks: Task[], day: number): string {
  const own = tasks.filter((t) => t.day === day);
  const skipped = own.filter(
    (t) => t.status === "skipped" && t.weatherNote?.startsWith(SKIP_PREFIX),
  ).length;
  const moved = own.filter((t) => t.weatherNote === MOVED_NOTE).length;

  const parts: string[] = [];
  if (skipped)
    parts.push(
      `${skipped} watering ${skipped === 1 ? "task" : "tasks"} skipped`,
    );
  if (moved)
    parts.push(`${moved} ${moved === 1 ? "job" : "jobs"} moved earlier — warm`);
  return parts.join(" · ") || "No weather changes";
}

// ─── Open-Meteo ──────────────────────────────────────────────────────────────

/** One site in an Open-Meteo /v1/forecast response (an array when several sites are asked for). */
export type OpenMeteoSite = {
  latitude: number;
  longitude: number;
  timezone?: string;
  hourly: {
    time: string[];
    precipitation: (number | null)[];
  };
  daily: {
    time: string[];
    precipitation_sum: (number | null)[];
    temperature_2m_max: (number | null)[];
    weather_code: (number | null)[];
  };
};

type LatLng = { lat: number; lng: number };

/**
 * One request for every site. `past_days=7` keeps the whole current week (and the
 * Sunday evening before it) in view for the overnight-rain rule.
 */
export function openMeteoUrl(sites: LatLng[]): string {
  const params = new URLSearchParams({
    latitude: sites.map((s) => s.lat).join(","),
    longitude: sites.map((s) => s.lng).join(","),
    hourly: "precipitation",
    daily: "precipitation_sum,temperature_2m_max,weather_code",
    past_days: "7",
    forecast_days: "10",
    timezone: "auto",
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

/** Cache key for a site: coordinates rounded to ~1 km. */
export function siteKey(site: LatLng): string {
  return `${site.lat.toFixed(2)},${site.lng.toFixed(2)}`;
}

/** Normalise the response to one entry per requested site (a single site isn't wrapped in an array). */
export function splitOpenMeteo(json: unknown): OpenMeteoSite[] {
  const sites = Array.isArray(json) ? json : [json];
  for (const s of sites) {
    if (!s || typeof s !== "object" || !("hourly" in s) || !("daily" in s)) {
      throw new Error("Unexpected Open-Meteo response");
    }
  }
  return sites as OpenMeteoSite[];
}

/** Map one site's response. Hours or days without data are dropped, never guessed. */
export function toSiteForecast(site: OpenMeteoSite): SiteForecast {
  const hourly = site.hourly.time.flatMap((time, i) => {
    const precipMm = site.hourly.precipitation[i];
    return precipMm == null ? [] : [{ time, precipMm }];
  });
  const daily = site.daily.time.flatMap((date, i) => {
    const precipMm = site.daily.precipitation_sum[i];
    const tempMaxC = site.daily.temperature_2m_max[i];
    const weatherCode = site.daily.weather_code[i];
    return precipMm == null || tempMaxC == null || weatherCode == null
      ? []
      : [{ date, precipMm, tempMaxC, weatherCode }];
  });
  return { hourly, daily };
}

/**
 * Keep only what the rules and the growth prediction read: days from `from` to `to`
 * (inclusive) and, within them, the hours that had rain. Rain sums are unchanged.
 */
export function trimForecast(
  forecast: SiteForecast,
  from: string,
  to: string,
): SiteForecast {
  const inRange = (date: string) => date >= from && date <= to;
  return {
    hourly: forecast.hourly.filter(
      (h) => h.precipMm > 0 && inRange(h.time.slice(0, 10)),
    ),
    daily: forecast.daily.filter((d) => inRange(d.date)),
  };
}

/** WMO weather code → the dashboard's three icons. */
export function weatherIcon(code: number): WeatherIcon {
  if (code <= 1) return "sun";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) {
    return "rain";
  }
  return "cloud"; // overcast, fog, snow
}

// ─── Weather strip ───────────────────────────────────────────────────────────

/** The site the strip shows: one in the city with the most sites (Tallinn for Rootline). */
export function primaryProject(projects: Project[]): Project | undefined {
  const count = (city: string) =>
    projects.filter((p) => p.city === city).length;
  return [...projects].sort((a, b) => count(b.city) - count(a.city))[0];
}

/**
 * Which forecast the week's strip shows: the primary site's once the company has sites (even if
 * that forecast is missing), otherwise the one for where the company is based, otherwise none.
 */
export function pickStripForecast(
  projects: Project[],
  forecasts: ForecastByProject,
  area: { forecast: SiteForecast } | null,
): { source: "site" | "area" | "none"; forecast: SiteForecast | undefined } {
  const primary = primaryProject(projects);
  if (primary) return { source: "site", forecast: forecasts[primary.id] };
  if (area) return { source: "area", forecast: area.forecast };
  return { source: "none", forecast: undefined };
}

/**
 * The week's weather strip: the primary site's forecast, with each day's note
 * summarising what the rules changed across all sites. Days without a forecast
 * show no temperature rather than a made-up one.
 */
export function weatherStrip(
  forecast: SiteForecast | undefined,
  weekDates: string[],
  adjustedTasks: Task[],
): DayWeather[] {
  return weekDates.map((date, i) => {
    const today = forecast?.daily.find((d) => d.date === date);
    return {
      day: weekDays[i] ?? date,
      icon: today ? weatherIcon(today.weatherCode) : "cloud",
      temp: today ? Math.round(today.tempMaxC) : null,
      note: today ? summarizeDay(adjustedTasks, i) : "No forecast",
    };
  });
}
