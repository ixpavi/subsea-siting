// The DetailPanel path, end to end minus React: for each real subsea site,
// densify the route to its nearest landing point, assess it against the real
// shipped protected-area grid, and check the risk module reports the right
// basis. This is the wiring the UI does; testing it here means a click is not
// the only way to know it works.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assessEnvironmentalWithGrid, type ProtectedAreaGrid } from "./protectedAreas";
import { estimateRouteRisk } from "../calculator/environmentalRisk";

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

const sites = JSON.parse(
  readFileSync(join(process.cwd(), "public", "data", "subsea-dcs.json"), "utf-8")
) as Array<{
  name: string;
  lat: number;
  lng: number;
  depth_m: number;
  nearestLandingPoint: { lat: number; lng: number } | null;
  nearestLandingPointDistanceKm: number | null;
}>;

/** Same densification the panel uses: ~5 km, finer than the grid's ~11 km cell. */
function densifyGreatCircle(a: [number, number], b: [number, number]): [number, number][] {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const [lat1, lng1] = a.map(toRad) as [number, number];
  const [lat2, lng2] = b.map(toRad) as [number, number];
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2
      )
    );
  if (d === 0) return [a, b];
  const steps = Math.max(2, Math.ceil((d * 6371) / 5));
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2);
    const y = A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    out.push([toDeg(Math.atan2(z, Math.hypot(x, y))), toDeg(Math.atan2(y, x))]);
  }
  return out;
}

describe("densification", () => {
  it("samples finer than the grid cell, so no crossed cell is stepped over", () => {
    const path = densifyGreatCircle([59.15, -2.78], [59.19, -2.74]);
    expect(path.length).toBeGreaterThanOrEqual(3);
    expect(path[0][0]).toBeCloseTo(59.15, 4);
    expect(path[path.length - 1][0]).toBeCloseTo(59.19, 4);
  });

  it("handles a zero-length route without dividing by zero", () => {
    const path = densifyGreatCircle([10, 20], [10, 20]);
    expect(path).toHaveLength(2);
    expect(path.every(([la, ln]) => Number.isFinite(la) && Number.isFinite(ln))).toBe(true);
  });
});

describe("each real subsea site", () => {
  it("resolves to a basis that matches whether the grid covers it", () => {
    for (const s of sites) {
      if (!s.nearestLandingPoint || s.nearestLandingPointDistanceKm == null) continue;
      const path = densifyGreatCircle(
        [s.lat, s.lng],
        [s.nearestLandingPoint.lat, s.nearestLandingPoint.lng]
      );
      const exposure = assessEnvironmentalWithGrid(path, grid);
      const risk = estimateRouteRisk({
        depthM: s.depth_m,
        latitude: s.lat,
        routeDistanceKm: s.nearestLandingPointDistanceKm,
        protectedAreaExposure: exposure,
      });
      expect(risk.ecologicalBasis).toBe(exposure.available ? "measured" : "heuristic");
      expect(risk.rationale.length).toBeGreaterThan(0);
    }
  });

  it("measures the European site rather than guessing at it", () => {
    // Orkney is the one of the four inside the grid's 33-81N / -42-36E extent.
    const orkney = sites.find((s) => s.name.includes("Natick"));
    expect(orkney).toBeTruthy();
    const path = densifyGreatCircle(
      [orkney!.lat, orkney!.lng],
      [orkney!.nearestLandingPoint!.lat, orkney!.nearestLandingPoint!.lng]
    );
    const exposure = assessEnvironmentalWithGrid(path, grid);
    expect(exposure.available).toBe(true);

    const risk = estimateRouteRisk({
      depthM: orkney!.depth_m,
      latitude: orkney!.lat,
      routeDistanceKm: orkney!.nearestLandingPointDistanceKm!,
      protectedAreaExposure: exposure,
    });
    expect(risk.ecologicalBasis).toBe("measured");
    expect(risk.rationale.join(" ")).toMatch(/World Database on Protected Areas/);
  });

  it("says so, rather than silently guessing, outside the extent", () => {
    const hainan = sites.find((s) => s.name.includes("Hainan"))!;
    const path = densifyGreatCircle(
      [hainan.lat, hainan.lng],
      [hainan.nearestLandingPoint!.lat, hainan.nearestLandingPoint!.lng]
    );
    const exposure = assessEnvironmentalWithGrid(path, grid);
    expect(exposure.available).toBe(false);

    const risk = estimateRouteRisk({
      depthM: hainan.depth_m,
      latitude: hainan.lat,
      routeDistanceKm: hainan.nearestLandingPointDistanceKm!,
      protectedAreaExposure: exposure,
    });
    expect(risk.ecologicalBasis).toBe("heuristic");
    // The reason from the grid is surfaced, not swallowed.
    expect(risk.rationale.join(" ")).toContain(exposure.reason);
  });
});
