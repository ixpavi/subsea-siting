// The routing engine hands assessEnvironmentalWithGrid the RDP-SIMPLIFIED
// candidate path (hypotheticalRouting.ts), whose segments run for hundreds of
// kilometres across open water. The assessment attributes a whole segment to
// the one ~11 km cell containing its midpoint, so a protected area crossed
// anywhere other than the midpoint was reported as no exposure at all --
// missing detection presented as environmental safety, which is the one thing
// this module's header says must never happen.
//
// Every pre-existing test built paths at 0.02 deg (~1.3 km) spacing, i.e.
// already densified, so none of them could see this.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assessEnvironmentalWithGrid, type ProtectedAreaGrid } from "./protectedAreas";

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

const isMarked = (lat: number, lng: number) => {
  const row = Math.floor((lat + 90) / grid.resolutionDeg);
  const col = Math.floor((lng + 180) / grid.resolutionDeg);
  return grid.marked.has(row * grid.cols + col);
};
const inExtent = (lat: number, lng: number) =>
  lat >= grid.extent.minLat &&
  lat <= grid.extent.maxLat &&
  lng >= grid.extent.minLng &&
  lng <= grid.extent.maxLng;

/**
 * A two-vertex segment that starts on a real protected cell and runs ~3 deg
 * east, chosen so its MIDPOINT is not protected -- the exact shape the
 * midpoint-only walk was blind to.
 */
function findCoarseCrossingSegment(): { path: [number, number][]; midLat: number; midLng: number } | null {
  const half = grid.resolutionDeg / 2;
  for (const index of file.markedIndices as number[]) {
    const row = Math.floor(index / grid.cols);
    const col = index % grid.cols;
    const lat = -90 + row * grid.resolutionDeg + half;
    const lng = -180 + col * grid.resolutionDeg + half;

    const endLng = lng + 3;
    const midLng = lng + 1.5;
    if (!inExtent(lat, lng) || !inExtent(lat, endLng)) continue;
    // The whole point: the midpoint must be unprotected, and the far end too,
    // so only the start of the segment carries the exposure.
    if (isMarked(lat, midLng) || isMarked(lat, endLng)) continue;
    return {
      path: [
        [lat, lng],
        [lat, endLng],
      ],
      midLat: lat,
      midLng,
    };
  }
  return null;
}

describe("protected-area exposure on a coarse (simplified) route", () => {
  const found = findCoarseCrossingSegment();

  it("the shipped grid contains a segment shaped like the failure case", () => {
    expect(found).not.toBeNull();
  });

  it("detects a protected area a long segment crosses away from its midpoint", () => {
    const { path, midLat, midLng } = found!;
    // Precondition: midpoint-only sampling sees nothing here.
    expect(isMarked(midLat, midLng)).toBe(false);

    const r = assessEnvironmentalWithGrid(path, grid);
    expect(r.available).toBe(true);
    // Before densification this was 0 km / 0 zones -- reported to the user as
    // "no protected water on this route".
    expect(r.constrainedDistanceKm ?? 0).toBeGreaterThan(0);
    expect(r.affectedZoneCount ?? 0).toBeGreaterThan(0);
  });

  it("still reports genuinely clear water as clear", () => {
    // Open Atlantic inside the dataset extent, no protected cells.
    const clear: [number, number][] = [
      [45.0, -20.0],
      [45.0, -17.0],
    ];
    const r = assessEnvironmentalWithGrid(clear, grid);
    if (r.available) {
      expect(r.constrainedDistanceKm ?? 0).toBe(0);
    }
  });

  it("does not let a long segment leave the data extent unnoticed", () => {
    // Both endpoints sit inside the European extract, but the straight line
    // between them runs far outside it. Vertex-only coverage counted this as
    // fully covered; the densified path sees the excursion and reports the
    // assessment unavailable rather than scoring the covered fraction.
    const e = grid.extent;
    const path: [number, number][] = [
      [e.minLat + 0.5, e.minLng + 0.5],
      [e.minLat + 0.5, e.maxLng - 0.5],
    ];
    const r = assessEnvironmentalWithGrid(path, grid);
    // Whatever the verdict, it must not silently claim clear water it never
    // actually checked.
    if (!r.available) expect(r.reason).toMatch(/outside/i);
  });
});
