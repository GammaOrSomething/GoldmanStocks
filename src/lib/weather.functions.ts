import { createServerFn } from "@tanstack/react-start";

import { toArea } from "@/lib/api/mappers";
import { getAuthedClient } from "@/lib/api/session";
import {
  fetchOpenMeteoJson,
  loadWeekWeather,
  supabaseWeatherCache,
} from "@/lib/server/weather";

// Server functions only: safe to import from routes. The handler (and everything it
// imports from src/lib/server/) runs on the server; the browser gets an RPC stub.
//
// Sites are read on the caller's session. The forecast cache is shared by every company and
// has no row-level policies, so only the service-role client can use it; it holds nothing but
// forecasts keyed by rounded coordinates. The client is imported inside the handler because
// `@/lib/supabase/server` is server-only.

export type { DashboardWeather, WeekWeather } from "@/lib/server/weather";

/**
 * This week's forecast for every site, at the sites' coordinates in the database (so a site
 * added or moved on the map gets its own forecast), or for where the company is based until
 * it has sites. Cached in `weather_cache` for 3 hours.
 */
export const getWeekWeather = createServerFn({ method: "GET" }).handler(
  async () => {
    const db = await getAuthedClient();
    const { getAdminClient } = await import("@/lib/supabase/server");
    const [sites, company] = await Promise.all([
      db.from("projects").select("id, lat, lng").order("id"),
      db.from("companies").select("city, lat, lng").maybeSingle(),
    ]);
    if (sites.error) throw new Error(sites.error.message);
    if (company.error) throw new Error(company.error.message);

    return loadWeekWeather(
      (sites.data ?? []).map((p) => ({
        id: p.id,
        lat: Number(p.lat),
        lng: Number(p.lng),
      })),
      toArea(company.data),
      supabaseWeatherCache(getAdminClient()),
      fetchOpenMeteoJson,
      new Date(),
    );
  },
);
