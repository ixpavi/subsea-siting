// Real cables do not sail round Africa to get from the Red Sea to the
// Mediterranean, or round South America to get from the Caribbean to the
// Pacific: they cross Egypt and Panama by land. These tests hold the engine to
// that, and to reporting the crossing as land rather than as sea.
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { crossingLinks, LAND_CROSSINGS, marineParts } from "./landCrossings";
import { findNearestOceanCell } from "./oceanGrid";
import { runHypotheticalRouting } from "./hypotheticalRouting";
import type { OceanGrid } from "./oceanGrid";
import type { CableFeature, LandingPoint } from "../types";

const DATA = join(process.cwd(), "public", "data");
let grid: OceanGrid;
let cables: CableFeature[];
let landingPoints: LandingPoint[];

beforeAll(() => {
  const meta = JSON.parse(readFileSync(join(DATA, "ocean-depth.json"), "utf-8"));
  const bin = readFileSync(join(DATA, meta.binary));
  grid = { ...meta, depthM: new Int16Array(bin.buffer, bin.byteOffset, bin.length / 2) };
  cables = JSON.parse(readFileSync(join(DATA, "cables.json"), "utf-8"));
  landingPoints = JSON.parse(readFileSync(join(DATA, "landing-points.json"), "utf-8"));
});

const route = (from: [number, number], to: [number, number]) =>
  runHypotheticalRouting({
    sourceLat: from[0], sourceLng: from[1], sourceLabel: "A",
    destLat: to[0], destLng: to[1], destLabel: "B",
    cables, landingPoints, grid,
  });

describe("land crossing definitions", () => {
  it("puts both ends of every crossing in water connected to the open ocean", () => {
    for (const c of LAND_CROSSINGS) {
      for (const end of [c.a, c.b]) {
        const cell = findNearestOceanCell(grid, end.lat, end.lng, { routableOnly: true });
        expect(cell?.distanceKm, `${c.id} end ${end.lat},${end.lng}`).toBe(0);
      }
    }
  });

  it("links every crossing in both directions", () => {
    const links = [...crossingLinks(grid).values()].flat();
    expect(links).toHaveLength(LAND_CROSSINGS.length * 2);
    for (const l of links) expect(l.km).toBeGreaterThan(50);
  });
});

describe("marineParts", () => {
  it("cuts the crossing segment out of the path", () => {
    const path: [number, number][] = [[0, 0], [0, 1], [1, 1], [1, 2]];
    const parts = marineParts(path, [{ id: "egypt", name: "x", km: 111, fromIndex: 1 }]);
    expect(parts).toEqual([[[0, 0], [0, 1]], [[1, 1], [1, 2]]]);
  });

  it("returns the whole path when there is no crossing", () => {
    const path: [number, number][] = [[0, 0], [0, 1]];
    expect(marineParts(path, [])).toEqual([path]);
  });
});

describe("routes that cross land", () => {
  it("takes Chennai to New York through Egypt, not round Africa", () => {
    const r = route([13.0827, 80.2707], [40.7128, -74.006]);
    const top = r.candidates[0].candidate;
    expect(top.crossings.map((c) => c.id)).toEqual(["egypt"]);
    // Round the Cape it came to about 22,000 km.
    expect(top.analysis.totalDistanceKm).toBeLessThan(18_500);
  }, 120_000);

  it("reports the crossing as land: in the total, never in the marine length", () => {
    const r = route([19.076, 72.8777], [51.5074, -0.1278]); // Mumbai -> London
    for (const rc of r.candidates) {
      const { analysis, crossings, path } = rc.candidate;
      expect(crossings).toHaveLength(1);
      expect(analysis.overlandCrossingKm).toBeCloseTo(crossings[0].km, 6);
      // Marine length is the path length minus the crossing segment.
      let pathKm = 0;
      for (let i = 0; i < path.length - 1; i++) {
        const [a, b] = [path[i], path[i + 1]];
        const toRad = (d: number) => (d * Math.PI) / 180;
        const h = Math.sin(toRad(b[0] - a[0]) / 2) ** 2 +
          Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(toRad(b[1] - a[1]) / 2) ** 2;
        pathKm += 2 * 6371 * Math.asin(Math.sqrt(h));
      }
      expect(analysis.marineDistanceKm).toBeCloseTo(pathKm - crossings[0].km, 3);
      expect(analysis.totalDistanceKm).toBeGreaterThan(analysis.marineDistanceKm + analysis.overlandCrossingKm - 1);
    }
  }, 120_000);

  it("keeps the crossing exactly as the segment between its two end cells", () => {
    const r = route([19.076, 72.8777], [51.5074, -0.1278]);
    const { path, crossings } = r.candidates[0].candidate;
    const egypt = LAND_CROSSINGS.find((c) => c.id === "egypt")!;
    const seg = [path[crossings[0].fromIndex], path[crossings[0].fromIndex + 1]];
    const ends = seg.map(([lat, lng]) => `${lat},${lng}`).sort();
    expect(ends).toEqual([`${egypt.a.lat},${egypt.a.lng}`, `${egypt.b.lat},${egypt.b.lng}`].sort());
  }, 120_000);

  it("takes Miami to Los Angeles across Panama", () => {
    const r = route([25.7617, -80.1918], [34.0522, -118.2437]);
    expect(r.candidates[0].candidate.crossings.map((c) => c.id)).toEqual(["panama"]);
  }, 120_000);

  it("does not cross land when the sea route is direct", () => {
    const r = route([13.0837, 80.2702], [1.3571, 103.8195]); // Chennai -> Singapore
    for (const rc of r.candidates) expect(rc.candidate.crossings).toHaveLength(0);
  }, 120_000);
});
