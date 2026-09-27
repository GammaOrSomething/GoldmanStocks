/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { WorkerColor, WorkerInput } from "./workers";

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

describe("WorkerInput email", () => {
  const base = { name: "Karl Saar", role: "Gardener", language: "ET" };

  test("is trimmed and lowercased", () => {
    const parsed = WorkerInput.parse({ ...base, email: "  Karl@Alpha.TEST " });
    expect(parsed.email).toBe("karl@alpha.test");
  });

  test("empty means none", () => {
    expect(WorkerInput.parse({ ...base, email: "  " }).email).toBe("");
    expect(WorkerInput.parse(base).email).toBeUndefined();
  });

  test("refuses something that isn't an address", () => {
    for (const email of [
      "karl",
      "karl@",
      "a b@c.test",
      `${"x".repeat(320)}@a.test`,
    ])
      expect(WorkerInput.safeParse({ ...base, email }).success).toBe(false);
  });
});
