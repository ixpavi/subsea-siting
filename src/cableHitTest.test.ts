import { describe, it, expect } from "vitest";
import { densifyRenderedSegment, pointToSegmentDistance, isFacingCamera } from "./cableHitTest";

/**
 * These lock in the hit-test's hardest-won property: the densification here
 * must reproduce three-globe's ACTUAL path interpolation, not a geometrically
 * "better" one.
 *
 * three-globe's calcPath/interpolateLine interpolates latitude and longitude
 * INDEPENDENTLY AND LINEARLY. An earlier version of this module densified via
 * true great-circle slerp -- more correct as geodesy, but a different curve
 * from the one actually drawn. The divergence is largest for long segments at
 * high latitude, which is exactly why the resulting click misalignment was
 * cable-specific rather than a uniform hitbox problem (FLAG Atlantic-1, at
 * 40-50N with 1000km+ segments, was the reported case).
 */
describe("densifyRenderedSegment", () => {
  it("interpolates linearly in lat/lng, NOT along a great circle", () => {
    // 0N,0E -> 60N,60E. Linear interpolation puts the midpoint at exactly
    // (30, 30); a great circle bulges poleward of that.
    const pts = densifyRenderedSegment(0, 0, 60, 60);
    const mid = pts[Math.floor(pts.length / 2) - 1];
    // Every returned point must satisfy lat === lng for this symmetric case,
    // which is true of linear interpolation and false of a slerp.
    for (const [lat, lng] of pts) expect(lat).toBeCloseTo(lng, 6);
    expect(mid[0]).toBeGreaterThan(0);
    expect(mid[0]).toBeLessThan(60);
  });

  it("always ends at the segment's endpoint", () => {
    const pts = densifyRenderedSegment(10, 20, 40, 50);
    expect(pts[pts.length - 1]).toEqual([40, 50]);
  });

  it("emits only the endpoint for a segment shorter than the resolution", () => {
    // Default pathResolution is 2 degrees; a 1-degree hop needs no infill.
    const pts = densifyRenderedSegment(0, 0, 0, 1);
    expect(pts).toEqual([[0, 1]]);
  });

  it("adds more points for longer segments", () => {
    const short = densifyRenderedSegment(0, 0, 0, 10);
    const long = densifyRenderedSegment(0, 0, 0, 100);
    expect(long.length).toBeGreaterThan(short.length);
  });

  it("unwraps across the antimeridian and normalises back into (-180,180]", () => {
    // 170E -> -170E is a 20-degree hop eastward, not a 340-degree hop west.
    const pts = densifyRenderedSegment(0, 170, 0, -170);
    for (const [, lng] of pts) {
      expect(lng).toBeGreaterThan(-180.0001);
      expect(lng).toBeLessThanOrEqual(180.0001);
    }
    // Interpolated points must sit in the short arc, i.e. |lng| >= 170.
    for (const [, lng] of pts.slice(0, -1)) expect(Math.abs(lng)).toBeGreaterThanOrEqual(169.9);
  });
});

describe("pointToSegmentDistance", () => {
  it("is zero on the segment and clamps beyond its endpoints", () => {
    expect(pointToSegmentDistance(5, 0, 0, 0, 10, 0)).toBeCloseTo(0, 6);
    // Past the end: distance is to the endpoint, not to the infinite line.
    expect(pointToSegmentDistance(20, 0, 0, 0, 10, 0)).toBeCloseTo(10, 6);
    expect(pointToSegmentDistance(-5, 0, 0, 0, 10, 0)).toBeCloseTo(5, 6);
  });

  it("measures perpendicular distance to the interior of a segment", () => {
    expect(pointToSegmentDistance(5, 3, 0, 0, 10, 0)).toBeCloseTo(3, 6);
  });

  it("handles a degenerate zero-length segment", () => {
    expect(pointToSegmentDistance(3, 4, 0, 0, 0, 0)).toBeCloseTo(5, 6);
  });
});

describe("isFacingCamera", () => {
  const cam = { x: 0, y: 0, z: 100 };
  it("accepts a point on the camera-facing hemisphere", () => {
    expect(isFacingCamera({ x: 0, y: 0, z: 1 }, cam)).toBe(true);
  });
  it("rejects a point on the far side of the globe", () => {
    expect(isFacingCamera({ x: 0, y: 0, z: -1 }, cam)).toBe(false);
  });
  it("rejects a point exactly on the limb", () => {
    expect(isFacingCamera({ x: 1, y: 0, z: 0 }, cam)).toBe(false);
  });
});
