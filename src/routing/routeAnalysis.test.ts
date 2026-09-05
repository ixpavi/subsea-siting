import { describe, it, expect } from "vitest";
import { computeRouteAnalysis } from "./routeAnalysis";
import type { OceanGrid } from "./oceanGrid";

const TEST_BANDS = [
  { index: 1, minDepthM: 0 },
  { index: 2, minDepthM: 200 },
  { index: 3, minDepthM: 1000 },
  { index: 4, minDepthM: 2000 },
  { index: 5, minDepthM: 3000 },
];

/**
 * Small synthetic grid. `fill` still returns a BAND INDEX, because that is what
 * these tests are about; the grid now stores metres, so each band is written as
 * a depth that lands squarely inside it. Land (band 0) stays 0, which is the
 * grid's land sentinel in both representations.
 *
 * Written mid-band rather than at the band floor so a test cannot pass by
 * accident on a boundary: bandForDepth uses >=, so a floor value would sit on
 * the edge of two bands' semantics.
 */
function makeGrid(fill: (lat: number, lng: number) => number): OceanGrid {
  const resolutionDeg = 1;
  const rows = 180;
  const cols = 360;
  const depthForBand = (band: number): number => {
    if (band <= 0) return 0;
    const here = TEST_BANDS.find((b) => b.index === band);
    if (!here) return 0;
    const next = TEST_BANDS.find((b) => b.index === band + 1);
    // Deepest band has no ceiling; put it a clear margin past its floor.
    if (!next) return here.minDepthM + 500;
    return Math.round((here.minDepthM + next.minDepthM) / 2);
  };

  const depthM = new Int16Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const band = fill(-90 + (r + 0.5) * resolutionDeg, -180 + (c + 0.5) * resolutionDeg);
      depthM[r * cols + c] = depthForBand(band);
    }
  }
  return {
    resolutionDeg,
    rows,
    cols,
    depthBands: TEST_BANDS,
    provenance: "synthetic test grid",
    depthM,
  };
}

describe("computeRouteAnalysis", () => {
  /**
   * Regression cover for the endpoint clamp. Coastal endpoints routinely fall
   * in a land cell at this grid's resolution; the old code clamped them to
   * band 1, injecting a 0m lower bound into the statistics. That alone made
   * "minimum depth" read ">= 0 m" for EVERY route ever generated, presented
   * as a seabed finding.
   */
  it("excludes and counts land-cell samples instead of clamping them to the shallowest band", () => {
    // Land west of 5E, band 5 (>=3000m) east of it.
    const grid = makeGrid((_lat, lng) => (lng < 5 ? 0 : 5));
    const analysis = computeRouteAnalysis(grid, [[0, 0], [0, 30]], null, null);

    expect(analysis.unclassifiedSampleCount).toBeGreaterThan(0);
    expect(analysis.classifiedSampleCount).toBeGreaterThan(0);
    // The only classified band is 5, so the shallowest band crossed must be
    // band 5 -- never band 1 via a clamp.
    expect(analysis.shallowestBand?.index).toBe(5);
    expect(analysis.shallowestBand?.minDepthM).toBe(3000);
    expect(analysis.depthProfile.every((d) => d.depthBandIndex === 5)).toBe(true);
  });

  it("reports depth as a band range with both bounds, not a bare lower bound", () => {
    const grid = makeGrid(() => 3); // 1000-2000m band
    const analysis = computeRouteAnalysis(grid, [[0, 0], [0, 10]], null, null);
    expect(analysis.shallowestBand).toMatchObject({ index: 3, minDepthM: 1000, maxDepthM: 2000 });
    expect(analysis.shallowestBand?.label).toContain("1,000");
    expect(analysis.shallowestBand?.label).toContain("2,000");
  });

  it("leaves the deepest band open-ended rather than inventing an upper bound", () => {
    const grid = makeGrid(() => 5); // deepest band in this synthetic grid
    const analysis = computeRouteAnalysis(grid, [[0, 0], [0, 10]], null, null);
    expect(analysis.deepestBand?.maxDepthM).toBeNull();
    expect(analysis.deepestBand?.label).toMatch(/>=/);
  });

  it("reports unavailable rather than fabricating statistics when no sample is classified", () => {
    const grid = makeGrid(() => 0); // all land
    const analysis = computeRouteAnalysis(grid, [[0, 0], [0, 10]], null, null);
    expect(analysis.classifiedSampleCount).toBe(0);
    expect(analysis.shallowestBand).toBeNull();
    expect(analysis.deepestBand).toBeNull();
    expect(analysis.meanDepthM).toBeNull();
    expect(analysis.dominantDepthBandLabel).toMatch(/unavailable/i);
  });

  it("adds terrestrial access legs to the total but not to the marine distance", () => {
    const grid = makeGrid(() => 3);
    const analysis = computeRouteAnalysis(grid, [[0, 0], [0, 10]], 50, 30);
    expect(analysis.totalDistanceKm).toBeCloseTo(analysis.marineDistanceKm + 80, 6);
  });

  it("produces a difficulty index that varies with the bands actually crossed", () => {
    const shallow = computeRouteAnalysis(makeGrid(() => 1), [[0, 0], [0, 10]], null, null);
    const slope = computeRouteAnalysis(makeGrid(() => 3), [[0, 0], [0, 10]], null, null);
    // Band 1 (nearshore) carries a higher modelled penalty than band 3
    // (continental slope), so the index must distinguish them. A constant
    // here would mean the criterion is inert -- the defect that made the old
    // LOW/MEDIUM/HIGH classifier useless.
    expect(shallow.difficultyIndex).not.toBeCloseTo(slope.difficultyIndex, 3);
    expect(shallow.difficultyIndex).toBeGreaterThan(slope.difficultyIndex);
  });
});
