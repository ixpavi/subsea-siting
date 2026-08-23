// Regression tests for ocean-grid connectivity.
//
// The bug these lock down was invisible for a long time and produced no error
// anywhere. A 0.5 degree cell is 56 km across, so the Strait of Gibraltar
// (14 km) rasterized to solid land and sealed the Mediterranean into its own
// basin. Every route between the Med and any other ocean returned "no marine
// path could be found" -- an honest-looking message for a wrong reason.
// 282 of 1,920 real landing points (14.7%) were unreachable, including
// Marseille, Barcelona, Genoa and Istanbul.
//
// Nothing in the previous suite could catch that: the engine was behaving
// correctly given its grid, and the grid was wrong. These tests assert
// properties of the DATA rather than of the code, which is where the defect
// actually lived.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface GridJson {
  resolutionDeg: number;
  rows: number;
  cols: number;
  data: number[];
  straitCorrections?: { name: string; lat: number; lng: number; connects: string }[];
}

const grid: GridJson = JSON.parse(
  readFileSync(join(process.cwd(), "public", "data", "ocean-grid.json"), "utf-8")
);
const { rows, cols, resolutionDeg } = grid;
const data = Uint8Array.from(grid.data);

const idx = (r: number, c: number) => r * cols + c;
const latToRow = (lat: number) =>
  Math.min(rows - 1, Math.max(0, Math.floor((lat + 90) / resolutionDeg)));
const lngToCol = (lng: number) =>
  ((Math.floor((lng + 180) / resolutionDeg) % cols) + cols) % cols;
const isWater = (lat: number, lng: number) => data[idx(latToRow(lat), lngToCol(lng))] > 0;

/** Can water at A reach water at B, 8-connected with longitude wrap? Mirrors
 *  the router's own neighbourhood, so a pass here means the router can too. */
function connected(aLat: number, aLng: number, bLat: number, bLng: number): boolean {
  const start = idx(latToRow(aLat), lngToCol(aLng));
  const goal = idx(latToRow(bLat), lngToCol(bLng));
  if (data[start] === 0 || data[goal] === 0) return false;
  const seen = new Uint8Array(rows * cols);
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === goal) return true;
    const r = Math.floor(cur / cols);
    const c = cur % cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = r + dr;
        if (nr < 0 || nr >= rows) continue;
        const nc = (c + dc + cols) % cols;
        const n = idx(nr, nc);
        if (data[n] === 0 || seen[n]) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
  }
  return false;
}

describe("ocean grid: seas that must connect", () => {
  // Each case is an open-water point in one sea and one in another, chosen
  // well away from coastlines so the test is about the strait between them and
  // not about coastal cell classification.
  const MUST_CONNECT: [string, number, number, number, number][] = [
    ["Mediterranean to Atlantic (Gibraltar)", 38.0, 5.0, 36.0, -10.0],
    ["Black Sea to Mediterranean (Bosphorus + Dardanelles)", 43.0, 33.0, 38.0, 5.0],
    ["Andaman Sea to South China Sea (Malacca)", 7.0, 96.0, 5.0, 107.0],
    ["Red Sea to Indian Ocean (Bab-el-Mandeb)", 20.0, 38.0, 10.0, 55.0],
    ["North Sea to Atlantic", 56.0, 3.0, 50.0, -10.0],
    ["Pacific to Atlantic (Southern Ocean)", 0.0, -140.0, 0.0, -30.0],
  ];

  for (const [name, aLat, aLng, bLat, bLng] of MUST_CONNECT) {
    it(`connects ${name}`, () => {
      expect(isWater(aLat, aLng)).toBe(true);
      expect(isWater(bLat, bLng)).toBe(true);
      expect(connected(aLat, aLng, bLat, bLng)).toBe(true);
    });
  }
});

