/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

import { monthRangeUtc } from "@/lib/month";
import {
  ClientReportInput,
  clientReport,
  dayLabel,
  mapLink,
  signedUrlMap,
} from "./reports";

// Same approach as photos.test.ts: the database flow is exercised against the real project by
// hand, so these cover the rules that have to hold before anything is queried.

/** A client that fails loudly if anything reaches the database. */
const untouchable = new Proxy(
  {},
  {
    get() {
      throw new Error("database should not be reached");
    },
  },
) as SupabaseClient<Database>;

const C1 = "3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f";

describe("input validation", () => {
  test("a month is YYYY-MM or it is not a month", () => {
    const valid = { clientId: "c1", month: "2026-09" };
    expect(ClientReportInput.safeParse(valid).success).toBe(true);
    for (const month of ["2026-13", "2026-00", "2026-9", "26-01", "", "2026"]) {
      expect(ClientReportInput.safeParse({ ...valid, month }).success).toBe(
        false,
      );
    }
  });

  test("a client id is required", () => {
    expect(
      ClientReportInput.safeParse({ clientId: "", month: "2026-09" }).success,
    ).toBe(false);
  });

  test("a bad month is refused before any DB call", async () => {
    await expect(
      clientReport(untouchable, { clientId: C1, month: "2026-13" }),
    ).rejects.toThrow();
  });

  test("a malformed client id is an unknown client, found without a DB call", async () => {
    expect(
      await clientReport(untouchable, { clientId: "c1", month: "2026-09" }),
    ).toBeNull();
  });
});

describe("signedUrlMap", () => {
  test("keys on path, so a reordered response still resolves", () => {
    const urls = signedUrlMap([
      { path: "tasks/t2/b.jpg", signedUrl: "https://b", error: null },
      { path: "tasks/t1/a.jpg", signedUrl: "https://a", error: null },
    ]);
    expect(urls.get("tasks/t1/a.jpg")).toBe("https://a");
    expect(urls.get("tasks/t2/b.jpg")).toBe("https://b");
  });

  test("a per-path failure is dropped, the rest survive", () => {
    const urls = signedUrlMap([
      { path: "gone.jpg", signedUrl: null, error: "Object not found" },
      { path: null, signedUrl: null, error: "bad" },
      { path: "ok.jpg", signedUrl: "https://ok", error: null },
    ]);
    expect(urls.size).toBe(1);
    expect(urls.get("ok.jpg")).toBe("https://ok");
    expect(urls.has("gone.jpg")).toBe(false);
  });

  test("an empty response is an empty map, not a throw", () => {
    expect(signedUrlMap([]).size).toBe(0);
  });
});

// ─── Weekend work must always reach the report ───────────────────────────────
//
// The report filters photos on the calendar month and nothing else. That is deliberate: a job
// photographed on a Saturday is as much proof of work as one taken on a Tuesday, and a client
// paying for weekend cover has to see it. These tests exist so a weekday filter can never be
// introduced without something going red.

type Row = Record<string, unknown>;

/** Records every filter applied, so a test can assert what the query narrowed on. */
type Recorded = { table: string; op: string; args: unknown[] }[];

/**
 * The smallest stub of the PostgREST builder that `clientReport` actually uses:
 * .select / .eq / .in / .gte / .lt / .order, awaited for { data, error }, plus .maybeSingle().
 */
function stubDb(tables: Record<string, Row[]>, recorded: Recorded) {
  const builder = (table: string) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      order: () => chain,
      maybeSingle: async () => ({
        data: tables[table]?.[0] ?? null,
        error: null,
      }),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
        resolve({ data: tables[table] ?? [], error: null }),
    };
    for (const op of ["eq", "in", "gte", "lt"]) {
      chain[op] = (...args: unknown[]) => {
        recorded.push({ table, op, args });
        return chain;
      };
    }
    return chain;
  };

  return {
    from: (table: string) => builder(table),
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => ({
          data: paths.map((path) => ({
            path,
            signedUrl: `https://signed/${path}`,
            error: null,
          })),
          error: null,
        }),
      }),
    },
  } as unknown as SupabaseClient<Database>;
}

const photoRow = (id: string, takenAt: string) => ({
  id,
  task_id: "t1",
  storage_path: `tasks/t1/${id}.jpg`,
  taken_at: takenAt,
  lat: 59.4196,
  lng: 24.8048,
});

/** September 2026: the 19th is a Saturday and the 20th a Sunday. */
function septemberTables(photos: Row[]) {
  return {
    clients: [
      { id: C1, name: "Ülemiste", city: "Tallinn", contact: "Anu Saar" },
    ],
    projects: [{ id: "p1", name: "Ülemiste Business Park" }],
    tasks: [
      {
        id: "t1",
        title: "Weekend watering",
        kind: "Watering",
        zone: "North courtyard",
        plant_id: null,
        worker_id: "w1",
        project_id: "p1",
      },
    ],
    plants: [],
    workers: [{ id: "w1", name: "Mart Kivi" }],
    task_photos: photos,
  };
}

