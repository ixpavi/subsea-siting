// Regression tests for the antimeridian handling in the routing engine.
//
// The engine's A* wraps grid columns, so a Pacific route genuinely contains a
// consecutive [lat, 179.75] -> [lat, -179.75] pair. Every resampler used to
// interpolate longitude as `lng1 + (lng2 - lng1) * t`, which reads that step
// as -359.5 degrees and sweeps the sample the long way round the planet.
// Nothing in the previous suite exercised a dateline-crossing route.
import { describe, expect, it } from "vitest";
import { interpolateLatLng, normalizeLng, shortestLngDelta } from "./geo";
import { buildCableProximityIndex, nearestCableDistanceKm } from "./cableProximityIndex";
import type { CableFeature } from "../types";

describe("longitude interpolation across the antimeridian", () => {
  it("takes the short way, not the long way through longitude 0", () => {
    // The midpoint of a 0.5deg step across the dateline is the dateline
    // itself, not the Gulf of Guinea.
    const [lat, lng] = interpolateLatLng(20, 179.75, 20, -179.75, 0.5);
    expect(lat).toBe(20);
    expect(Math.abs(Math.abs(lng) - 180)).toBeLessThan(0.001);
  });

  it("keeps every sample within a quarter degree of the dateline", () => {
    // The old implementation put t=0.5 at longitude 0 -- 20,000 km away.
    for (let i = 0; i <= 10; i++) {
      const [, lng] = interpolateLatLng(20, 179.75, 20, -179.75, i / 10);
      expect(Math.abs(lng)).toBeGreaterThan(179.7);
    }
  });

  it("is unchanged for ordinary segments that do not cross", () => {
    const [lat, lng] = interpolateLatLng(10, 20, 30, 40, 0.5);
    expect(lat).toBeCloseTo(20, 10);
    expect(lng).toBeCloseTo(30, 10);
  });

  it("normalises output into [-180, 180)", () => {
    expect(normalizeLng(180)).toBe(-180);
    expect(normalizeLng(190)).toBeCloseTo(-170, 10);
    expect(normalizeLng(-190)).toBeCloseTo(170, 10);
  });

  it("reports the short signed delta", () => {
    expect(shortestLngDelta(179.75, -179.75)).toBeCloseTo(0.5, 10);
    expect(shortestLngDelta(-179.75, 179.75)).toBeCloseTo(-0.5, 10);
    expect(shortestLngDelta(10, 20)).toBeCloseTo(10, 10);
  });
});

describe("cable proximity across the antimeridian", () => {
  /** One short cable sitting just west of the dateline, at 179.5W. */
  const cable: CableFeature[] = [
    {
      id: "dateline-1",
      name: "Dateline Test Cable",
      color: "#ffffff",
      paths: [
        [
          [-1, -179.5],
          [1, -179.5],
        ],
      ],
    } as CableFeature,
  ];

  it("finds a cable on the other side of the dateline", () => {
    const index = buildCableProximityIndex(cable);
    // Query at 179.5E: about 111 km from the cable going east across the
    // dateline. Before the bucket wrap this returned the NO_CABLE_NEARBY_KM
    // sentinel (20,000) because the search asked for bucket indices 90..95,
    // which cannot exist.
    const d = nearestCableDistanceKm(index, 0, 179.5, 6);
    expect(d).toBeLessThan(150);
  });

  it("still finds it from the same side", () => {
    const index = buildCableProximityIndex(cable);
    expect(nearestCableDistanceKm(index, 0, -179.0, 6)).toBeLessThan(150);
  });

  it("reports genuinely empty water as empty", () => {
    const index = buildCableProximityIndex(cable);
    // Mid-Atlantic, nowhere near the test cable.
    expect(nearestCableDistanceKm(index, 0, -30, 6)).toBeGreaterThan(1000);
  });
});
