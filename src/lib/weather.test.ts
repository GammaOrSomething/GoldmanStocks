/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { projects } from "./__fixtures__/week";
import type { Task } from "./types";
import {
  addDays,
  applyWeatherRules,
  localDate,
  openMeteoUrl,
  overnightRainMm,
  planWeekDates,
  splitOpenMeteo,
  pickStripForecast,
  summarizeDay,
  todayIndex,
  toSiteForecast,
  weatherIcon,
  weatherStrip,
  type OpenMeteoSite,
  type SiteForecast,
} from "./weather";

const MON = "2026-09-21";
const WEEK = [MON, "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"];

function forecast(
  rain: Record<string, number> = {},
  tempMax: Record<string, number> = {},
): SiteForecast {
  return {
    hourly: Object.entries(rain).map(([time, precipMm]) => ({
      time,
      precipMm,
    })),
    daily: WEEK.map((date) => ({
      date,
      precipMm: 0,
      tempMaxC: tempMax[date] ?? 12,
      weatherCode: 3,
    })),
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t",
    title: "Watering round",
    projectId: "p1",
    client: "Client",
    site: "Site",
    workerId: "w1",
    day: 0,
    start: 10,
    duration: 2,
    kind: "Watering",
    status: "planned",
    ...overrides,
  };
}

const rainyNight = forecast({ "2026-09-20T22:00": 5, "2026-09-21T02:00": 4 });

