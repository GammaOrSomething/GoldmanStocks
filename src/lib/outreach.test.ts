/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import {
  estimateValue,
  findOpportunities,
  growthFactor,
  HORIZON_DAYS,
} from "./outreach";
import { clients, plants, projects } from "./__fixtures__/week";
import { addDays, type SiteForecast } from "./weather";

const NOW = new Date("2026-09-18T09:00:00Z"); // Friday
const TODAY = "2026-09-18";

function week(tempMaxC: number): SiteForecast {
  return {
    hourly: [],
    daily: [0, 1, 2, 3, 4, 5, 6].map((i) => ({
      date: `2026-09-${String(18 + i).padStart(2, "0")}`,
      precipMm: 0,
      tempMaxC,
      weatherCode: 1,
    })),
  };
}

describe("growth", () => {
  test("warm weeks speed growth up, cold weeks slow it, no forecast is neutral", () => {
    expect(growthFactor(week(20), TODAY)).toBe(0.8);
    expect(growthFactor(week(8), TODAY)).toBe(1.25);
    expect(growthFactor(week(13), TODAY)).toBe(1);
    expect(growthFactor(undefined, TODAY)).toBe(1);
  });

  test("a repeat job is priced from the contract's per-visit value", () => {
    const p1 = projects.find((p) => p.id === "p1")!; // €2400 / 8 visits = €300
    expect(estimateValue(p1, 2.5)).toBe(750);
  });
});

describe("findOpportunities (sample week)", () => {
  const base = { plants, projects, clients, forecasts: {} };

  test("only hedges and lawns, due within the horizon, one per client site", () => {
    const opps = findOpportunities(base, NOW);
    expect(opps.length).toBeGreaterThan(0);
    for (const o of opps) {
      expect(o.dueDate <= addDays(TODAY, HORIZON_DAYS)).toBe(true);
      expect(o.items.every((i) => /hedge clipping|lawn mowing/.test(i))).toBe(
        true,
      );
    }
    expect(new Set(opps.map((o) => o.projectId)).size).toBe(opps.length);
  });

  test("sorted by value, carrying the contact for the greeting", () => {
    const opps = findOpportunities(base, NOW);
    const values = opps.map((o) => o.value);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    expect(opps[0]?.contact).toBe(
      clients.find((c) => c.id === opps[0]?.clientId)?.contact,
    );
  });

  test("a warm forecast brings due dates forward", () => {
    const cool = findOpportunities(base, NOW).find((o) => o.projectId === "p4");
    const warm = findOpportunities(
      { ...base, forecasts: { p4: week(20) } },
      NOW,
    ).find((o) => o.projectId === "p4");
    expect(warm!.dueDate < cool!.dueDate).toBe(true);
  });

  test("trees and shrubs never produce offers", () => {
    const onlyTrees = plants.filter(
      (p) => p.kind === "Tree" || p.kind === "Shrub",
    );
    expect(findOpportunities({ ...base, plants: onlyTrees }, NOW)).toEqual([]);
  });
});

describe("findOpportunities without a care history", () => {
  const hedge = plants.find((p) => p.id === "PL-0372")!; // hedge at p4
  const base = { projects, clients, forecasts: {} };

  test("a plant with no last care date is due on its scheduled next care", () => {
    const { lastCareDate: _, ...noLast } = hedge;
    const [opp] = findOpportunities(
      { ...base, plants: [{ ...noLast, nextCareDate: "2026-09-25" }] },
      NOW,
    );
    expect(opp?.dueDate).toBe("2026-09-25");
  });

  test("a plant with neither date is left out rather than guessed", () => {
    const { lastCareDate: _, nextCareDate: __, ...noDates } = hedge;
    expect(
      findOpportunities({ ...base, plants: [{ ...noDates }] }, NOW),
    ).toEqual([]);
  });
});
