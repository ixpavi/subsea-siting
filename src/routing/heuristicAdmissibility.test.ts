// The A* heuristic must never exceed the true remaining cost, or the search
// is not guaranteed to return the optimum for its own cost function -- and
// this engine's `closed` set never reopens a node, which is only sound for a
// consistent heuristic.
//
// The diverse-corridor profile multiplies distance by corridorDiversityFactor,
// which ramps down to 0.70, so a kilometre can cost less than a kilometre. An
// unscaled great-circle heuristic overestimated by up to 43%.
import { describe, expect, it } from "vitest";
import { ROUTING_PROFILES, corridorDiversityFactor } from "./routeCandidates";
import { DEPTH_DIFFICULTY_MULTIPLIER, MIN_DEPTH_DIFFICULTY_MULTIPLIER } from "./marineCostSurface";
import type { CableProximityIndex } from "./cableProximityIndex";

/** A one-kilometre step, so edgeCost reads directly as cost-per-km. */
const ONE_KM_LAT = 1 / 110.574;

describe("A* heuristic admissibility", () => {
  it("derives the depth floor from the table rather than a literal", () => {
    expect(MIN_DEPTH_DIFFICULTY_MULTIPLIER).toBe(Math.min(...Object.values(DEPTH_DIFFICULTY_MULTIPLIER)));
  });

  it("every profile declares a floor no greater than any cost it can charge", () => {
    // An empty index: nearestCableDistanceKm then returns its
    // no-cable-nearby sentinel, which is the maximum-diversity case and so
    // the cheapest edge the diverse-corridor profile can produce.
    const emptyIndex: CableProximityIndex = { buckets: new Map(), queryCache: new Map() };

    for (const profile of ROUTING_PROFILES) {
      for (const band of Object.keys(DEPTH_DIFFICULTY_MULTIPLIER).map(Number)) {
        const cost = profile.edgeCost(
          // The grid argument is unused by every profile's edgeCost.
          null as never,
          emptyIndex,
          0,
          0,
          ONE_KM_LAT,
          0,
          band
        );
        expect(
          profile.minCostPerKm,
          `${profile.id} at band ${band}: floor ${profile.minCostPerKm} exceeds actual cost ${cost}`
        ).toBeLessThanOrEqual(cost + 1e-9);
      }
    }
  });

  it("the diverse-corridor floor is genuinely below 1, which is why scaling is needed", () => {
    const diverse = ROUTING_PROFILES.find((p) => p.id === "diverse-corridor")!;
    expect(diverse.minCostPerKm).toBeLessThan(1);
    // An unscaled heuristic would have charged 1.0/km against this floor.
    expect(1 / diverse.minCostPerKm).toBeGreaterThan(1.4);
  });

  it("corridorDiversityFactor stays inside its documented ramp", () => {
    expect(corridorDiversityFactor(0)).toBeCloseTo(1.15, 10);
    expect(corridorDiversityFactor(765)).toBeCloseTo(0.7, 10);
    expect(corridorDiversityFactor(10_000)).toBeCloseTo(0.7, 10);
  });
});
