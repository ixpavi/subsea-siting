// Finds the connected components of the routing engine's ocean grid, and
// checks which real cable landing points can actually reach each other.
//
// WHY. Mumbai -> Marseille returns no route at all. The engine documents a
// known limitation -- Suez and Panama are not navigable, because the source
// polygons only contain natural coastline -- and states that such routes come
// out "around Africa" instead. Going around Africa to Marseille still requires
// passing Gibraltar, which is about 14 km wide against 55 km grid cells.
//
// If Gibraltar is closed in the raster then the Mediterranean is a SEALED
// BASIN, and every route between the Med and anywhere else fails. That is a
// materially different and much larger defect than the documented canal
// limitation, and it would silently affect Marseille, Barcelona, Genoa,
// Athens, Alexandria and Tel Aviv -- all real cable hubs. This script settles
// which of the two situations we are in, and enumerates every affected
// landing point rather than reasoning from a couple of spot checks.
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "public", "data");

const grid = JSON.parse(readFileSync(join(DATA, "ocean-grid.json"), "utf-8"));
const landingPoints = JSON.parse(readFileSync(join(DATA, "landing-points.json"), "utf-8"));
const { rows, cols, resolutionDeg } = grid;
const data = Uint8Array.from(grid.data);

console.log(`Grid ${rows} x ${cols} at ${resolutionDeg} deg (${(111.32 * resolutionDeg).toFixed(0)} km cells)`);
const oceanCells = data.reduce((a, v) => a + (v > 0 ? 1 : 0), 0);
console.log(`Ocean cells: ${oceanCells.toLocaleString()} of ${(rows * cols).toLocaleString()}\n`);

// --- Connected components, 8-connected with longitude wrap -----------------
// 8-connected to match the A* neighbourhood; a component analysis using
// 4-connectivity would report MORE isolation than the router actually suffers
// and overstate the problem.
const label = new Int32Array(rows * cols).fill(-1);
const sizes = [];
const idx = (r, c) => r * cols + c;

for (let r0 = 0; r0 < rows; r0++) {
  for (let c0 = 0; c0 < cols; c0++) {
    if (data[idx(r0, c0)] === 0 || label[idx(r0, c0)] !== -1) continue;
    const id = sizes.length;
    let count = 0;
    const stack = [idx(r0, c0)];
    label[idx(r0, c0)] = id;
    while (stack.length) {
      const cur = stack.pop();
      count++;
      const r = (cur / cols) | 0;
      const c = cur % cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr;
          if (nr < 0 || nr >= rows) continue;
          // Longitude wraps: column 0 and column cols-1 are adjacent.
          const nc = (c + dc + cols) % cols;
          const n = idx(nr, nc);
          if (data[n] === 0 || label[n] !== -1) continue;
          label[n] = id;
          stack.push(n);
        }
      }
    }
    sizes.push(count);
  }
}

const ranked = sizes.map((n, i) => ({ id: i, n })).sort((a, b) => b.n - a.n);
console.log(`=== ${sizes.length} disconnected water bodies ===`);
console.log("  " + "rank".padEnd(6) + "cells".padStart(9) + "% of ocean".padStart(12));
for (const { id, n } of ranked.slice(0, 8)) {
  console.log("  " + `#${id}`.padEnd(6) + n.toLocaleString().padStart(9) +
    ((100 * n) / oceanCells).toFixed(2).padStart(12));
}

// --- Where do real landing points fall? ------------------------------------
const latToRow = (lat) => Math.min(rows - 1, Math.max(0, Math.floor((lat + 90) / resolutionDeg)));
const lngToCol = (lng) => ((Math.floor((lng + 180) / resolutionDeg) % cols) + cols) % cols;

/** Landing points sit on the coast, so their own cell is usually land. The
 *  router snaps to the nearest ocean cell; this mirrors that so the component
 *  attributed here is the one the router would actually search in. */
function nearestOceanComponent(lat, lng, maxRing = 8) {
  const r0 = latToRow(lat);
  const c0 = lngToCol(lng);
  for (let ring = 0; ring <= maxRing; ring++) {
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const r = r0 + dr;
        if (r < 0 || r >= rows) continue;
        const c = (c0 + dc + cols) % cols;
        if (data[idx(r, c)] > 0) return label[idx(r, c)];
      }
    }
  }
  return null;
}

const byComponent = new Map();
let unreachable = 0;
for (const lp of landingPoints) {
  const comp = nearestOceanComponent(lp.lat, lp.lng);
  if (comp === null) { unreachable++; continue; }
  if (!byComponent.has(comp)) byComponent.set(comp, []);
  byComponent.get(comp).push(lp);
}

const main = ranked[0].id;
console.log(`\n=== LANDING POINTS BY WATER BODY (${landingPoints.length} total) ===`);
const groups = [...byComponent.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [comp, lps] of groups) {
  const tag = comp === main ? "  <-- main ocean" : "";
  console.log(`  water body #${comp}: ${lps.length} landing points${tag}`);
  if (comp !== main) {
    for (const lp of lps.slice(0, 12)) console.log(`      ${lp.name}`);
    if (lps.length > 12) console.log(`      ... and ${lps.length - 12} more`);
  }
}
if (unreachable) console.log(`  no ocean cell within 8 cells: ${unreachable}`);

const stranded = groups.filter(([c]) => c !== main).reduce((a, [, l]) => a + l.length, 0);
console.log(`\n=== IMPACT ===`);
console.log(`  landing points on the main ocean : ${byComponent.get(main)?.length ?? 0}`);
console.log(`  landing points on isolated water : ${stranded}`);
console.log(`  unreachable from the main ocean  : ${((100 * stranded) / landingPoints.length).toFixed(1)}% of all landing points`);
console.log("\n  Any city pair spanning two different water bodies returns NO route.");

// --- Is Gibraltar specifically closed? -------------------------------------
console.log("\n=== SPOT CHECK: the straits that matter ===");
const STRAITS = [
  ["Gibraltar", 35.95, -5.6, "Mediterranean <-> Atlantic"],
  ["Suez", 30.0, 32.55, "Mediterranean <-> Red Sea"],
  ["Bab-el-Mandeb", 12.6, 43.35, "Red Sea <-> Indian Ocean"],
  ["Panama", 9.1, -79.7, "Caribbean <-> Pacific"],
  ["Dover", 51.0, 1.5, "North Sea <-> Channel"],
  ["Malacca", 2.5, 101.5, "Andaman <-> South China Sea"],
  ["Bosphorus", 41.1, 29.1, "Black Sea <-> Mediterranean"],
];
console.log("  " + "strait".padEnd(16) + "cell".padStart(8) + "  connects");
for (const [name, lat, lng, what] of STRAITS) {
  const v = data[idx(latToRow(lat), lngToCol(lng))];
  console.log("  " + name.padEnd(16) + (v > 0 ? "water" : "LAND").padStart(8) + "  " + what);
}

writeFileSync(join(__dirname, "..", "scripts", "grid-connectivity.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  grid: { rows, cols, resolutionDeg },
  waterBodies: sizes.length,
  mainComponentCells: ranked[0].n,
  strandedLandingPoints: stranded,
  groups: groups.map(([comp, lps]) => ({
    component: comp, isMain: comp === main, count: lps.length,
    names: comp === main ? undefined : lps.map((l) => l.name),
  })),
}, null, 2));
console.log("\nwrote scripts/grid-connectivity.json");
