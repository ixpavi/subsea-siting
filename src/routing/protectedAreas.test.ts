import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assessEnvironmentalWithGrid, type ProtectedAreaGrid } from "./protectedAreas";
import { assessEnvironmental } from "./environmentalConstraints";

/** The real shipped grid, so these test the data as well as the logic. */
const file = JSON.parse(
  readFileSync(join(process.cwd(), "public", "data", "protected-areas.json"), "utf-8")
);
const grid: ProtectedAreaGrid = {
  resolutionDeg: file.resolutionDeg,
  rows: file.rows,
  cols: file.cols,
  marked: new Set<number>(file.markedIndices),
  extent: file.dataExtent,
  provenance: file.provenance,
  resolutionCaveat: file.resolutionCaveat,
  countries: file.countries,
  representedAreas: file.representedAreas,
};

/** A short path centred on a point, as [lat, lng] pairs. */
const pathAt = (lat: number, lng: number, n = 6): [number, number][] =>
  Array.from({ length: n }, (_, i) => [lat, lng + i * 0.02] as [number, number]);

describe("the shipped dataset", () => {
  it("is sparse, not a full array", () => {
    // A dense mask of 6.48M cells would be a multi-megabyte payload of almost
    // no information; the mask is over 99% empty.
    expect(Array.isArray(file.markedIndices)).toBe(true);
    expect(file.data).toBeUndefined();
    expect(file.markedIndices.length).toBeGreaterThan(1000);
    // Over 99% empty, which is why the sparse form matters.
    expect(file.markedIndices.length / (file.rows * file.cols)).toBeLessThan(0.01);
  });

  it("records its extent separately from its contents", () => {
    // The whole coverage rule depends on this: without a declared extent there
    // is no way to distinguish "not protected" from "not known".
    expect(file.dataExtent).toBeDefined();
    expect(file.dataExtent.maxLat).toBeGreaterThan(file.dataExtent.minLat);
    expect(file.dataExtent.maxLng).toBeGreaterThan(file.dataExtent.minLng);
  });

  it("states plainly that it is not the global database", () => {
    expect(file.provenance).toMatch(/European extract/i);
    expect(file.provenance).toMatch(/NOT global/i);
  });

  it("carries a resolution caveat rather than implying a legal boundary", () => {
    expect(file.resolutionCaveat).toMatch(/approximate|not.*boundary/i);
  });
});

describe("the three-outcome coverage rule", () => {
  it("reports UNAVAILABLE outside the data extent", () => {
    // Mid-Pacific: certainly not in a European dataset. The dangerous answer
    // would be "available, 0 km protected", which reads as environmentally
    // clear when nothing whatsoever is known.
    const r = assessEnvironmentalWithGrid(pathAt(-18, -150), grid);
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/outside/i);
    expect(r.penaltyScore).toBeUndefined();
  });

  it("does not describe missing data as an absence of constraints", () => {
    const r = assessEnvironmentalWithGrid(pathAt(-18, -150), grid);
    expect(r.reason).not.toMatch(/no constraints found/i);
    expect(r.reason).toMatch(/UNAVAILABLE|misrepresent/i);
  });

  it("reports AVAILABLE with a score inside the extent", () => {
    // North Sea, comfortably inside the European extent.
    const r = assessEnvironmentalWithGrid(pathAt(54.0, 3.0), grid);
    expect(r.available).toBe(true);
    expect(typeof r.penaltyScore).toBe("number");
    expect(r.penaltyScore).toBeGreaterThanOrEqual(0);
    expect(r.penaltyScore).toBeLessThanOrEqual(1);
  });

  it("refuses to score a route only partly inside the extent", () => {
    // Runs from inside European coverage out into the open Atlantic. Scoring
    // the covered half would let the unknown half pass as clear.
    const half: [number, number][] = [];
    for (let i = 0; i < 20; i++) half.push([45, -30 - i * 3]);
    const r = assessEnvironmentalWithGrid(half, grid);
    expect(r.available).toBe(false);
  });
});

describe("scoring inside coverage", () => {
  it("finds protected water somewhere in the dataset", () => {
    // Sanity: if no sampled location ever intersects a marked cell, the grid
    // is not doing anything and every other test here is vacuous.
    let found = false;
    for (const [lat, lng] of [
      [54.0, 8.0], [53.5, 6.5], [55.5, 8.2], [51.5, 3.5],
      [57.0, 8.0], [56.0, 11.0], [58.0, 11.0], [50.8, -1.2],
    ] as [number, number][]) {
      const r = assessEnvironmentalWithGrid(pathAt(lat, lng, 10), grid);
      if (r.available && (r.penaltyScore ?? 0) > 0) { found = true; break; }
    }
    expect(found).toBe(true);
  });

  it("keeps the penalty a share of route length, not an absolute distance", () => {
    // The MCDA normalises across candidates of different lengths, so an
    // absolute km figure would systematically penalise longer routes.
    const short = assessEnvironmentalWithGrid(pathAt(54.0, 3.0, 4), grid);
    const long = assessEnvironmentalWithGrid(pathAt(54.0, 3.0, 40), grid);
    for (const r of [short, long]) {
      if (r.available) expect(r.penaltyScore).toBeLessThanOrEqual(1);
    }
  });

  it("counts a run of protected samples as one crossing, not many", () => {
    const r = assessEnvironmentalWithGrid(pathAt(54.0, 8.0, 30), grid);
    if (r.available && (r.affectedZoneCount ?? 0) > 0) {
      expect(r.affectedZoneCount).toBeLessThan(30);
    }
  });

  it("never claims to be a legal boundary", () => {
    const r = assessEnvironmentalWithGrid(pathAt(54.0, 3.0), grid);
    if (r.available) {
      expect(r.reason).toMatch(/not a legal boundary|PROXIMITY/i);
    }
  });
});

describe("assessEnvironmental fallback", () => {
  it("returns unavailable when the grid is absent", () => {
    // A failed dataset load must degrade this one criterion, never fabricate
    // a clear result or fail the whole route.
    const r = assessEnvironmental(pathAt(54.0, 3.0), null);
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/could not be loaded/i);
    // The message may mention the phrase, but only to disclaim it -- what must
    // never appear is a bare assertion that no constraints were found.
    expect(r.reason).toMatch(/not as "no constraints found\."/i);
  });

  it("delegates to the grid when one is present", () => {
    const r = assessEnvironmental(pathAt(54.0, 3.0), grid);
    expect(r.available).toBe(true);
  });

  it("handles a degenerate path without throwing", () => {
    expect(assessEnvironmental([], grid).available).toBe(false);
    expect(assessEnvironmental([[54, 3]], grid).available).toBe(false);
  });
});
