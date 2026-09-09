// Explicit, disclosed MODELING ASSUMPTIONS that turn an ocean grid cell's
// depth band into a routing-cost multiplier. None of this is a physical fact
// or an industry-sourced coefficient -- it is a first-order engineering
// approximation (shallow nearshore water = congestion/anchoring/fishing risk
// = harder; mid-depth continental slope/plain = the easiest laying
// conditions; very deep water = specialized cable/higher repair cost =
// harder again), configurable and shown to the user, never presented as a
// measured value. See provenance.ts, which classifies everything derived
// from this table as MODELED.
import type { OceanGrid } from "./oceanGrid";
import { bandDepthM } from "./oceanGrid";
import type { DepthBandRange } from "./routingTypes";

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

/**
 * Cheapest per-km multiplier this table can produce.
 *
 * The A* search needs it: its heuristic has to be a LOWER bound on the true
 * remaining cost, so it must be scaled by the smallest cost a kilometre of
 * route can possibly incur. Derived from the table rather than written as a
 * literal, so editing a band cannot silently break admissibility.
 */
export const MIN_DEPTH_DIFFICULTY_MULTIPLIER = Math.min(...Object.values(DEPTH_DIFFICULTY_MULTIPLIER));

/** Depth-variability contribution to the difficulty index. A route crossing many depth bands is harder to engineer and install consistently than one holding a narrow band at similar mean depth. Thresholds are disclosed modeling assumptions. */
export function depthVariabilityPenalty(depthStdDevM: number): number {
  if (depthStdDevM > 2500) return 0.3;
  if (depthStdDevM > 1000) return 0.15;
  return 0;
}

/**
 * Continuous modeled seabed-difficulty index for a route.
 *
 * This replaces a LOW/MEDIUM/HIGH classifier that returned MEDIUM for every
 * route tested. The classifier's thresholds (<1.15 / <1.50) sat outside the
 * range this index actually occupies for real ocean routes -- measured
 * 1.057-1.212 across nine real city pairs -- so it collapsed a varying
 * signal to a constant, which then propagated into the MCDA (all candidates
 * normalized to 1.000, contributing nothing to ranking) and into the
 * rationale text (every candidate simultaneously claimed "lowest modeled
 * seabed difficulty"). Recalibrating the bin edges would have required
 * inventing thresholds with no external basis; exposing the underlying
 * continuous value instead requires inventing nothing.
 *
 * Lower is better. 1.0 means "no modeled difficulty penalty anywhere along
 * the route".
 */
export function computeDifficultyIndex(
  meanDepthBandMultiplier: number,
  depthStdDevM: number
): { index: number; basis: string } {
  const variability = depthVariabilityPenalty(depthStdDevM);
  const index = meanDepthBandMultiplier + variability;
  return {
    index,
    basis:
      `mean per-band difficulty multiplier ${meanDepthBandMultiplier.toFixed(3)} ` +
      `+ depth-variability term ${variability.toFixed(2)} (band-lower-bound std dev ${Math.round(depthStdDevM).toLocaleString()} m)`,
  };
}

/** Both bounds of a depth band, so the UI can show a range rather than a bare lower bound. */
export function bandRange(grid: OceanGrid, bandIndex: number): DepthBandRange {
  const minDepthM = bandDepthM(grid, bandIndex);
  const next = grid.depthBands.find((b) => b.index === bandIndex + 1);
  const maxDepthM = next ? next.minDepthM : null;
  return {
    index: bandIndex,
    minDepthM,
    maxDepthM,
    label: maxDepthM
      ? `${minDepthM.toLocaleString()}-${maxDepthM.toLocaleString()} m`
      : `>= ${minDepthM.toLocaleString()} m`,
  };
}
