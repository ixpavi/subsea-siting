import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runHypotheticalRouting, buildCriterion } from "./hypotheticalRouting";
import type { OceanGrid } from "./oceanGrid";
import type { RouteEngineResult } from "./routingTypes";
import type { CableFeature, LandingPoint } from "../types";

/**
 * Integration cover, run against the REAL shipped datasets rather than
 * fixtures. These are the invariants that were verified by hand after every
 * change to the engine; encoding them here is what stops the next change from
 * quietly undoing one.
 */
const DATA = join(process.cwd(), "public", "data");

let grid: OceanGrid;
let cables: CableFeature[];
let landingPoints: LandingPoint[];
let chennaiToSingapore: RouteEngineResult;

beforeAll(() => {
  const raw = JSON.parse(readFileSync(join(DATA, "ocean-grid.json"), "utf-8"));
  grid = { ...raw, data: new Uint8Array(raw.data) };
  cables = JSON.parse(readFileSync(join(DATA, "cables.json"), "utf-8"));
  landingPoints = JSON.parse(readFileSync(join(DATA, "landing-points.json"), "utf-8"));

  chennaiToSingapore = runHypotheticalRouting({
    sourceLat: 13.0837, sourceLng: 80.2702, sourceLabel: "Chennai",
    destLat: 1.3571, destLng: 103.8195, destLabel: "Singapore",
    cables, landingPoints, grid,
  });
}, 120_000);

/**
 * Direct cover for the tie-handling rule. Live candidates never produce
 * exactly equal criterion values, so the integration tests below cannot
 * exercise this -- yet a tie is exactly what made every candidate
 * simultaneously claim "the lowest modeled seabed difficulty" when the old
 * classifier binned them all to MEDIUM.
 */
describe("buildCriterion tie handling", () => {
  it("awards no winner when the best value is shared", () => {
    const c = buildCriterion("seabedDifficulty", [1.2, 1.2, 1.5], false, 1, true);
    expect(c.discriminates).toBe(true); // it does separate the third candidate
    expect(c.uniqueWinner).toBeNull(); // but the leaders tie, so neither may claim it
  });

  it("awards the winner when the best value is unique", () => {
    const c = buildCriterion("seabedDifficulty", [1.1, 1.2, 1.5], false, 1, true);
    expect(c.uniqueWinner).toBe(0);
  });

  it("does not discriminate when every candidate is identical", () => {
    // The exact shape of the old bug: all MEDIUM.
    const c = buildCriterion("seabedDifficulty", [1.3, 1.3, 1.3], false, 1, true);
    expect(c.discriminates).toBe(false);
    expect(c.uniqueWinner).toBeNull();
  });

  it("respects direction -- higher is better for resilience", () => {
    const c = buildCriterion("resilience", [0.1, 0.9, 0.4], true, 1, true);
    expect(c.uniqueWinner).toBe(1);
  });

  it("never discriminates when the criterion has no data behind it", () => {
    const c = buildCriterion("environmental", [1, 0.5, 0.2], true, 1, false);
    expect(c.discriminates).toBe(false);
    expect(c.uniqueWinner).toBeNull();
  });

  it("never discriminates at zero weight", () => {
    const c = buildCriterion("length", [100, 200, 300], false, 0, true);
    expect(c.discriminates).toBe(false);
    expect(c.uniqueWinner).toBeNull();
  });
});

