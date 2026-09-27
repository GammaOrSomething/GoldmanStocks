/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import type { Worker } from "./types";
import { accessState } from "./worker-access";

const worker: Worker = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Karl Saar",
  role: "Gardener",
  language: "ET",
  color: "var(--chart-1)",
  email: "karl@alpha.test",
  appRole: "worker",
  hasLogin: false,
};

describe("accessState", () => {
  test("no login yet", () => {
    expect(accessState(worker)).toBe("none");
  });

  test("invited: a login is linked but the link hasn't been opened", () => {
    const invited: Worker = {
      ...worker,
      hasLogin: true,
      invitedAt: "2026-09-27T08:00:00Z",
    };
    expect(accessState(invited)).toBe("invited");
  });

  test("active once the login is confirmed", () => {
    expect(
      accessState({
        ...worker,
        hasLogin: true,
        joinedAt: "2026-09-27T09:00:00Z",
      }),
    ).toBe("active");
  });
});
