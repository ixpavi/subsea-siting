// The nearest ocean cell decides where a modelled access point goes, and the
// panel reports it as "the nearest routable ocean cell". These tests hold it
// to that, against the real shipped grid.
//
// THE BUG THIS PINS. The search returned the best cell in the first square
// ring of grid cells that held any water. A ring is not a circle: a column of
// cells is 55 km wide at the equator and 24 km at Moscow's latitude, so a ring
// reaches much further north-south than east-west. Moscow resolved to the
// White Sea at 945 km while the Gulf of Finland is 711 km away.
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findNearestOceanCell, latForRow, lngForCol } from "./oceanGrid";
import type { OceanGrid } from "./oceanGrid";

const DATA = join(process.cwd(), "public", "data");
let grid: OceanGrid;

beforeAll(() => {
  const meta = JSON.parse(readFileSync(join(DATA, "ocean-depth.json"), "utf-8"));
  const bin = readFileSync(join(DATA, meta.binary));
  grid = { ...meta, depthM: new Int16Array(bin.buffer, bin.byteOffset, bin.length / 2) };
});

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/** Every water cell on the planet, checked one by one. Slow, and obviously right. */
function bruteForceNearestKm(lat: number, lng: number): number {
  let best = Infinity;
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (grid.depthM[row * grid.cols + col] === 0) continue;
      const d = haversineKm(lat, lng, latForRow(grid, row), lngForCol(grid, col));
      if (d < best) best = d;
    }
  }
  return best;
}

const INLAND = {
  Moscow: [55.7505, 37.6175],
  Madrid: [40.4168, -3.7038],
  Johannesburg: [-26.2041, 28.0473],
  Chengdu: [30.5728, 104.0668],
  Nairobi: [-1.2921, 36.8219],
  Frankfurt: [50.1109, 8.6821],
  Bengaluru: [12.9768, 77.5901],
  Denver: [39.7392, -104.9903],
} as const;

describe("findNearestOceanCell", () => {
  it("really is the nearest water, for inland cities at every latitude", () => {
    for (const [name, [lat, lng]] of Object.entries(INLAND)) {
      const found = findNearestOceanCell(grid, lat, lng);
      expect(found, name).not.toBeNull();
      expect(found!.distanceKm, name).toBeCloseTo(bruteForceNearestKm(lat, lng), 6);
    }
  }, 60_000);

  it("puts Moscow's nearest water on the Gulf of Finland, not the White Sea", () => {
    const found = findNearestOceanCell(grid, INLAND.Moscow[0], INLAND.Moscow[1])!;
    expect(found.distanceKm).toBeLessThan(750);
    expect(found.lat).toBeLessThan(61); // the White Sea cell was at 64.25N
    expect(found.lng).toBeLessThan(31);
  });

  it("returns the point itself when it is already at sea", () => {
    const found = findNearestOceanCell(grid, 0, -30)!; // mid-Atlantic
    expect(found).toMatchObject({ lat: 0, lng: -30, distanceKm: 0 });
  });

  it("with routableOnly, never picks water a route cannot leave", () => {
    // Almaty's nearest water is the Caspian, which is sealed off from the
    // world ocean. An access point there would make every route fail.
    const [lat, lng] = [43.2389, 76.8897];
    const inCaspian = (c: { lat: number; lng: number }) => c.lat > 36 && c.lat < 47.5 && c.lng > 46 && c.lng < 55.5;

    const anyWater = findNearestOceanCell(grid, lat, lng)!;
    expect(inCaspian(anyWater)).toBe(true);

    const routable = findNearestOceanCell(grid, lat, lng, { routableOnly: true })!;
    expect(routable).not.toBeNull();
    expect(inCaspian(routable)).toBe(false);
    expect(routable.distanceKm).toBeGreaterThan(anyWater.distanceKm);
  });

  it("with routableOnly, moves a point inside a sealed sea out to the world ocean", () => {
    const caspian = { lat: 42, lng: 51 };
    expect(findNearestOceanCell(grid, caspian.lat, caspian.lng)!.distanceKm).toBe(0);
    expect(findNearestOceanCell(grid, caspian.lat, caspian.lng, { routableOnly: true })!.distanceKm).toBeGreaterThan(0);
  });
});
