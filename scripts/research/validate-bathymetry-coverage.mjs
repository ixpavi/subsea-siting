// Acceptance test for the Phase 1 bathymetry tile set.
//
// Downloading 789 tiles proves only that 789 HTTP requests succeeded. Before
// any modelling is built on them, three things have to be true, and each is
// checked here against the real cable corpus rather than assumed:
//
//   1. ORIENTATION. If the raster row order is flipped, every lookup silently
//      returns terrain from the wrong latitude. Nothing crashes; the grid still
//      looks like bathymetry; every result afterwards is wrong. Asserted
//      against two hand-picked points whose land/sea status is not in doubt.
//
//   2. COVERAGE. Ten tiles failed with HTTP 500 -- genuine holes in EMODnet's
//      data, since the declared envelope is a rectangle and the actual coverage
//      is not. A route crossing a hole cannot be explained by terrain we do not
//      have, and must be excluded rather than quietly interpolated over.
//
//   3. INDEPENDENT AGREEMENT. The cable positions and the bathymetry come from
//      completely separate sources. Submarine cables are, definitionally, in
//      water. So if route vertices land on positive elevation, either the
//      georeferencing is wrong or one of the datasets is not what it claims.
//      This is the strongest cheap check available and it costs nothing.
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TILES = join(__dirname, ".cache", "bathy-tiles");
const CORPUS = join(__dirname, ".cache", "cable-corpus.json");
const PER_DEG = 240;
const NODATA = -32768;

