// Fault exposure: fishing gear and anchors break most cables, and only where
// they can reach the seabed. These tests pin the three rules that make the
// number honest: depth decides whether busy water is a hazard, a route outside
// the data is unavailable rather than quiet, and a missing dataset degrades
// only this criterion.
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assessFaultExposure, type MaritimeActivityGrid } from "./maritimeActivity";
import { runHypotheticalRouting } from "./hypotheticalRouting";
import type { OceanGrid } from "./oceanGrid";
import type { CableFeature, LandingPoint } from "../types";

const DATA = join(process.cwd(), "public", "data");

/** A synthetic ocean of uniform depth. */
function oceanOfDepth(depthM: number): OceanGrid {
  return {
    resolutionDeg: 0.5,
    rows: 360,
    cols: 720,
    depthBands: [],
    provenance: "test",
    depthM: new Int16Array(360 * 720).fill(depthM),
  };
}

/** A synthetic activity grid over 40-50N, 0-10E where every cell has one class. */
function activity(fishing: number, shipping: number): MaritimeActivityGrid {
  const rows = 40;
  const cols = 40;
  return {
    resolutionDeg: 0.25,
    rows,
    cols,
    extent: { minLat: 40, maxLat: 50, minLng: 0, maxLng: 10 },
    fishing: new Uint8Array(rows * cols).fill(fishing),
    shipping: new Uint8Array(rows * cols).fill(shipping),
    year: 2024,
  };
}

const INSIDE: [number, number][][] = [[[44, 2], [44, 6]]];

describe("assessFaultExposure", () => {
  it("counts busy water on the shelf as exposed", () => {
    const r = assessFaultExposure(INSIDE, activity(3, 3), oceanOfDepth(80));
    expect(r.available).toBe(true);
    expect(r.share).toBeCloseTo(1, 6);
    expect(r.fishingKm).toBeGreaterThan(0);
    expect(r.anchoringKm).toBeGreaterThan(0);
  });

  it("does not count busy water over the deep ocean -- gear and anchors cannot reach the cable", () => {
    const r = assessFaultExposure(INSIDE, activity(3, 3), oceanOfDepth(4000));
    expect(r.available).toBe(true);
    expect(r.share).toBe(0);
  });

  it("counts fishing down to 1,000 m but anchoring only down to 200 m", () => {
    const r = assessFaultExposure(INSIDE, activity(3, 3), oceanOfDepth(600));
    expect(r.fishingKm).toBeGreaterThan(0);
    expect(r.anchoringKm).toBe(0);
  });

  it("does not count quiet water", () => {
    const r = assessFaultExposure(INSIDE, activity(1, 1), oceanOfDepth(80));
    expect(r.share).toBe(0);
  });

  it("reports a route outside the data as unavailable, never as quiet", () => {
    const outside: [number, number][][] = [[[44, 2], [44, 20]]];
    const r = assessFaultExposure(outside, activity(1, 1), oceanOfDepth(80));
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/European waters only/i);
  });

  it("treats a no-data cell inside the grid as uncovered", () => {
    const r = assessFaultExposure(INSIDE, activity(0, 0), oceanOfDepth(80));
    expect(r.available).toBe(false);
  });

  it("degrades to unavailable when the dataset failed to load", () => {
    const r = assessFaultExposure(INSIDE, null, oceanOfDepth(80));
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/could not be loaded/i);
  });
});

describe("fault exposure on real routes", () => {
  let grid: OceanGrid;
  let cables: CableFeature[];
  let landingPoints: LandingPoint[];
  let maritimeActivity: MaritimeActivityGrid;

  beforeAll(() => {
    const meta = JSON.parse(readFileSync(join(DATA, "ocean-depth.json"), "utf-8"));
    const bin = readFileSync(join(DATA, meta.binary));
    grid = { ...meta, depthM: new Int16Array(bin.buffer, bin.byteOffset, bin.length / 2) };
    cables = JSON.parse(readFileSync(join(DATA, "cables.json"), "utf-8"));
    landingPoints = JSON.parse(readFileSync(join(DATA, "landing-points.json"), "utf-8"));
    const m = JSON.parse(readFileSync(join(DATA, "maritime-activity.json"), "utf-8"));
    const mb = readFileSync(join(DATA, m.binary));
    const n = m.rows * m.cols;
    maritimeActivity = {
      resolutionDeg: m.resolutionDeg,
      rows: m.rows,
      cols: m.cols,
      extent: m.extent,
      fishing: new Uint8Array(mb.buffer, mb.byteOffset, n),
      shipping: new Uint8Array(mb.buffer, mb.byteOffset + n, n),
      year: m.source.year,
    };
  });

  const route = (from: [number, number], to: [number, number]) =>
    runHypotheticalRouting({
      sourceLat: from[0], sourceLng: from[1], sourceLabel: "A",
      destLat: to[0], destLng: to[1], destLabel: "B",
      cables, landingPoints, grid, maritimeActivity,
    });

  it("scores a Mediterranean route and ranks on it", () => {
    const r = route([43.2965, 5.3698], [38.7223, -9.1393]); // Marseille -> Lisbon
    for (const rc of r.candidates) {
      expect(rc.candidate.faultExposure.available).toBe(true);
      expect(rc.candidate.faultExposure.share!).toBeGreaterThanOrEqual(0);
      expect(rc.candidate.faultExposure.share!).toBeLessThanOrEqual(1);
    }
    expect(r.criteria.find((c) => c.id === "faultExposure")!.available).toBe(true);
  }, 120_000);

  it("reports a route outside European waters as unavailable, and leaves it out of the ranking", () => {
    const r = route([13.0837, 80.2702], [1.3571, 103.8195]); // Chennai -> Singapore
    for (const rc of r.candidates) expect(rc.candidate.faultExposure.available).toBe(false);
    const c = r.criteria.find((x) => x.id === "faultExposure")!;
    expect(c.available).toBe(false);
    expect(c.effectiveWeightShare).toBe(0);
  }, 120_000);
});