describe("dates and readings", () => {
  test("addDays crosses month boundaries", () => {
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  test("overnight window is 18:00 the evening before until 06:00", () => {
    const f = forecast({
      "2026-09-20T17:00": 50, // before the window
      "2026-09-20T18:00": 1,
      "2026-09-21T05:00": 2,
      "2026-09-21T06:00": 50, // after the window
    });
    expect(overnightRainMm(f, MON)).toBe(3);
  });
});

describe("rain rule", () => {
  test("9 mm overnight skips watering with the schedule's note", () => {
    const [out] = applyWeatherRules([task()], { p1: rainyNight }, WEEK);
    expect(out?.status).toBe("skipped");
    expect(out?.weatherNote).toBe("Skipped — 9 mm rain overnight");
  });

  test("2 mm leaves watering alone", () => {
    const f = forecast({ "2026-09-21T01:00": 2 });
    const [out] = applyWeatherRules([task()], { p1: f }, WEEK);
    expect(out?.status).toBe("planned");
    expect(out?.weatherNote).toBeUndefined();
  });

  test("overnight + daytime rain together can skip, with an 'expected' note", () => {
    const f = forecast({ "2026-09-21T01:00": 3, "2026-09-21T12:00": 3 });
    const [out] = applyWeatherRules([task()], { p1: f }, WEEK);
    expect(out?.weatherNote).toBe("Skipped — 6 mm rain expected");
  });

  test("only watering is skipped", () => {
    const [out] = applyWeatherRules(
      [task({ kind: "Mowing" })],
      { p1: rainyNight },
      WEEK,
    );
    expect(out?.status).toBe("planned");
  });

  test("done tasks and approved days are never touched", () => {
    const done = task({ id: "a", status: "done" });
    const approved = task({
      id: "b",
      day: 1,
      approvedAt: "2026-09-18T08:00:00Z",
    });
    const f = forecast({ "2026-09-20T22:00": 9, "2026-09-21T22:00": 9 });
    const out = applyWeatherRules([done, approved], { p1: f }, WEEK);
    expect(out).toEqual([done, approved]);
  });

  test("a stale weather skip is undone when the forecast is dry", () => {
    const stale = task({
      status: "skipped",
      weatherNote: "Skipped — 9 mm rain overnight",
    });
    const [out] = applyWeatherRules([stale], { p1: forecast() }, WEEK);
    expect(out?.status).toBe("planned");
    expect(out?.weatherNote).toBeUndefined();
  });

  test("a stale weather skip is undone when there is no forecast at all", () => {
    const stale = task({
      status: "skipped",
      weatherNote: "Skipped — 9 mm rain overnight",
    });
    const [out] = applyWeatherRules([stale], {}, WEEK);
    expect(out?.status).toBe("planned");
  });

  test("a task the boss skipped by hand stays skipped", () => {
    const manual = task({ status: "skipped" });
    const [out] = applyWeatherRules([manual], { p1: forecast() }, WEEK);
    expect(out?.status).toBe("skipped");
  });

  test("inputs are not mutated", () => {
    const input = task();
    applyWeatherRules([input], { p1: rainyNight }, WEEK);
    expect(input.status).toBe("planned");
  });
});

describe("warm-spell rule", () => {
  const warm = forecast({}, { [MON]: 21 });

  test("clipping moves to the earliest free slot without overlapping", () => {
    const busy = task({ id: "busy", kind: "Mowing", start: 7, duration: 3 }); // 07–10
    const clip = task({ id: "clip", kind: "Clipping", start: 14, duration: 2 });
    const out = applyWeatherRules([busy, clip], { p1: warm }, WEEK);
    const moved = out.find((t) => t.id === "clip");
    expect(moved?.start).toBe(10);
    expect(moved?.weatherNote).toBe("Moved earlier — warm spell");
  });

  test("other workers' tasks don't block the slot", () => {
    const other = task({
      id: "other",
      workerId: "w2",
      kind: "Mowing",
      start: 7,
      duration: 4,
    });
    const clip = task({ id: "clip", kind: "Clipping", start: 14 });
    const out = applyWeatherRules([other, clip], { p1: warm }, WEEK);
    expect(out.find((t) => t.id === "clip")?.start).toBe(7);
  });

  test("tasks already in the morning stay put", () => {
    const [out] = applyWeatherRules(
      [task({ kind: "Clipping", start: 8 })],
      { p1: warm },
      WEEK,
    );
    expect(out?.start).toBe(8);
    expect(out?.weatherNote).toBeUndefined();
  });

  test("a cool day moves nothing", () => {
    const [out] = applyWeatherRules(
      [task({ kind: "Clipping", start: 14 })],
      { p1: forecast() },
      WEEK,
    );
    expect(out?.start).toBe(14);
  });

  test("no free earlier slot means no move", () => {
    const busy = task({ id: "busy", kind: "Mowing", start: 7, duration: 7 }); // 07–14
    const clip = task({ id: "clip", kind: "Clipping", start: 14 });
    const out = applyWeatherRules([busy, clip], { p1: warm }, WEEK);
    expect(out.find((t) => t.id === "clip")?.start).toBe(14);
  });
});

describe("summarizeDay", () => {
  test("counts skips and moves for the day", () => {
    const tasks = [
      task({
        id: "a",
        status: "skipped",
        weatherNote: "Skipped — 9 mm rain overnight",
      }),
      task({
        id: "b",
        status: "skipped",
        weatherNote: "Skipped — 7 mm rain expected",
      }),
      task({
        id: "c",
        kind: "Clipping",
        weatherNote: "Moved earlier — warm spell",
      }),
      task({
        id: "d",
        day: 1,
        status: "skipped",
        weatherNote: "Skipped — 5 mm rain overnight",
      }),
    ];
    expect(summarizeDay(tasks, 0)).toBe(
      "2 watering tasks skipped · 1 job moved earlier — warm",
    );
    expect(summarizeDay(tasks, 2)).toBe("No weather changes");
  });
});

describe("week dates (Europe/Tallinn)", () => {
  test("a Friday sits at index 4 of a Mon–Sun week", () => {
    const fri = new Date("2026-09-18T09:00:00Z");
    expect(planWeekDates(fri)).toEqual([
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
    ]);
    expect(todayIndex(fri)).toBe(4);
  });

  test("Saturday is part of the week it is in, not the start of the next one", () => {
    // The week used to stop on Friday and roll forward here, which left the worker app
    // with nothing to show on a weekend and no way to photograph a job.
    const sat = new Date("2026-09-19T09:00:00Z");
    expect(planWeekDates(sat)[0]).toBe("2026-09-14");
    expect(todayIndex(sat)).toBe(5);
  });

  test("Sunday is the last day of its own week", () => {
    const sun = new Date("2026-09-20T09:00:00Z");
    expect(planWeekDates(sun)[0]).toBe("2026-09-14");
    expect(planWeekDates(sun).at(-1)).toBe("2026-09-20");
    expect(todayIndex(sun)).toBe(6);
  });

  test("uses Tallinn time, not UTC: Sunday 22:30 UTC is already Monday", () => {
    const late = new Date("2026-09-20T22:30:00Z"); // 01:30 Monday in Tallinn
    expect(planWeekDates(late)[0]).toBe("2026-09-21");
    expect(todayIndex(late)).toBe(0);
  });

  test("the week is always seven days, Monday to Sunday", () => {
    for (const iso of [
      "2026-09-14T06:00:00Z",
      "2026-09-18T09:00:00Z",
      "2026-09-19T23:00:00Z",
      "2026-12-31T09:00:00Z",
    ]) {
      const week = planWeekDates(new Date(iso));
      expect(week).toHaveLength(7);
      expect(week[todayIndex(new Date(iso))]).toBe(localDate(new Date(iso)));
    }
  });
});

describe("Open-Meteo mapping", () => {
  const site: OpenMeteoSite = {
    latitude: 59.42,
    longitude: 24.8,
    timezone: "Europe/Tallinn",
    hourly: {
      time: ["2026-09-20T22:00", "2026-09-20T23:00", "2026-09-21T00:00"],
      precipitation: [4.5, null, 4.6],
    },
    daily: {
      time: ["2026-09-21", "2026-09-22"],
      precipitation_sum: [9.1, null],
      temperature_2m_max: [14.8, 15],
      weather_code: [61, 3],
    },
  };

  test("the URL asks for every site in one request", () => {
    const url = new URL(
      openMeteoUrl([
        { lat: 59.42, lng: 24.8 },
        { lat: 56.98, lng: 24.13 },
      ]),
    );
    expect(url.searchParams.get("latitude")).toBe("59.42,56.98");
    expect(url.searchParams.get("longitude")).toBe("24.8,24.13");
    expect(url.searchParams.get("timezone")).toBe("auto");
  });

  test("gaps in the data are dropped, not guessed", () => {
    const f = toSiteForecast(site);
    expect(f.hourly).toEqual([
      { time: "2026-09-20T22:00", precipMm: 4.5 },
      { time: "2026-09-21T00:00", precipMm: 4.6 },
    ]);
    expect(f.daily.map((d) => d.date)).toEqual(["2026-09-21"]);
  });

  test("a single-site response is wrapped; junk is rejected", () => {
    expect(splitOpenMeteo(site)).toEqual([site]);
    expect(splitOpenMeteo([site, site])).toHaveLength(2);
    expect(() => splitOpenMeteo({ error: true, reason: "bad" })).toThrow();
  });

  test("WMO codes map to the three icons", () => {
    expect(weatherIcon(0)).toBe("sun");
    expect(weatherIcon(3)).toBe("cloud");
    expect(weatherIcon(45)).toBe("cloud");
    expect(weatherIcon(61)).toBe("rain");
    expect(weatherIcon(81)).toBe("rain");
    expect(weatherIcon(95)).toBe("rain");
    expect(weatherIcon(73)).toBe("cloud"); // snow
  });

  test("the strip shows real temperatures and 'No forecast' where there is none", () => {
    const strip = weatherStrip(toSiteForecast(site), WEEK, [
      task({ status: "skipped", weatherNote: "Skipped — 9 mm rain overnight" }),
    ]);
    expect(strip[0]).toEqual({
      day: "Mon",
      icon: "rain",
      temp: 15,
      note: "1 watering task skipped",
    });
    expect(strip[1]).toEqual({
      day: "Tue",
      icon: "cloud",
      temp: null,
      note: "No forecast",
    });
  });
});

describe("pickStripForecast", () => {
  const siteForecast = forecast({}, { [MON]: 18 });
  const areaForecast = forecast({}, { [MON]: 11 });

  test("with sites, the strip shows the main city's first site", () => {
    expect(
      pickStripForecast(
        projects,
        { p1: siteForecast },
        { forecast: areaForecast },
      ),
    ).toEqual({ source: "site", forecast: siteForecast });
  });

  test("a site whose forecast is missing is still the site's strip, not the area's", () => {
    expect(pickStripForecast(projects, {}, { forecast: areaForecast })).toEqual(
      {
        source: "site",
        forecast: undefined,
      },
    );
  });

  test("with no sites, the strip shows where the company is based", () => {
    expect(pickStripForecast([], {}, { forecast: areaForecast })).toEqual({
      source: "area",
      forecast: areaForecast,
    });
  });

  test("with neither, there is nothing to show", () => {
    expect(pickStripForecast([], {}, null)).toEqual({
      source: "none",
      forecast: undefined,
    });
  });
});
