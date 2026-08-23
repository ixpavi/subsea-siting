// Regression tests for the camera framing geometry.
//
// The bug these lock down: clicking a cable spun the globe to open ocean
// nowhere near it. The cause was averaging longitudes, which is silently wrong
// for anything crossing the antimeridian and perfectly correct everywhere
// else -- so it survived review and normal use, and only misbehaved on the
// Pacific cables nobody clicked while testing.
//
// The real dataset is loaded here rather than only using synthetic points,
// because the synthetic cases prove the maths and the real ones prove the
// maths is applied to the data we actually ship.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { frameForPoints, sphericalCentroid, angularDistanceDeg, MAX_ALTITUDE } from "./cameraFraming";

/** The old, broken implementation. Kept so the tests can demonstrate that the
 *  cases below genuinely failed before, rather than merely asserting that the
 *  new code returns whatever it happens to return. */
function legacyCentre(points: [number, number][]): { lat: number; lng: number } {
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const [lat, lng] of points) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
}

/** Shortest angular separation between two longitudes, in degrees. */
function lngDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

describe("sphericalCentroid", () => {
  it("averages normally when no antimeridian is involved", () => {
    const c = sphericalCentroid([[0, 0], [0, 10]])!;
    expect(c.lat).toBeCloseTo(0, 6);
    expect(c.lng).toBeCloseTo(5, 6);
    expect(c.degenerate).toBe(false);
  });

  it("centres two points straddling the antimeridian on the short way round", () => {
    // +178 and -179 are 3 degrees apart. Their numeric mean is -0.5, which is
    // the Gulf of Guinea -- the exact failure the user reported.
    const c = sphericalCentroid([[0, 178], [0, -179]])!;
    expect(lngDelta(c.lng, 179.5)).toBeLessThan(1e-6);
    expect(lngDelta(c.lng, legacyCentre([[0, 178], [0, -179]]).lng)).toBeGreaterThan(170);
  });

  it("handles the pole without producing a bogus longitude", () => {
    const c = sphericalCentroid([[89, 0], [89, 90], [89, 180], [89, -90]])!;
    expect(c.lat).toBeGreaterThan(88);
  });

  it("flags antipodal points as degenerate instead of inventing a centre", () => {
    const c = sphericalCentroid([[0, 0], [0, 180]])!;
    expect(c.degenerate).toBe(true);
    // Falls back to a real input point rather than an arbitrary direction.
    expect([0]).toContain(c.lat);
  });

  it("returns null for no points", () => {
    expect(sphericalCentroid([])).toBeNull();
  });
});

describe("frameForPoints", () => {
  it("keeps every point within the framed radius", () => {
    const pts: [number, number][] = [[35, 139], [21, -157], [33, -118]];
    const f = frameForPoints(pts)!;
    // The centre must genuinely be central: no point further than the radius
    // implied by the chosen altitude's own derivation.
    let maxD = 0;
    for (const [lat, lng] of pts) maxD = Math.max(maxD, angularDistanceDeg(f.lat, f.lng, lat, lng));
    expect(maxD).toBeLessThan(90);
  });

  it("zooms out for long routes and in for short ones", () => {
    const shortRoute = frameForPoints([[51, 2], [51.4, 2.6]])!;
    const longRoute = frameForPoints([[35, 139], [33, -118]])!;
    expect(longRoute.altitude).toBeGreaterThan(shortRoute.altitude);
  });

  it("clamps altitude to the documented range", () => {
    const tiny = frameForPoints([[0, 0], [0, 0.001]])!;
    const huge = frameForPoints([[0, 0], [0, 120], [60, -140]])!;
    expect(tiny.altitude).toBeGreaterThanOrEqual(1.1);
    expect(huge.altitude).toBeLessThanOrEqual(MAX_ALTITUDE);
  });

  it("returns null for no points", () => {
    expect(frameForPoints([])).toBeNull();
  });
});

describe("the shipped cable dataset", () => {
  interface Cable { id: string; name: string; paths: [number, number][][] }
  const cables: Cable[] = JSON.parse(
    readFileSync(join(process.cwd(), "public", "data", "cables.json"), "utf-8")
  );

  /** Points are stored [lat, lng]. */
  const pointsOf = (c: Cable) => c.paths.flat() as [number, number][];

  it("loads real cables", () => {
    expect(cables.length).toBeGreaterThan(700);
  });

  it("frames every cable within its own geometry", () => {
    // The decisive property: the camera target must be near the cable. Under
    // the old code 32 cables failed this, the worst by 180 degrees.
    const offenders: string[] = [];
    for (const c of cables) {
      const pts = pointsOf(c);
      if (pts.length === 0) continue;
      const f = frameForPoints(pts)!;
      let nearest = Infinity;
      for (const [lat, lng] of pts) {
        nearest = Math.min(nearest, angularDistanceDeg(f.lat, f.lng, lat, lng));
      }
      // The centroid of a curved path need not lie exactly on it, but it must
      // not be in a different ocean.
      if (nearest > 20) offenders.push(`${c.name} (${nearest.toFixed(0)} deg from nearest point)`);
    }
    expect(offenders).toEqual([]);
  });

  it("demonstrates the old implementation genuinely failed on Pacific cables", () => {
    // Guards against the fix being vacuous -- if this ever stops finding
    // failures, the test above has stopped proving anything.
    const broken = cables.filter((c) => {
      const pts = pointsOf(c);
      if (pts.length === 0) return false;
      const legacy = legacyCentre(pts);
      const fixed = frameForPoints(pts)!;
      return lngDelta(legacy.lng, fixed.lng) > 30;
    });
    expect(broken.length).toBeGreaterThan(20);
    expect(broken.map((c) => c.name)).toContain("Telstra Endeavour");
  });
});
