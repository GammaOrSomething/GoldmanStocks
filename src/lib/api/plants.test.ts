/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { PlantInput } from "./plants";

const COMPANY = "0b4f3d2e-8a41-4c1e-9d1f-2f6a1c9e7b10";

const plant = {
  projectId: "7c1d9e2a-3b4f-4a5e-8c6d-1e2f3a4b5c6d",
  common: "Silver birch",
  species: "Betula pendula",
  kind: "Tree",
  site: "North courtyard",
  status: "healthy",
  nextTask: "",
  nextCareDate: "",
} as const;

describe("PlantInput photoPath", () => {
  test("is optional", () => {
    expect(PlantInput.safeParse(plant).success).toBe(true);
  });

  test("accepts a picture in a company's plants folder", () => {
    const photoPath = `${COMPANY}/plants/5d6e7f80-1a2b-4c3d-9e4f-5a6b7c8d9e0f.jpg`;
    expect(PlantInput.safeParse({ ...plant, photoPath }).success).toBe(true);
  });

  test("refuses task proof, other folders, odd names and file types", () => {
    for (const photoPath of [
      `${COMPANY}/tasks/5d6e7f80-1a2b-4c3d-9e4f-5a6b7c8d9e0f/a.jpg`,
      `plants/pending/a.jpg`,
      `${COMPANY}/plants/../a.jpg`,
      `${COMPANY}/plants/a.html`,
      `${COMPANY}/plants/.jpg`,
      `${COMPANY}/plants/a.jpg/b.jpg`,
    ]) {
      expect(PlantInput.safeParse({ ...plant, photoPath }).success).toBe(false);
    }
  });
});
