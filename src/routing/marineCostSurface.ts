// Explicit, disclosed MODELING ASSUMPTIONS that turn an ocean grid cell's
// depth band into a routing-cost multiplier. None of this is a physical
// fact or an industry-sourced coefficient -- it is a first-order engineering
// approximation (shallow nearshore water = congestion/anchoring/fishing
// risk = harder; mid-depth continental slope/plain = the easiest laying
// conditions; very deep water = specialized cable/higher repair cost =
// harder again), configurable and shown to the user, never presented as a
// measured value. See routeCostModel.ts for where the same difficulty
// classification feeds the cost estimate.
import type { SeabedDifficulty } from "./routingTypes";

/** Depth-band index -> routing-cost multiplier. Band 0 (land) is never routed through. */
export const DEPTH_DIFFICULTY_MULTIPLIER: Record<number, number> = {
  1: 1.35, // >=0m (nearshore/shelf) -- congestion, anchoring, fishing-gear risk
  2: 1.05, // >=200m
  3: 1.0, // >=1000m -- continental slope, generally favorable
  4: 1.0, // >=2000m
  5: 1.05, // >=3000m -- abyssal plain, favorable but further from repair bases
  6: 1.15, // >=4000m
  7: 1.25, // >=5000m
  8: 1.4, // >=6000m
  9: 1.65, // >=7000m
  10: 1.9, // >=8000m
  11: 2.2, // >=9000m -- trench-class depth, extreme repair difficulty
  12: 2.5, // >=10000m
};

export function depthDifficultyMultiplier(bandIndex: number): number {
  return DEPTH_DIFFICULTY_MULTIPLIER[bandIndex] ?? 1.5;
}

/** Maps a route's depth statistics to a coarse LOW/MEDIUM/HIGH label with a disclosed, fixed threshold basis. */
export function classifySeabedDifficulty(meanDepthBandMultiplier: number, depthStdDevM: number): {
  difficulty: SeabedDifficulty;
  basis: string;
} {
  // Combines average difficulty multiplier (depth-band mix) with variability
  // (a route crossing many depth bands is harder to engineer/install
  // consistently than one that stays in a narrow band, even at similar mean
  // depth) -- both fixed, disclosed thresholds.
  const variabilityPenalty = depthStdDevM > 2500 ? 0.3 : depthStdDevM > 1000 ? 0.15 : 0;
  const combined = meanDepthBandMultiplier + variabilityPenalty;
  if (combined < 1.15) {
    return { difficulty: "LOW", basis: `combined depth/variability index ${combined.toFixed(2)} (< 1.15)` };
  }
  if (combined < 1.5) {
    return { difficulty: "MEDIUM", basis: `combined depth/variability index ${combined.toFixed(2)} (1.15-1.50)` };
  }
  return { difficulty: "HIGH", basis: `combined depth/variability index ${combined.toFixed(2)} (>= 1.50)` };
}
