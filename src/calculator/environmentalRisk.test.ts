import { describe, it, expect } from "vitest";
import { estimateRouteRisk } from "./environmentalRisk";
import type { EnvironmentalAssessment } from "../routing/routingTypes";

const SITE = { depthM: 40, latitude: 20, routeDistanceKm: 30 };

const measured = (km: number, zones: number): EnvironmentalAssessment => ({
  available: true,
  reason: "measured",
  constrainedDistanceKm: km,
  affectedZoneCount: zones,
});

describe("ecological sensitivity", () => {
  // The defect this guards against: the app shipped a WDPA grid and used it in
  // the routing engine, while this module answered the same question from a
  // latitude rule -- and never said which it had done.
  it("falls back to the heuristic when no data covers the route", () => {
    const r = estimateRouteRisk(SITE);
    expect(r.ecologicalBasis).toBe("heuristic");
    expect(r.rationale.join(" ")).toMatch(/inferred from depth and latitude/i);
  });

  it("uses the heuristic when the grid reports itself unavailable", () => {
    const r = estimateRouteRisk({
      ...SITE,
      protectedAreaExposure: { available: false, reason: "Outside the data extent." },
    });
    expect(r.ecologicalBasis).toBe("heuristic");
    expect(r.rationale.join(" ")).toMatch(/Outside the data extent/);
  });

  it("reports measured when the grid covers the route", () => {
    const r = estimateRouteRisk({ ...SITE, protectedAreaExposure: measured(0, 0) });
    expect(r.ecologicalBasis).toBe("measured");
    expect(r.ecologicalSensitivity).toBe("low");
    expect(r.rationale.join(" ")).toMatch(/World Database on Protected Areas/);
  });

  it("does not call clean water sensitive just because it is shallow and tropical", () => {
    // The heuristic rates this exact site "high" on latitude and depth alone.
    expect(estimateRouteRisk(SITE).ecologicalSensitivity).not.toBe("low");
    // Measured, with no protected water on the route, it is low.
    const r = estimateRouteRisk({ ...SITE, protectedAreaExposure: measured(0, 0) });
    expect(r.ecologicalSensitivity).toBe("low");
  });

  it("escalates with measured exposure", () => {
    const some = estimateRouteRisk({ ...SITE, protectedAreaExposure: measured(2, 1) });
    const lots = estimateRouteRisk({ ...SITE, protectedAreaExposure: measured(20, 4) });
    expect(some.ecologicalSensitivity).toBe("medium");
    expect(lots.ecologicalSensitivity).toBe("high");
  });

  it("states the measured kilometres, so the pill is auditable", () => {
    const r = estimateRouteRisk({ ...SITE, protectedAreaExposure: measured(7.5, 2) });
    expect(r.rationale.join(" ")).toMatch(/7\.5 km/);
    expect(r.rationale.join(" ")).toMatch(/2 protected areas/);
  });
});

describe("bathymetric hazard", () => {
  it("stays a heuristic even when protected-area data is available", () => {
    // No shipped dataset scores lay difficulty, and the depth is a band index.
    const a = estimateRouteRisk(SITE);
    const b = estimateRouteRisk({ ...SITE, protectedAreaExposure: measured(0, 0) });
    expect(a.bathymetricHazard).toBe(b.bathymetricHazard);
  });
});
