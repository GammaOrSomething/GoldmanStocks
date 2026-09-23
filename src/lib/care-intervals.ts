import type { Plant } from "./types";

/** Days between regular care visits for each kind of plant or area. */
export const intervalByKind: Record<Plant["kind"], number> = {
  Lawn: 7,
  Hedge: 21,
  Tree: 45,
  "Flower bed": 14,
  Shrub: 14,
};
