import { describe, it, expect } from "vitest";
import { buildCableProximityIndex, nearestCableDistanceKm } from "./cableProximityIndex";
import type { CableFeature } from "../types";

/**
 * Regression cover for the nearest-vertex bug.
 *
 * The index used to measure distance to a cable's nearest STORED VERTEX. Real
 * cable geometry has wildly uneven vertex spacing -- 886 of 12,170 stored
 * segments in the shipped dataset exceed 500km, the worst being 5,650km -- so
 * a route could cross directly over a cable at the midpoint of a long segment
 * and be scored thousands of kilometres clear of it. That does not merely add
 * noise to the diversity metric, it can invert it.
 */
describe("nearestCableDistanceKm", () => {
  /** One cable, one segment, two vertices ~1,113km apart along the equator. */
  const longSegmentCable: CableFeature[] = [
    { id: "test-cable", name: "Test", color: "#fff", paths: [[[0, 0], [0, 10]]] },
  ];

  it("is not fooled by wide stored-vertex spacing", () => {
    const index = buildCableProximityIndex(longSegmentCable);
    // 0.1 degrees off the segment's midpoint: ~11km from the LINE, but ~556km
    // from either STORED vertex. (Build-time sub-segmenting alone would also
    // pass this, which is why the sharper test below exists.)
    expect(nearestCableDistanceKm(index, 0.1, 5)).toBeLessThan(20);
  });

  /**
   * The discriminating test for point-to-segment specifically.
   *
   * Build-time sub-segmenting caps segment length at SEGMENT_SPLIT_KM (40km),
   * so on a long cable a nearest-VERTEX implementation is already accurate to
   * ~20km and the test above cannot tell the two apart -- verified by
   * mutating pointToSegmentKm to return the nearer endpoint, which left that
   * assertion passing. A cable SHORTER than the split threshold stays a
   * single whole segment, and there the perpendicular distance and the
   * nearest-endpoint distance genuinely diverge.
   */
  it("measures perpendicular to a short, unsplit segment rather than to its endpoints", () => {
    // ~33km long, below SEGMENT_SPLIT_KM, so it is stored as one segment.
    const shortCable: CableFeature[] = [
      { id: "short", name: "Short", color: "#fff", paths: [[[0, 0], [0, 0.3]]] },
    ];
    const index = buildCableProximityIndex(shortCable);
    // Perpendicular from the midpoint: ~5.6km. Nearest endpoint: ~17.6km.
    const d = nearestCableDistanceKm(index, 0.05, 0.15);
    expect(d).toBeLessThan(8);
    expect(d).toBeGreaterThan(3);
  });

  it("returns ~0 for a point lying on the cable", () => {
    const index = buildCableProximityIndex(longSegmentCable);
    expect(nearestCableDistanceKm(index, 0, 5)).toBeLessThan(1);
  });

  it("still measures correctly near a segment endpoint", () => {
    const index = buildCableProximityIndex(longSegmentCable);
    const d = nearestCableDistanceKm(index, 0, 0);
    expect(d).toBeLessThan(1);
  });

  it("reports a large distance when nothing is within the searched radius", () => {
    const index = buildCableProximityIndex(longSegmentCable);
    // Opposite side of the planet.
    expect(nearestCableDistanceKm(index, -60, 180)).toBeGreaterThan(1000);
  });

  it("is symmetric about the segment", () => {
    const index = buildCableProximityIndex(longSegmentCable);
    const north = nearestCableDistanceKm(index, 0.1, 5);
    const south = nearestCableDistanceKm(index, -0.1, 5);
    expect(Math.abs(north - south)).toBeLessThan(1);
  });

  it("caches repeat queries without changing the answer", () => {
    const index = buildCableProximityIndex(longSegmentCable);
    const first = nearestCableDistanceKm(index, 0.1, 5);
    const second = nearestCableDistanceKm(index, 0.1, 5);
    expect(second).toBe(first);
  });
});
