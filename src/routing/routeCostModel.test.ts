import { describe, it, expect } from "vitest";
import { computeCost, DEFAULT_COST_ASSUMPTIONS } from "./routeCostModel";
import type { EnvironmentalAssessment, RouteAnalysis } from "./routingTypes";

const UNAVAILABLE_ENV: EnvironmentalAssessment = { available: false, reason: "no dataset integrated" };

function analysisWith(marineDistanceKm: number, difficultyIndex: number): RouteAnalysis {
  return {
    marineDistanceKm,
    totalDistanceKm: marineDistanceKm,
    depthProfile: [],
    shallowestBand: null,
    deepestBand: null,
    dominantBand: null,
    meanDepthM: null,
    depthStdDevM: 0,
    unclassifiedSampleCount: 0,
    classifiedSampleCount: 1,
    difficultyIndex,
    difficultyIndexBasis: "test",
    dominantDepthBandLabel: "test",
  };
}

describe("computeCost", () => {
  /**
   * Regression cover for cost being an exact affine function of length.
   *
   * The terrain penalty used to come from a three-bin LOW/MEDIUM/HIGH lookup
   * that returned MEDIUM for every route tested, collapsing the whole model to
   * `49,990.5 * km + 13,800,000`. Cost then carried no information beyond
   * length -- measured, normalised cost and normalised length were identical
   * to three decimal places in 9 of 9 candidate rows -- so scoring both
   * double-counted length and buried every other criterion.
   */
  it("distinguishes two routes of identical length but different seabed difficulty", () => {
    const easy = computeCost(analysisWith(5000, 1.05), UNAVAILABLE_ENV);
    const hard = computeCost(analysisWith(5000, 1.35), UNAVAILABLE_ENV);
    expect(hard.totalUsd).toBeGreaterThan(easy.totalUsd);
    expect(hard.terrainPenaltyUsd).toBeGreaterThan(easy.terrainPenaltyUsd);
  });

  it("lets a longer route over easier seabed cost less than a shorter route over harder seabed", () => {
    // The behaviour the fix was for: cost must be able to DISAGREE with
    // length, otherwise it is length wearing a different label. Observed in
    // the real engine -- Mumbai->Singapore's depth-favourable candidate runs
    // 129km further than the shortest yet lands $13.1M cheaper.
    const longerEasier = computeCost(analysisWith(5200, 1.02), UNAVAILABLE_ENV);
    const shorterHarder = computeCost(analysisWith(5000, 1.35), UNAVAILABLE_ENV);
    expect(longerEasier.totalUsd).toBeLessThan(shorterHarder.totalUsd);
  });

  it("is not an affine function of length alone", () => {
    // If cost were `a * km + b`, the marginal rate would be identical for any
    // two routes. Holding length fixed and varying difficulty must move it.
    const a = computeCost(analysisWith(4000, 1.05), UNAVAILABLE_ENV);
    const b = computeCost(analysisWith(4000, 1.30), UNAVAILABLE_ENV);
    expect(a.totalUsd / 4000).not.toBeCloseTo(b.totalUsd / 4000, 2);
  });

  it("applies no terrain penalty at a difficulty index of exactly 1.0", () => {
    const c = computeCost(analysisWith(1000, 1.0), UNAVAILABLE_ENV);
    expect(c.terrainPenaltyUsd).toBeCloseTo(0, 6);
  });

  it("never applies a negative terrain penalty for an index below 1", () => {
    const c = computeCost(analysisWith(1000, 0.8), UNAVAILABLE_ENV);
    expect(c.terrainPenaltyUsd).toBe(0);
  });

  it("charges no environmental penalty while environmental data is unavailable", () => {
    const c = computeCost(analysisWith(5000, 1.2), UNAVAILABLE_ENV);
    expect(c.environmentalPenaltyUsd).toBe(0);
  });

  it("sums its own breakdown", () => {
    const c = computeCost(analysisWith(3000, 1.15), UNAVAILABLE_ENV);
    const subtotal =
      c.lengthCostUsd + c.installationCostUsd + c.terrainPenaltyUsd + c.environmentalPenaltyUsd + c.shoreEndCostUsd;
    expect(c.subtotalUsd).toBeCloseTo(subtotal, 6);
    expect(c.totalUsd).toBeCloseTo(c.subtotalUsd + c.contingencyUsd, 6);
    expect(c.contingencyUsd).toBeCloseTo(c.subtotalUsd * DEFAULT_COST_ASSUMPTIONS.contingencyPct, 6);
  });

  it("counts two shore ends", () => {
    const c = computeCost(analysisWith(1000, 1.1), UNAVAILABLE_ENV);
    expect(c.shoreEndCostUsd).toBe(DEFAULT_COST_ASSUMPTIONS.shoreEndCostUsd * 2);
  });
});
