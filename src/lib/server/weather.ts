import type { SupabaseClient } from "@supabase/supabase-js";

import type { Area } from "@/lib/api/mappers";
import {
  addDays,
  localDate,
  openMeteoUrl,
  planWeekDates,
  siteKey,
  splitOpenMeteo,
  toSiteForecast,
  trimForecast,
  type OpenMeteoSite,
  type SiteForecast,
} from "@/lib/weather";

/** How long a cached forecast counts as fresh. */
export const WEATHER_TTL_MS = 3 * 60 * 60 * 1000;

/**
 * The most sites fetched in one load. Every company shares our Open-Meteo quota, so one company
 * with hundreds of sites must not use it up; the rest are fetched on later loads.
 */
export const MAX_FETCH_SITES = 50;

type CachedSite = { fetchedAt: string; payload: OpenMeteoSite };

/** Where forecasts are cached, keyed by `siteKey()`. */
export type WeatherCache = {
  get(key: string): Promise<CachedSite | null>;
  set(key: string, entry: CachedSite): Promise<void>;
};

/** Per-server-process cache — used until track A's Supabase client lands (A1). */
export function memoryWeatherCache(): WeatherCache {
  const entries = new Map<string, CachedSite>();
  return {
    get: async (key) => entries.get(key) ?? null,
    set: async (key, entry) => void entries.set(key, entry),
  };
}

/** The `weather_cache` table. Needs the service-role client: signed-in users can't reach it. */
export function supabaseWeatherCache(db: SupabaseClient): WeatherCache {
  return {
    async get(key) {
      const { data, error } = await db
        .from("weather_cache")
        .select("fetched_at, payload")
        .eq("key", key)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        // Postgres returns "+00:00" offsets; normalise so timestamps compare as strings
        fetchedAt: new Date(data.fetched_at).toISOString(),
        payload: data.payload as OpenMeteoSite,
      };
    },
    async set(key, entry) {
      const { error } = await db.from("weather_cache").upsert({
        key,
        fetched_at: entry.fetchedAt,
        payload: entry.payload,
      });
      if (error) throw error;
    },
  };
}

type Site = { id: string; lat: number; lng: number };

export type WeekWeather = {
  /** forecast per project id; projects without any data are absent */
  forecasts: Record<string, SiteForecast>;
  /** when the oldest forecast in use was fetched */
  fetchedAt: string;
  /** true when the live fetch failed and cached data is being shown */
  stale: boolean;
  /** project ids with no forecast at all */
  missing: string[];
};

/**
 * Forecasts for every site: fresh cache entries are used as-is, everything else is
 * fetched in one Open-Meteo request. If that request fails, older cached data is used
 * (flagged `stale`). With no data at all this throws — we never make weather up.
 */
