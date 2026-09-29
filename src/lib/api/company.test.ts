/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../supabase/types";
import { CompanyAreaInput, updateCompanyArea } from "./company";

/** A stand-in for `db.from("companies").update(…).eq(…).select(…)` that records the call. */
function fakeDb(result: { data: { id: string }[] | null; error: unknown }) {
  const seen: { update?: unknown; eq?: [string, string] } = {};
  const db = {
    from: () => ({
      update: (values: unknown) => {
        seen.update = values;
        return {
          eq: (column: string, value: string) => {
            seen.eq = [column, value];
            return { select: async () => result };
          },
        };
      },
    }),
  } as unknown as SupabaseClient<Database>;
  return { db, seen };
}

describe("CompanyAreaInput", () => {
  test("a city and a point on the globe", () => {
    expect(
      CompanyAreaInput.parse({ city: " Tallinn ", lat: 59.437, lng: 24.7536 }),
    ).toEqual({ city: "Tallinn", lat: 59.437, lng: 24.7536 });
  });

  test("coordinates off the globe are refused", () => {
    expect(
      CompanyAreaInput.safeParse({ city: "X", lat: 91, lng: 0 }).success,
    ).toBe(false);
    expect(
      CompanyAreaInput.safeParse({ city: "X", lat: 0, lng: -181 }).success,
    ).toBe(false);
  });

  test("the city is a short label, and needs to say something", () => {
    expect(
      CompanyAreaInput.safeParse({ city: "", lat: 0, lng: 0 }).success,
    ).toBe(false);
    expect(
      CompanyAreaInput.safeParse({ city: "x".repeat(201), lat: 0, lng: 0 })
        .success,
    ).toBe(false);
  });
});

describe("updateCompanyArea", () => {
  const area = { city: "Tallinn", lat: 59.437, lng: 24.7536 };

  test("writes the area to the caller's own company", async () => {
    const { db, seen } = fakeDb({ data: [{ id: "co" }], error: null });
    await updateCompanyArea(db, "co", area);
    expect(seen.update).toEqual(area);
    expect(seen.eq).toEqual(["id", "co"]);
  });

  test("an update the database refused (no rows) is an error, not a silent no-op", async () => {
    const { db } = fakeDb({ data: [], error: null });
    await expect(updateCompanyArea(db, "co", area)).rejects.toThrow(
      "Only a boss can change this",
    );
  });

  test("a database error is a readable one, without the raw message", async () => {
    const { db } = fakeDb({ data: null, error: { message: "raw detail" } });
    await expect(updateCompanyArea(db, "co", area)).rejects.toThrow(
      "Couldn't save where the company is based. Try again.",
    );
  });
});