const tileCache = new Map();
function tile(lat, lng) {
  const key = `${lat}_${lng}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const p = join(TILES, `${key}.bin`);
  const data = existsSync(p) ? new Int16Array(readFileSync(p).buffer.slice(0)) : null;
  tileCache.set(key, data);
  return data;
}

/** Elevation in metres at a point, or null if no tile / no data.
 *  GeoTIFF origin is top-left, so raster row 0 is the NORTH edge. */
function elevationAt(lat, lng) {
  const tLat = Math.floor(lat);
  const tLng = Math.floor(lng);
  const t = tile(tLat, tLng);
  if (!t) return { v: null, reason: "no-tile" };
  let row = Math.floor((tLat + 1 - lat) * PER_DEG);
  let col = Math.floor((lng - tLng) * PER_DEG);
  row = Math.min(PER_DEG - 1, Math.max(0, row));
  col = Math.min(PER_DEG - 1, Math.max(0, col));
  const v = t[row * PER_DEG + col];
  return v === NODATA ? { v: null, reason: "nodata" } : { v, reason: null };
}

// --- 1. Orientation ---------------------------------------------------------
// Both points are inside tile (51,2). Bruges sits ~10 km inland in Belgium;
// the second point is open North Sea well offshore. If rows were flipped these
// two would swap, so this discriminates the failure it is meant to catch.
console.log("=== 1. ORIENTATION ===");
const land = elevationAt(51.21, 2.92);   // inland Belgium
const sea = elevationAt(51.9, 2.5);      // open North Sea
console.log(`  inland Belgium (51.21, 2.92): ${land.v} m   expect POSITIVE`);
console.log(`  open North Sea (51.90, 2.50): ${sea.v} m   expect NEGATIVE`);
const orientationOk = land.v !== null && sea.v !== null && land.v > 0 && sea.v < 0;
console.log(`  ${orientationOk ? "PASS" : "*** FAIL -- raster orientation is wrong, stop here ***"}`);
if (!orientationOk) process.exit(1);

// --- 2 & 3. Coverage and agreement over the real corpus ---------------------
const corpus = JSON.parse(readFileSync(CORPUS, "utf-8"));
const COVERAGE = { minLat: 11.0, maxLat: 90.0, minLng: -70.5, maxLng: 43.0 };
const covered = corpus.routes.filter((r) =>
  r.coordinates.every(([lng, lat]) =>
    lat >= COVERAGE.minLat && lat <= COVERAGE.maxLat && lng >= COVERAGE.minLng && lng <= COVERAGE.maxLng)
);

let vTotal = 0, vNoTile = 0, vNoData = 0, vLand = 0;
const depths = [];
const clean = [];
const holed = [];

for (const r of covered) {
  let noTile = 0, noData = 0, onLand = 0;
  for (const [lng, lat] of r.coordinates) {
    vTotal++;
    const { v, reason } = elevationAt(lat, lng);
    if (reason === "no-tile") { noTile++; vNoTile++; continue; }
    if (reason === "nodata") { noData++; vNoData++; continue; }
    if (v > 0) { onLand++; vLand++; }
    else depths.push(-v);
  }
  const bad = noTile + noData;
  const rec = { ...r, noTile, noData, onLand, badFraction: bad / r.coordinates.length };
  (bad === 0 ? clean : holed).push(rec);
}

console.log("\n=== 2. COVERAGE over corpus routes ===");
console.log(`  route vertices checked : ${vTotal.toLocaleString()}`);
console.log(`  missing tile           : ${vNoTile.toLocaleString()} (${((100 * vNoTile) / vTotal).toFixed(3)}%)`);
console.log(`  tile present, no data  : ${vNoData.toLocaleString()} (${((100 * vNoData) / vTotal).toFixed(3)}%)`);
console.log(`  routes fully covered   : ${clean.length} of ${covered.length}`);
if (holed.length) {
  console.log(`  routes with gaps       : ${holed.length}`);
  for (const h of holed.slice(0, 8)) {
    console.log(`    ${h.source.padEnd(20)} ${h.lengthKm.toFixed(0).padStart(6)} km  ` +
      `${(100 * h.badFraction).toFixed(1)}% of vertices missing`);
  }
}
const cleanKm = clean.reduce((a, r) => a + r.lengthKm, 0);
console.log(`  usable after exclusion : ${clean.length} routes, ${Math.round(cleanKm).toLocaleString()} km`);

console.log("\n=== 3. INDEPENDENT AGREEMENT (cables should be in water) ===");
console.log(`  vertices on positive elevation: ${vLand.toLocaleString()} (${((100 * vLand) / vTotal).toFixed(3)}%)`);

// "It's just landfall" is a claim, not an observation, and the two failure
// modes it could be hiding look identical in the aggregate. If these vertices
// sit at route ENDS, it is landfall and the tiles are fine. If they are spread
// through route middles, the georeferencing is off or one dataset is not what
// it claims -- same 1.7%, opposite conclusion. So locate them.
const positionOfLandVertex = [];
for (const r of covered) {
  const n = r.coordinates.length;
  for (let i = 0; i < n; i++) {
    const [lng, lat] = r.coordinates[i];
    const { v, reason } = elevationAt(lat, lng);
    if (reason === null && v > 0) positionOfLandVertex.push(n === 1 ? 0 : i / (n - 1));
  }
}
// Fold to distance-from-nearest-end: 0 = at an endpoint, 0.5 = mid-route.
const fromEnd = positionOfLandVertex.map((p) => Math.min(p, 1 - p));
console.log("\n  where along the route are they? (0 = at an end, 0.5 = mid-route)");
for (const [lo, hi] of [[0, 0.02], [0.02, 0.05], [0.05, 0.1], [0.1, 0.25], [0.25, 0.5]]) {
  const n = fromEnd.filter((p) => p >= lo && p < hi).length;
  const bar = "#".repeat(Math.round((50 * n) / fromEnd.length));
  console.log(`    ${lo.toFixed(2)}-${hi.toFixed(2)} ${((100 * n) / fromEnd.length).toFixed(1).padStart(5)}%  ${bar}`);
}
const nearEnd = fromEnd.filter((p) => p < 0.05).length;
console.log(`  ${((100 * nearEnd) / fromEnd.length).toFixed(1)}% lie in the outer 5% of their route.`);
console.log("  Concentrated at ends = landfall at ~460 m cells, which is expected");
console.log("  and harmless. Spread through the middle would mean a real problem.");

depths.sort((a, b) => a - b);
const q = (p) => depths[Math.floor(depths.length * p)];
console.log("\n=== DEPTH DISTRIBUTION along corpus routes ===");
console.log(`  n=${depths.length.toLocaleString()}  min ${q(0).toFixed(0)} m  p25 ${q(0.25).toFixed(0)} m  ` +
  `median ${q(0.5).toFixed(0)} m  p75 ${q(0.75).toFixed(0)} m  p95 ${q(0.95).toFixed(0)} m  max ${depths[depths.length - 1].toFixed(0)} m`);
for (const [lo, hi] of [[0, 200], [200, 1000], [1000, 2000], [2000, 3000], [3000, 4000], [4000, 11000]]) {
  const n = depths.filter((d) => d >= lo && d < hi).length;
  const bar = "#".repeat(Math.round((60 * n) / depths.length));
  console.log(`  ${String(lo).padStart(5)}-${String(hi).padEnd(5)} m ${((100 * n) / depths.length).toFixed(1).padStart(5)}%  ${bar}`);
}
