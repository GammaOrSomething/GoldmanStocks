import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";

import { requireBoss } from "./session";
import { spendAllowance } from "./usage";

/**
 * Address search for placing work sites, via OpenStreetMap's Nominatim (free, no key). Called
 * from the server with an identifying User-Agent, as its usage policy asks; searches are only
 * sent on submit, well under its one-request-per-second limit.
 */
const NOMINATIM = "https://nominatim.openstreetmap.org";
const HEADERS = {
  "User-Agent": "GoldmanStocks/1.0 (landscaping crew planner)",
  "Accept-Language": "en",
};

export type Place = {
  label: string;
  /** street and number with the town, e.g. "Valukoja 8, Tallinn" */
  address: string;
  /** street and number alone, for a form that has its own town field */
  street: string;
  city: string;
  lat: number;
  lng: number;
};

/** The short name a place goes by: its town, or the first part of its address. */
export function placeName(place: Place): string {
  return (place.city || place.address).slice(0, 200);
}

export type NominatimPlace = {
  display_name: string;
  lat: string;
  lon: string;
  address?: Record<string, string | undefined>;
};

export function toPlace(p: NominatimPlace): Place {
  const a = p.address ?? {};
  const street =
    [a["road"] ?? a["pedestrian"] ?? a["footway"], a["house_number"]]
      .filter(Boolean)
      .join(" ") || (p.display_name.split(",")[0] ?? "").trim();
  const city =
    a["city"] ??
    a["town"] ??
    a["village"] ??
    a["municipality"] ??
    a["county"] ??
    "";
  return {
    label: p.display_name,
    address: [street, city].filter(Boolean).join(", "),
    street,
    city,
    lat: Number(p.lat),
    lng: Number(p.lon),
  };
}

async function nominatim(path: string, params: Record<string, string>) {
  // Bosses only (they place sites): keeps this from being an open proxy to Nominatim. And
  // metered per company, since every company shares our server's standing with Nominatim.
  await spendAllowance(await requireBoss(), "geocode");
  const url = `${NOMINATIM}${path}?${new URLSearchParams({ format: "jsonv2", addressdetails: "1", ...params })}`;
  const res = await fetch(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Address search failed (HTTP ${res.status})`);
  return res.json() as Promise<unknown>;
}

export const searchAddress = createServerFn({ method: "GET" })
  .validator(z.string().trim().min(3, "Type at least 3 characters").max(200))
  .handler(async ({ data: query }): Promise<Place[]> => {
    const results = (await nominatim("/search", {
      q: query,
      limit: "5",
    })) as NominatimPlace[];
    return results.map(toPlace);
  });

/** The address at a point — fills in the form when a site is placed by clicking the map. */
export const addressAt = createServerFn({ method: "GET" })
  .validator(
    z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }),
  )
  .handler(async ({ data }): Promise<Place | null> => {
    const result = (await nominatim("/reverse", {
      lat: String(data.lat),
      lon: String(data.lng),
      zoom: "18",
    })) as NominatimPlace & { error?: string };
    return result.error ? null : toPlace(result);
  });
