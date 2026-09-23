/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { WorkerColor } from "./workers";

describe("WorkerColor", () => {
  test("accepts the palette and hex colours", () => {
    for (const color of ["var(--chart-1)", "var(--chart-5)", "#3a7d44"])
      expect(WorkerColor.safeParse(color).success).toBe(true);
  });

  test("refuses anything that could do more than colour a dot", () => {
    for (const color of [
      "url(https://x.test/p)",
      "var(--chart-6)",
      "red;background:url(x)",
      "#3a7d44 url(x)",
      "",
    ])
      expect(WorkerColor.safeParse(color).success).toBe(false);
  });
});
