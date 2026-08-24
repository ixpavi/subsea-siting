import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  densifyRenderedSegment,
  pointToSegmentDistance,
  isFacingCamera,
  findCablesNearScreenPoint,
} from "./cableHitTest";
import type { CableFeature } from "./types";

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

/**
 * The spatial prefilter must be a pure optimisation.
 *
 * The scan densifies every stored segment and runs two matrix projections per
 * densified point -- over 250,000 projections per call across the real
 * dataset, and the hover handler was invoking it 20 times a second. Pruning
 * paths whose stored coordinates are nowhere near the cursor removes ~60% of
 * that, but a prefilter that drops a path the user could actually have clicked
 * breaks the one thing this module exists to provide.
 *
 * So these tests do not check that the prefilter is fast. They check that
 * turning it on NEVER changes which cables a click resolves to, on the real
 * 724-cable dataset.
 */
describe("prefilter must not change results", () => {
  const cables: CableFeature[] = JSON.parse(
    readFileSync(join(process.cwd(), "public", "data", "cables.json"), "utf-8")
  );

  const W = 1600, H = 900, R = 300;

  // Orthographic projection with screen (x, y) and depth (z) taken from
  // DIFFERENT world axes. An earlier version of this harness used the same
  // expression for screen-x and for depth, which let back-of-globe cables
  // land on front-facing screen positions and produced phantom mismatches
  // that were the harness's fault rather than the prefilter's.
  const world = (lat: number, lng: number) => {
    const a = (lat * Math.PI) / 180, b = (lng * Math.PI) / 180;
    return { x: Math.cos(a) * Math.cos(b), y: Math.sin(a), z: Math.cos(a) * Math.sin(b) };
  };

  function projection(withPrefilter: boolean) {
    const base = {
      getCoords: (lat: number, lng: number) => world(lat, lng),
      getScreenCoords: (lat: number, lng: number) => {
        const w = world(lat, lng);
        return { x: W / 2 + R * w.x, y: H / 2 - R * w.y };
      },
      camera: () => ({ position: { x: 0, y: 0, z: 5 }, updateMatrixWorld: () => {} }),
      controls: () => ({ update: () => {} }),
    };
    if (!withPrefilter) return base;
    return {
      ...base,
      toGlobeCoords: (sx: number, sy: number) => {
        const nx = (sx - W / 2) / R, ny = (H / 2 - sy) / R;
        if (nx * nx + ny * ny > 1) return null;
        const lat = Math.asin(Math.max(-1, Math.min(1, ny)));
        const cosLat = Math.cos(lat);
        if (Math.abs(cosLat) < 1e-9) return { lat: (lat * 180) / Math.PI, lng: 0 };
        const lng = Math.acos(Math.max(-1, Math.min(1, nx / cosLat)));
        return { lat: (lat * 180) / Math.PI, lng: (lng * 180) / Math.PI };
      },
    };
  }

  /** A spread of points across the globe's face, including near the limb
   *  where foreshortening makes a few pixels span many degrees -- the case a
   *  too-small prefilter margin would get wrong. */
  const samples: [number, number][] = [];
  for (let gx = -0.85; gx <= 0.85; gx += 0.17) {
    for (let gy = -0.85; gy <= 0.85; gy += 0.17) {
      if (gx * gx + gy * gy > 0.95) continue;
      samples.push([W / 2 + gx * R, H / 2 - gy * R]);
    }
  }

  it("covers a wide spread of on-globe points", () => {
    expect(samples.length).toBeGreaterThan(60);
  });

  it("resolves identical cables with and without the prefilter", () => {
    const differing: string[] = [];
    for (const [x, y] of samples) {
      const withF = findCablesNearScreenPoint(cables, projection(true), x, y)
        .map((c) => c.cableId).sort().join(",");
      const withoutF = findCablesNearScreenPoint(cables, projection(false), x, y)
        .map((c) => c.cableId).sort().join(",");
      if (withF !== withoutF) differing.push(`(${x.toFixed(0)},${y.toFixed(0)}) ${withoutF} -> ${withF}`);
    }
    expect(differing).toEqual([]);
  });

  it("still finds cables at all, so the comparison is not vacuously empty", () => {
    const hits = samples.reduce(
      (n, [x, y]) => n + findCablesNearScreenPoint(cables, projection(true), x, y).length,
      0
    );
    expect(hits).toBeGreaterThan(20);
  });
});
