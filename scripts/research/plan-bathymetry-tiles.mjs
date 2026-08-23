// Plans -- but does not download -- the bathymetry tile set needed to study the
// as-laid cable corpus.
//
// WHY PLAN FIRST. EMODnet Bathymetry's full coverage is 108,960 x 75,840 cells
// (8.3 billion) at its native 1/16 arc-minute. Downloading that to study 412
// routes would be absurd. The routes occupy a small fraction of it. This script
// measures exactly which fraction, so the download is a decision with a number
// behind it rather than a guess.
//
// WHY A CORRIDOR, NOT JUST THE ROUTE. The research question is why a cable went
// HERE and not THERE. Answering it requires bathymetry along the observed route
// AND along the alternatives it did not take. Sampling only the route itself
// would beg the question -- every observed route would look optimal because no
// competing terrain was ever loaded. The dilation radius below is the width of
// the "there" we are prepared to consider.
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(__dirname, ".cache", "cable-corpus.json");

if (!existsSync(CORPUS)) {
  console.error("Missing cable-corpus.json. Run build-cable-corpus.mjs first.");
  process.exit(1);
}

/** EMODnet Bathymetry coverage, read from the WCS DescribeCoverage envelope. */
const COVERAGE = { minLat: 11.0, maxLat: 90.0, minLng: -70.5, maxLng: 43.0 };

/** Native grid: 960 cells per degree = 1/16 arc-minute = 3.75 arc-seconds. */
const NATIVE_PER_DEG = 960;

const corpus = JSON.parse(readFileSync(CORPUS, "utf-8"));
const routes = corpus.routes;

const inCoverage = (lat, lng) =>
  lat >= COVERAGE.minLat && lat <= COVERAGE.maxLat && lng >= COVERAGE.minLng && lng <= COVERAGE.maxLng;

// --- Split the corpus by whether EMODnet Bathymetry can serve it ------------
const covered = [];
const uncovered = [];
for (const r of routes) {
  const inside = r.coordinates.filter(([lng, lat]) => inCoverage(lat, lng)).length;
  const frac = inside / r.coordinates.length;
  // A route is only usable for THIS phase if essentially all of it has terrain.
  // A route half-covered by bathymetry cannot be explained by that bathymetry.
  (frac >= 0.99 ? covered : uncovered).push({ ...r, coveredFraction: frac });
}

const km = (rs) => Math.round(rs.reduce((a, r) => a + r.lengthKm, 0)).toLocaleString();
console.log("=== PHASE 1 SCOPE: routes inside EMODnet Bathymetry coverage ===");
console.log(`  fully covered   : ${String(covered.length).padStart(4)} routes, ${km(covered).padStart(8)} km`);
console.log(`  not/partly      : ${String(uncovered.length).padStart(4)} routes, ${km(uncovered).padStart(8)} km`);

const byRegion = {};
for (const r of uncovered) {
  const k = r.source;
  byRegion[k] = (byRegion[k] ?? 0) + 1;
}
console.log("  excluded by source:", JSON.stringify(byRegion));

// --- Tile demand at several corridor widths ---------------------------------
// Tiles are whole degrees, which is also how the WCS is most cheaply queried.
function tilesFor(rs, dilationDeg) {
  const tiles = new Set();
  const d = Math.ceil(dilationDeg);
  for (const r of rs) {
    for (const [lng, lat] of r.coordinates) {
      const bLat = Math.floor(lat);
      const bLng = Math.floor(lng);
      for (let dy = -d; dy <= d; dy++) {
        for (let dx = -d; dx <= d; dx++) {
          const tLat = bLat + dy;
          const tLng = bLng + dx;
          if (tLat < COVERAGE.minLat || tLat >= COVERAGE.maxLat) continue;
          if (tLng < COVERAGE.minLng || tLng >= COVERAGE.maxLng) continue;
          tiles.add(`${tLat},${tLng}`);
        }
      }
    }
  }
  return tiles;
}

console.log("\n=== TILE DEMAND (1-degree tiles) vs corridor width ===");
console.log(
  "  " + "corridor".padEnd(14) + "tiles".padStart(7) +
  "native MB".padStart(12) + "460m MB".padStart(10) + "925m MB".padStart(10)
);
for (const dil of [0, 1, 2, 3]) {
  const t = tilesFor(covered, dil);
  // float32 payload; the TIFFs are effectively uncompressed at these sizes.
  const mb = (perDeg) => ((t.size * perDeg * perDeg * 4) / 1e6).toFixed(0);
  const label = dil === 0 ? "route only" : `+/- ${dil} deg`;
  console.log(
    "  " + label.padEnd(14) + String(t.size).padStart(7) +
    mb(NATIVE_PER_DEG).padStart(12) + mb(240).padStart(10) + mb(120).padStart(10)
  );
}

// --- Storage of the assembled analysis grid ---------------------------------
// The tiles are a download format. What the study actually needs is one
// contiguous grid. Int16 metres is exact for bathymetry (the deepest point on
// Earth is -10,935 m) and halves float32.
console.log("\n=== ASSEMBLED GRID (Int16 metres, tight bbox of covered routes) ===");
let mnLat = 90, mxLat = -90, mnLng = 180, mxLng = -180;
for (const r of covered) {
  for (const [lng, lat] of r.coordinates) {
    if (lat < mnLat) mnLat = lat;
    if (lat > mxLat) mxLat = lat;
    if (lng < mnLng) mnLng = lng;
    if (lng > mxLng) mxLng = lng;
  }
}
console.log(`  route bbox  lat ${mnLat.toFixed(2)}..${mxLat.toFixed(2)}  lng ${mnLng.toFixed(2)}..${mxLng.toFixed(2)}`);
for (const perDeg of [240, 120]) {
  for (const dil of [1, 2]) {
    const h = (mxLat - mnLat + 2 * dil) * perDeg;
    const w = (mxLng - mnLng + 2 * dil) * perDeg;
    console.log(
      `  ${String(Math.round(111320 / perDeg)).padStart(4)} m grid, +/-${dil} deg : ` +
        `${Math.round(w).toLocaleString()} x ${Math.round(h).toLocaleString()} = ` +
        `${((w * h * 2) / 1e6).toFixed(0)} MB dense`
    );
  }
}
console.log(
  "\n  NOTE: a dense grid over the bbox is mostly empty -- the routes are\n" +
    "  corridors, not a rectangle. Sparse tile storage is the right format."
);
