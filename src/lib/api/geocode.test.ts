/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { placeName, toPlace } from "./geocode";

const place = {
  label: "Tallinn, Harju County, Estonia",
  address: "Tallinn",
  street: "Tallinn",
  city: "Tallinn",
  lat: 59.437,
  lng: 24.7536,
};

describe("placeName", () => {
  test("a place goes by its town", () => {
    expect(placeName({ ...place, address: "Valukoja 8, Tallinn" })).toBe(
      "Tallinn",
    );
  });

  test("a place with no town goes by the first part of its address", () => {
    expect(placeName({ ...place, city: "", address: "Kakumäe" })).toBe(
      "Kakumäe",
    );
  });

  test("a very long name is cut to what the company row holds", () => {
    expect(placeName({ ...place, city: "x".repeat(300) })).toHaveLength(200);
  });
});

describe("toPlace", () => {
  test("keeps the street apart from the town, so a form with a town field doesn't repeat it", () => {
    const p = toPlace({
      display_name: "8, Valukoja, Ülemiste, Tallinn, Harju County, Estonia",
      lat: "59.4225",
      lon: "24.7998",
      address: { road: "Valukoja", house_number: "8", city: "Tallinn" },
    });
    expect(p).toEqual({
      label: "8, Valukoja, Ülemiste, Tallinn, Harju County, Estonia",
      address: "Valukoja 8, Tallinn",
      street: "Valukoja 8",
      city: "Tallinn",
      lat: 59.4225,
      lng: 24.7998,
    });
  });

  test("a place with no street goes by the first part of its name", () => {
    const p = toPlace({
      display_name: "Tallinn, Harju County, Estonia",
      lat: "59.437",
      lon: "24.7536",
      address: { city: "Tallinn" },
    });
    expect(p.street).toBe("Tallinn");
    expect(p.city).toBe("Tallinn");
  });
});