export async function loadForecasts(
  sites: Site[],
  cache: WeatherCache,
  fetchJson: (url: string) => Promise<unknown>,
  now: Date,
): Promise<WeekWeather> {
  const cached = new Map<string, CachedSite>();
  for (const site of sites) {
    try {
      const entry = await cache.get(siteKey(site));
      if (entry) cached.set(site.id, entry);
    } catch (error) {
      console.error("weather cache read failed", error); // a cache problem is just a miss
    }
  }

  const isFresh = (entry: CachedSite | undefined) =>
    entry !== undefined &&
    now.getTime() - new Date(entry.fetchedAt).getTime() < WEATHER_TTL_MS;
  const toFetch = sites
    .filter((s) => !isFresh(cached.get(s.id)))
    .slice(0, MAX_FETCH_SITES);

  const used = new Map<string, CachedSite>();
  for (const site of sites) {
    const entry = cached.get(site.id);
    if (entry && isFresh(entry)) used.set(site.id, entry);
  }

  let stale = false;
  let fetchError: unknown;
  if (toFetch.length) {
    try {
      const payloads = splitOpenMeteo(await fetchJson(openMeteoUrl(toFetch)));
      if (payloads.length !== toFetch.length) {
        throw new Error(
          `Open-Meteo returned ${payloads.length} sites, expected ${toFetch.length}`,
        );
      }
      const fetchedAt = now.toISOString();
      await Promise.all(
        toFetch.map(async (site, i) => {
          const entry = { fetchedAt, payload: payloads[i]! };
          used.set(site.id, entry);
          try {
            await cache.set(siteKey(site), entry);
          } catch (error) {
            console.error("weather cache write failed", error);
          }
        }),
      );
    } catch (error) {
      fetchError = error;
    }
  }

  // Sites not fetched this time (the fetch failed, or they were past the cap) fall back to an
  // older forecast if there is one.
  for (const site of sites) {
    const entry = cached.get(site.id);
    if (!used.has(site.id) && entry) {
      used.set(site.id, entry);
      stale = true;
    }
  }

  if (!used.size) {
    throw new Error(
      `Weather unavailable: ${fetchError instanceof Error ? fetchError.message : "no forecast"}`,
    );
  }

  const forecasts: Record<string, SiteForecast> = {};
  for (const [id, entry] of used) forecasts[id] = toSiteForecast(entry.payload);
  const fetchedAt = [...used.values()].map((e) => e.fetchedAt).sort()[0]!;
  return {
    forecasts,
    fetchedAt,
    stale,
    missing: sites.filter((s) => !used.has(s.id)).map((s) => s.id),
  };
}

/**
 * Cut the forecasts down to what the screens use — the plan week from the Sunday
 * evening before it, and the next 7 days for the growth prediction — so the
 * response stays small.
 */
export function trimToPlanWindow(week: WeekWeather, now: Date): WeekWeather {
  const dates = planWeekDates(now);
  const from = addDays(dates[0]!, -1);
  const nextWeek = addDays(localDate(now), 7);
  const lastDay = dates.at(-1)!;
  const to = lastDay > nextWeek ? lastDay : nextWeek;
  const forecasts: Record<string, SiteForecast> = {};
  for (const [id, f] of Object.entries(week.forecasts)) {
    forecasts[id] = trimForecast(f, from, to);
  }
  return { ...week, forecasts };
}

/** The reserved id the company's own area is forecast under while it has no sites. */
const AREA_ID = "company-area";

export type AreaForecast = { city: string; forecast: SiteForecast };
export type DashboardWeather = WeekWeather & {
  /** whether the company has any sites, as the server saw it: the dashboard shouldn't guess */
  hasSites: boolean;
  area: AreaForecast | null;
};

/**
 * The dashboard's week: every site's forecast, trimmed to the plan window. A company with no
 * sites yet gets the forecast for where it's based instead, in the same single request. With
 * neither there's nothing to forecast, which is an empty week rather than an outage.
 */
export async function loadWeekWeather(
  sites: Site[],
  area: Area | null,
  cache: WeatherCache,
  fetchJson: (url: string) => Promise<unknown>,
  now: Date,
): Promise<DashboardWeather> {
  if (sites.length) {
    const week = await loadForecasts(sites, cache, fetchJson, now);
    return { ...trimToPlanWindow(week, now), hasSites: true, area: null };
  }
  if (!area) {
    return {
      forecasts: {},
      fetchedAt: now.toISOString(),
      stale: false,
      missing: [],
      hasSites: false,
      area: null,
    };
  }
  const week = trimToPlanWindow(
    await loadForecasts(
      [{ id: AREA_ID, lat: area.lat, lng: area.lng }],
      cache,
      fetchJson,
      now,
    ),
    now,
  );
  const forecast = week.forecasts[AREA_ID];
  return {
    ...week,
    forecasts: {},
    missing: [],
    hasSites: false,
    area: forecast ? { city: area.city, forecast } : null,
  };
}

/** Fetch JSON from Open-Meteo with a 10 s timeout. */
export async function fetchOpenMeteoJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
  return response.json();
}

/** The server's forecast cache — in-memory until track A's Supabase client lands (A1). */
export const defaultWeatherCache = memoryWeatherCache();
