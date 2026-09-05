// The shipped depth grid, tested as data rather than as code.
//
// The change this covers replaced band lower bounds with modelled depths. Two
// things had to hold: the depths have to be real (a band grid dressed up in
// metres would pass a type check and fail a reader), and the land/water mask
// has to be untouched, because that is what the router's connectivity depends
// on and it comes from a different source than the depths do.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bandForDepth, depthAt, isOcean, type OceanGrid } from "./oceanGrid";

const DATA = join(process.cwd(), "public", "data");
const meta = JSON.parse(readFileSync(join(DATA, "ocean-depth.json"), "utf-8"));
const bin = readFileSync(join(DATA, meta.binary));
const grid: OceanGrid = {
  ...meta,
  depthM: new Int16Array(bin.buffer, bin.byteOffset, bin.length / 2),
};

/** The band mask the depths were laid onto. Connectivity is defined by this. */
const mask = JSON.parse(readFileSync(join(DATA, "ocean-grid.json"), "utf-8"));

describe("the shipped depth grid", () => {
  it("matches its own metadata", () => {
    expect(grid.depthM.length).toBe(grid.rows * grid.cols);
    expect(bin.length).toBe(grid.rows * grid.cols * 2);
  });

  it("is on exactly the mask's grid, or the two cannot be overlaid", () => {
    expect(grid.resolutionDeg).toBe(mask.resolutionDeg);
    expect(grid.rows).toBe(mask.rows);
    expect(grid.cols).toBe(mask.cols);
  });

  it("agrees with the mask cell for cell on what is land", () => {
    // This is the property that keeps the router's connectivity intact. A
    // single disagreement is a cell the router can or cannot cross.
    let mismatches = 0;
    for (let i = 0; i < grid.depthM.length; i++) {
      const maskWater = mask.data[i] > 0;
      const depthWater = grid.depthM[i] > 0;
      if (maskWater !== depthWater) mismatches++;
    }
    expect(mismatches).toBe(0);
  });
});

describe("depths are real, not bands in disguise", () => {
  it("takes many more distinct values than there are bands", () => {
    const distinct = new Set<number>();
    for (let i = 0; i < grid.depthM.length; i += 7) {
      if (grid.depthM[i] > 0) distinct.add(grid.depthM[i]);
    }
    // 12 bands could produce at most 12 distinct values plus the band-filled
    // coastal cells. Thousands means the depths are the model's, not the
    // classifier's.
    expect(distinct.size).toBeGreaterThan(2000);
  });

  it("does not pile up on the band floors", () => {
    const floors = new Set<number>(mask.depthBands.map((b: { minDepthM: number }) => b.minDepthM));
    let onFloor = 0;
    let water = 0;
    for (let i = 0; i < grid.depthM.length; i++) {
      const d = grid.depthM[i];
      if (d <= 0) continue;
      water++;
      if (floors.has(d)) onFloor++;
    }
    // Coastal and strait-corrected cells legitimately fall back to a band
    // floor, but they must be a small minority rather than the rule.
    expect(onFloor / water).toBeLessThan(0.05);
  });
});

describe("known seabed", () => {
  // Depths are the interpolated value of a ~56 km cell, so these are generous
  // ranges: the point is that the sign and order of magnitude are right and the
  // grid is not transposed or flipped.
  const cases: [string, number, number, number, number][] = [
    ["Mariana Trench", 11.35, 142.2, 5000, 11000],
    ["mid-Atlantic", 30, -40, 2000, 6000],
    ["North Sea shelf", 56, 3, 1, 300],
    ["Bay of Bengal", 15, 88, 1000, 5000],
  ];
  for (const [name, lat, lng, lo, hi] of cases) {
    it(`${name} is between ${lo} and ${hi} m`, () => {
      const d = depthAt(grid, lat, lng);
      expect(d).toBeGreaterThanOrEqual(lo);
      expect(d).toBeLessThanOrEqual(hi);
    });
  }

  const land: [string, number, number][] = [
    ["Sahara", 23, 13],
    ["Himalaya", 28, 87],
    ["Amazon basin", -3, -60],
    ["Antarctic interior", -82, 0],
  ];
  for (const [name, lat, lng] of land) {
    it(`${name} reads as land`, () => {
      expect(depthAt(grid, lat, lng)).toBe(0);
      expect(isOcean(grid, lat, lng)).toBe(false);
    });
  }
});

describe("bandForDepth", () => {
  it("puts land in band 0 and any water in a real band", () => {
    expect(bandForDepth(grid, 0)).toBe(0);
    expect(bandForDepth(grid, -5)).toBe(0);
    expect(bandForDepth(grid, 1)).toBeGreaterThan(0);
  });

  it("is monotonic: deeper never lands in a shallower band", () => {
    let prev = 0;
    for (let d = 1; d <= 11000; d += 37) {
      const band = bandForDepth(grid, d);
      expect(band).toBeGreaterThanOrEqual(prev);
      prev = band;
    }
  });

  it("agrees with the band thresholds it was given", () => {
    for (const b of grid.depthBands) {
      if (b.index === 0) continue;
      // A depth just inside a band's floor must classify at or above it.
      expect(bandForDepth(grid, b.minDepthM + 1)).toBeGreaterThanOrEqual(b.index);
    }
  });
});