describe("weekend photos always reach the report", () => {
  test("a Saturday and a Sunday photo both appear, labelled as such", async () => {
    const recorded: Recorded = [];
    const db = stubDb(
      septemberTables([
        photoRow("sat", "2026-09-19T08:15:00+03:00"),
        photoRow("sun", "2026-09-20T17:40:00+03:00"),
      ]),
      recorded,
    );

    const report = await clientReport(db, { clientId: C1, month: "2026-09" });
    const labels = report!.rows.map((r) => r.dayLabel);
    expect(labels).toContain("Sat 19 Sep");
    expect(labels).toContain("Sun 20 Sep");
    expect(report!.rows).toHaveLength(2);
  });

  test("weekday photos still appear — the rule is 'the whole month', not 'weekends only'", async () => {
    const recorded: Recorded = [];
    const db = stubDb(
      septemberTables([
        photoRow("tue", "2026-09-15T09:00:00+03:00"),
        photoRow("sat", "2026-09-19T08:15:00+03:00"),
      ]),
      recorded,
    );

    const report = await clientReport(db, { clientId: C1, month: "2026-09" });
    expect(report!.rows.map((r) => r.dayLabel)).toEqual([
      "Tue 15 Sep",
      "Sat 19 Sep",
    ]);
  });

  test("the photo query narrows on the month and the task ids — never on a weekday", async () => {
    const recorded: Recorded = [];
    const db = stubDb(
      septemberTables([photoRow("sat", "2026-09-19T08:15:00+03:00")]),
      recorded,
    );
    await clientReport(db, { clientId: C1, month: "2026-09" });

    const onPhotos = recorded.filter((r) => r.table === "task_photos");
    expect(onPhotos.map((r) => r.op).sort()).toEqual(["gte", "in", "lt"]);
    // The month bounds, in Europe/Tallinn — not UTC midnight.
    expect(onPhotos.find((r) => r.op === "gte")!.args).toEqual([
      "taken_at",
      "2026-08-31T21:00:00.000Z",
    ]);
    expect(onPhotos.find((r) => r.op === "lt")!.args).toEqual([
      "taken_at",
      "2026-09-30T21:00:00.000Z",
    ]);
    // Nothing anywhere in the report's queries may filter on a weekday column.
    const columns = recorded
      .flatMap((r) => r.args)
      .filter((a) => typeof a === "string");
    expect(columns).not.toContain("day");
    expect(columns).not.toContain("date");
  });

  test("the month boundary still bites: the last Sunday is in, the next day is not", () => {
    const { startUtc, endUtc } = monthRangeUtc("2026-09");
    const inside = (iso: string) => {
      const t = new Date(iso).toISOString();
      return t >= startUtc && t < endUtc;
    };
    expect(inside("2026-09-05T06:00:00+03:00")).toBe(true); // first Saturday
    expect(inside("2026-09-27T23:30:00+03:00")).toBe(true); // last Sunday, late
    expect(inside("2026-10-03T09:00:00+03:00")).toBe(false); // next month's Saturday
    expect(inside("2026-08-29T09:00:00+03:00")).toBe(false); // previous month's Saturday
  });
});

describe("the date column", () => {
  test("reads as a day a person recognises", () => {
    expect(dayLabel("2026-09-07")).toBe("Mon 07 Sep");
    expect(dayLabel("2026-01-01")).toBe("Thu 01 Jan");
  });

  test("names the weekend days, which the report must show like any other", () => {
    expect(dayLabel("2026-09-19")).toBe("Sat 19 Sep");
    expect(dayLabel("2026-09-20")).toBe("Sun 20 Sep");
  });

  test("is not shifted by the host's time zone", () => {
    // Formatted at UTC noon, so a machine in UTC-5 cannot render this as the 6th.
    expect(dayLabel("2026-09-07").startsWith("Mon")).toBe(true);
  });
});

describe("the map link", () => {
  test("is omitted when the phone recorded no GPS", () => {
    expect(mapLink(null, null)).toBeNull();
    expect(mapLink(59.42, null)).toBeNull();
    expect(mapLink(null, 24.8)).toBeNull();
  });

  test("points at the spot the photo was taken", () => {
    expect(mapLink(59.4196, 24.8048)).toBe(
      "https://www.openstreetmap.org/?mlat=59.4196&mlon=24.8048#map=18/59.4196/24.8048",
    );
  });

  test("zero is a real coordinate, not a missing one", () => {
    expect(mapLink(0, 0)).not.toBeNull();
  });
});