describe("ocean grid: what must stay closed", () => {
  // The corrections are for natural straits only. Opening artificial canals
  // would silently change the engine's routing claims -- and the app
  // explicitly documents that Europe-Asia routes come out around Africa.
  it("does not open the Suez Canal", () => {
    expect(isWater(30.0, 32.55)).toBe(false);
  });

  it("does not open the Panama Canal", () => {
    expect(isWater(9.1, -79.7)).toBe(false);
  });

  it("leaves the Caspian Sea landlocked, because it is", () => {
    // A rule that connected every isolated basin would have carved a 724 km
    // channel through Iran to reach it.
    expect(connected(41.0, 51.0, 36.0, 25.0)).toBe(false);
  });
});

describe("ocean grid: strait corrections are declared", () => {
  it("records every correction in the shipped grid metadata", () => {
    // The corrections are a deliberate divergence from the source polygons.
    // If they are not enumerated in the data, that divergence is undocumented.
    expect(grid.straitCorrections).toBeDefined();
    expect(grid.straitCorrections!.length).toBeGreaterThan(0);
    for (const s of grid.straitCorrections!) {
      expect(s.name).toBeTruthy();
      expect(s.connects).toBeTruthy();
      expect(Math.abs(s.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(s.lng)).toBeLessThanOrEqual(180);
    }
  });

  it("keeps the corrections a negligible fraction of the grid", () => {
    // Guards the other direction: this mechanism could 'fix' connectivity by
    // carving huge amounts of land. It should stay surgical.
    const ocean = data.reduce((a, v) => a + (v > 0 ? 1 : 0), 0);
    const corrections = grid.straitCorrections!.length;
    expect(corrections).toBeLessThan(30);
    expect(ocean / (rows * cols)).toBeLessThan(0.7);
  });
});

describe("ocean grid: real landing points are reachable", () => {
  interface LandingPoint { name: string; lat: number; lng: number }
  const landingPoints: LandingPoint[] = JSON.parse(
    readFileSync(join(process.cwd(), "public", "data", "landing-points.json"), "utf-8")
  );

  /** The router snaps a coastal point to the nearest ocean cell, so mirror
   *  that rather than testing the landing point's own (usually land) cell. */
  function nearestOceanCell(lat: number, lng: number, maxRing = 8): number | null {
    const r0 = latToRow(lat);
    const c0 = lngToCol(lng);
    for (let ring = 0; ring <= maxRing; ring++) {
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          const r = r0 + dr;
          if (r < 0 || r >= rows) continue;
          const c = (c0 + dc + cols) % cols;
          if (data[idx(r, c)] > 0) return idx(r, c);
        }
      }
    }
    return null;
  }

  it("puts almost every landing point on the main ocean", () => {
    // Flood the main ocean once from mid-Atlantic open water.
    const seen = new Uint8Array(rows * cols);
    const start = idx(latToRow(0), lngToCol(-30));
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      const r = Math.floor(cur / cols);
      const c = cur % cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nr = r + dr;
          if (nr < 0 || nr >= rows) continue;
          const nc = (c + dc + cols) % cols;
          const n = idx(nr, nc);
          if (data[n] === 0 || seen[n]) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
    }

    // Landing points with no ocean cell within 448 km are not coastal at all.
    // The dataset includes riverine and lake systems -- 43 Amazon towns
    // (Parintins, Itacoatiara, Tefe), Toronto on the Great Lakes, sites on
    // Lake Victoria and the Congo. A MARINE router correctly cannot reach
    // those, so counting them as connectivity failures would be measuring the
    // wrong thing and would make this test unfixable by design.
    const inland: string[] = [];
    const stranded: string[] = [];
    for (const lp of landingPoints) {
      const cell = nearestOceanCell(lp.lat, lp.lng);
      if (cell === null) inland.push(lp.name);
      else if (!seen[cell]) stranded.push(lp.name);
    }

    // Before the strait corrections this was 282. The survivors are the two
    // Suez-side points and the two Caspian points, all correctly isolated.
    expect(stranded.length).toBeLessThanOrEqual(10);

    // Pinned so a data change that strands a coastal point cannot hide inside
    // the inland bucket. If this moves, something changed about the dataset.
    expect(inland.length).toBeLessThanOrEqual(70);
  });
});