describe("runHypotheticalRouting (real data)", () => {
  it("produces candidate routes between two real coastal cities", () => {
    expect(chennaiToSingapore.unavailableReason).toBeNull();
    expect(chennaiToSingapore.candidates.length).toBeGreaterThan(1);
  });

  it("is deterministic -- identical inputs give identical output", () => {
    const again = runHypotheticalRouting({
      sourceLat: 13.0837, sourceLng: 80.2702, sourceLabel: "Chennai",
      destLat: 1.3571, destLng: 103.8195, destLabel: "Singapore",
      cables, landingPoints, grid,
    });
    expect(again.candidates.map((c) => [c.candidate.id, c.rank, c.score])).toEqual(
      chennaiToSingapore.candidates.map((c) => [c.candidate.id, c.rank, c.score])
    );
  }, 120_000);

  it("never routes a marine path across land", () => {
    // Every vertex of every candidate must sit in a classified ocean cell.
    // Endpoints are snapped to real landing points, which legitimately sit on
    // the coast, so they are exempt.
    const bandAt = (lat: number, lng: number) => {
      const row = Math.min(grid.rows - 1, Math.max(0, Math.floor((lat + 90) / grid.resolutionDeg)));
      const wrapped = (((lng + 180) % 360) + 360) % 360 - 180;
      const col = Math.min(grid.cols - 1, Math.max(0, Math.floor((wrapped + 180) / grid.resolutionDeg)));
      return grid.data[row * grid.cols + col];
    };
    let interiorChecked = 0;
    for (const rc of chennaiToSingapore.candidates) {
      const interior = rc.candidate.path.slice(1, -1);
      for (const [lat, lng] of interior) {
        expect(bandAt(lat, lng)).toBeGreaterThan(0);
        interiorChecked++;
      }
    }
    // Guards against the assertion above passing vacuously on empty paths.
    expect(interiorChecked).toBeGreaterThan(0);
  });

  it("computes plausible marine distances for a known city pair", () => {
    // Chennai to Singapore is roughly 3,000-3,500km by sea around Sri Lanka
    // and through the Malacca approaches. A wildly different figure means the
    // grid, the endpoints or the path assembly has broken.
    for (const rc of chennaiToSingapore.candidates) {
      expect(rc.candidate.analysis.marineDistanceKm).toBeGreaterThan(2500);
      expect(rc.candidate.analysis.marineDistanceKm).toBeLessThan(5000);
      expect(rc.candidate.path.length).toBeGreaterThanOrEqual(2);
    }
  });

  /**
   * Regression cover for vacuous rationale. The old classifier tied every
   * candidate at MEDIUM, so `isBestOf` matched all of them and EVERY
   * candidate -- including the last-ranked -- asserted it had "the lowest
   * modeled seabed difficulty".
   */
  it("only lets a candidate claim a criterion it uniquely wins", () => {
    const valueOf = (rc: RouteEngineResult["candidates"][number], id: string): number => {
      if (id === "length") return rc.candidate.analysis.totalDistanceKm;
      if (id === "seabedDifficulty") return rc.candidate.analysis.difficultyIndex;
      if (id === "resilience") return rc.candidate.resilience.diversityScore;
      return NaN; // environmental is unavailable and must never be claimed
    };

    for (const rc of chennaiToSingapore.candidates) {
      for (const id of rc.winsOn) {
        expect(id).not.toBe("environmental");
        const mine = valueOf(rc, id);
        const all = chennaiToSingapore.candidates.map((c) => valueOf(c, id));
        // Strictly unique: a value shared with another candidate does not
        // distinguish this one, so it must not be cited as a reason.
        expect(all.filter((v) => v === mine)).toHaveLength(1);
        // And it must genuinely be the best, in the right direction.
        const best = id === "resilience" ? Math.max(...all) : Math.min(...all);
        expect(mine).toBe(best);
      }
    }
  });

  it("never writes a rationale citing a criterion the candidate does not win", () => {
    for (const rc of chennaiToSingapore.candidates) {
      if (rc.winsOn.includes("seabedDifficulty")) continue;
      // The exact vacuous phrase the old classifier produced for every
      // candidate simultaneously.
      expect(rc.whyText).not.toMatch(/best modeled seabed difficulty/i);
    }
  });

  it("excludes criteria that do not discriminate from the weighted score", () => {
    for (const c of chennaiToSingapore.criteria) {
      if (!c.discriminates) expect(c.effectiveWeightShare).toBe(0);
    }
    const active = chennaiToSingapore.criteria.filter((c) => c.discriminates);
    if (active.length > 0) {
      const total = active.reduce((a, c) => a + c.effectiveWeightShare, 0);
      expect(total).toBeCloseTo(1, 6);
    }
  });

  it("reports environmental analysis as unavailable rather than as no constraints", () => {
    for (const rc of chennaiToSingapore.candidates) {
      expect(rc.candidate.environmental.available).toBe(false);
      expect(rc.candidate.environmental.reason).toMatch(/not.*integrated|unavailable/i);
    }
    const env = chennaiToSingapore.criteria.find((c) => c.id === "environmental");
    expect(env?.available).toBe(false);
    expect(env?.effectiveWeightShare).toBe(0);
  });

  it("derives the degeneracy threshold from the grid's own resolution", () => {
    expect(chennaiToSingapore.separationThresholdKm).toBeCloseTo(grid.resolutionDeg * 111.32, 3);
  });

  it("keeps degenerate candidates in the result rather than silently dropping them", () => {
    for (const pair of chennaiToSingapore.degeneratePairs) {
      expect(pair.meanSeparationKm).toBeLessThan(chennaiToSingapore.separationThresholdKm);
      expect(chennaiToSingapore.candidates.some((c) => c.candidate.id === pair.a)).toBe(true);
      expect(chennaiToSingapore.candidates.some((c) => c.candidate.id === pair.b)).toBe(true);
    }
  });

  it("ranks candidates by score, best first, with rank 1 recommended", () => {
    const cands = chennaiToSingapore.candidates;
    for (let i = 1; i < cands.length; i++) expect(cands[i - 1].score).toBeGreaterThanOrEqual(cands[i].score);
    expect(cands[0].rank).toBe(1);
    expect(cands[0].isRecommended).toBe(true);
    expect(cands.slice(1).every((c) => !c.isRecommended)).toBe(true);
  });

  it("resolves a real landing point as the marine access for a coastal city", () => {
    expect(chennaiToSingapore.sourceEndpoint.kind).toBe("real-landing-point");
    expect(chennaiToSingapore.sourceEndpoint.landingPointName).toBeTruthy();
    expect(chennaiToSingapore.sourceEndpoint.terrestrialAccessKm).toBeLessThan(120);
  });

  it("falls back to a MODELED access point for an inland site, and says so", () => {
    const inland = runHypotheticalRouting({
      sourceLat: 17.385, sourceLng: 78.4867, sourceLabel: "Hyderabad",
      destLat: 1.3571, destLng: 103.8195, destLabel: "Singapore",
      cables, landingPoints, grid,
    });
    expect(inland.sourceEndpoint.kind).toBe("modeled-access-point");
    expect(inland.sourceEndpoint.landingPointName).toBeNull();
    expect(inland.sourceEndpoint.note).toMatch(/not a surveyed or verified/i);
  }, 120_000);
});
