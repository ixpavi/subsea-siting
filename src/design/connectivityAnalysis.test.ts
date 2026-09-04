import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  analyzeConnectivity,
  DEFAULT_SEARCH_RADIUS_KM,
  NEAREST_LANDING_POINT_COUNT,
} from "./connectivityAnalysis";
import type { CableFeature, LandingPoint } from "../types";

/** The real shipped datasets, so these test the data as well as the logic. */
const load = (name: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "public", "data", name), "utf-8"));
const cables: CableFeature[] = load("cables.json");
const landingPoints: LandingPoint[] = load("landing-points.json");

// Coastal cities have cable landing points; inland ones do not, and that
// distinction is the whole point of the nearest-landing-point reporting.
const CHENNAI = { lat: 13.0827, lng: 80.2707 };
const MARSEILLE = { lat: 43.2965, lng: 5.3698 };
const BENGALURU = { lat: 12.9716, lng: 77.5946 };
const MOSCOW = { lat: 55.7558, lng: 37.6173 };

describe("coastal endpoints", () => {
  it("find landing points and real cable systems", () => {
    const r = analyzeConnectivity(CHENNAI, MARSEILLE, cables, landingPoints);
    expect(r.source.landingPoints.length).toBeGreaterThan(0);
    expect(r.destination?.landingPoints.length).toBeGreaterThan(0);
    expect(r.relevantCables.length).toBeGreaterThan(0);
  });

  it("rank a cable landing at both ends as direct", () => {
    const r = analyzeConnectivity(CHENNAI, MARSEILLE, cables, landingPoints);
    const direct = r.relevantCables.filter((c) => c.relevance === "direct");
    expect(direct.length).toBeGreaterThan(0);
    // Sorted direct-first, so the head of the list is the useful one.
    expect(r.relevantCables[0].relevance).toBe("direct");
  });
});

describe("inland endpoints", () => {
  // The regression this guards against is not a crash. It is the UI reporting
  // "unavailable" -- which means "we have no data" -- for a site where the
  // data is complete and simply says the coast is 287 km away.
  it("report zero nearby, because cables land on coasts", () => {
    const r = analyzeConnectivity(BENGALURU, MOSCOW, cables, landingPoints);
    expect(r.source.landingPoints).toHaveLength(0);
    expect(r.destination?.landingPoints).toHaveLength(0);
    expect(r.relevantCables).toHaveLength(0);
  });

  it("still name the nearest landing points, so the empty result is explainable", () => {
    const r = analyzeConnectivity(BENGALURU, MOSCOW, cables, landingPoints);

    expect(r.source.nearestLandingPoints).toHaveLength(NEAREST_LANDING_POINT_COUNT);
    expect(r.source.nearestLandingPoints[0].name).toMatch(/Chennai/);
    for (const lp of r.source.nearestLandingPoints) {
      expect(lp.distanceFromQueryKm).toBeGreaterThan(DEFAULT_SEARCH_RADIUS_KM);
    }

    expect(r.destination!.nearestLandingPoints.length).toBeGreaterThan(0);
    expect(r.destination!.nearestLandingPoints[0].distanceFromQueryKm).toBeGreaterThan(
      DEFAULT_SEARCH_RADIUS_KM
    );
  });
});

describe("the nearest landing points", () => {
  it("are reported whether or not they fall inside the radius", () => {
    const coastal = analyzeConnectivity(CHENNAI, null, cables, landingPoints);
    // Inside the radius the head must agree with the nearby list, or the two
    // answers are being computed from different distances.
    expect(coastal.source.nearestLandingPoints[0].id).toBe(coastal.source.landingPoints[0].id);
  });

  it("are ordered nearest first", () => {
    const r = analyzeConnectivity(BENGALURU, null, cables, landingPoints);
    const distances = r.source.nearestLandingPoints.map((lp) => lp.distanceFromQueryKm);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it("start at the true minimum over the whole dataset", () => {
    const r = analyzeConnectivity(BENGALURU, null, cables, landingPoints);
    const reported = r.source.nearestLandingPoints[0].distanceFromQueryKm;
    const everyDistance = landingPoints.map((lp) => {
      const toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad(lp.lat - BENGALURU.lat);
      const dLng = toRad(lp.lng - BENGALURU.lng);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(BENGALURU.lat)) * Math.cos(toRad(lp.lat)) * Math.sin(dLng / 2) ** 2;
      return 2 * 6371 * Math.asin(Math.sqrt(a));
    });
    expect(reported).toBeCloseTo(Math.min(...everyDistance), 6);
  });

  it("are empty only when the dataset itself is empty", () => {
    const r = analyzeConnectivity(CHENNAI, null, cables, []);
    expect(r.source.nearestLandingPoints).toHaveLength(0);
    expect(r.source.landingPoints).toHaveLength(0);
  });

  it("never exceed the reporting cap", () => {
    const r = analyzeConnectivity(BENGALURU, null, cables, landingPoints);
    expect(r.source.nearestLandingPoints.length).toBeLessThanOrEqual(NEAREST_LANDING_POINT_COUNT);
  });
});

describe("the search radius", () => {
  it("is what changes the nearby set, not the nearest set", () => {
    const tight = analyzeConnectivity(BENGALURU, null, cables, landingPoints, {
      searchRadiusKm: DEFAULT_SEARCH_RADIUS_KM,
    });
    const wide = analyzeConnectivity(BENGALURU, null, cables, landingPoints, {
      searchRadiusKm: 300,
    });
    expect(tight.source.landingPoints).toHaveLength(0);
    expect(wide.source.landingPoints.length).toBeGreaterThan(0);
    // Widening changes what counts as "nearby"; it cannot change which points
    // are nearest. That invariant is what lets the panel widen the explanation
    // without widening the measurement.
    expect(wide.source.nearestLandingPoints.map((lp) => lp.id)).toEqual(
      tight.source.nearestLandingPoints.map((lp) => lp.id)
    );
  });
});
