import type { PlantStatus } from "./types";

/** Display labels shared by every screen. */

/** Plan-week day labels; a task's `day` indexes into this (0 = Monday, 6 = Sunday). */
export const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const statusLabel: Record<PlantStatus, string> = {
  healthy: "Healthy",
  attention: "Needs attention",
  critical: "Critical",
};
