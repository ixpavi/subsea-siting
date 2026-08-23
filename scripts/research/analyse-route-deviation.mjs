// EXPERIMENT STEP 1-2: is there anything here to recover?
//
// The study wants to infer the cost surface cable engineers implicitly
// optimise. That premise dies immediately if either of two things is true:
//
//   (a) Cables essentially go straight. If observed routes sit on the geodesic
//       between their endpoints, there is no deviation to explain and no cost
//       surface to recover. Worth knowing before building an optimiser.
//
//   (b) Cables deviate, but only around land. "Cables avoid continents" is
//       true, trivial, and not a finding. Any route whose straight line runs
//       through a landmass HAD to bend, and it tells us nothing about seabed
//       preference. Pooling those with the interesting cases would manufacture
//       a strong result out of geography.
//
// So routes are split by whether their geodesic is navigable, and the real
// question is asked only of the subset where going straight was physically
// possible: given that the cable COULD have gone straight over water, did it
// still deviate, and does the seabed explain where it went instead?
//
// This script deliberately reports the answer even if the answer is no.
import { readFileSync, existsSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  BathyGrid, haversineKm, crossTrackKm, interpolateGreatCircle, resampleByLength,
} from "./lib/bathyGrid.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TILES = join(__dirname, ".cache", "bathy-tiles");
const CORPUS = join(__dirname, ".cache", "cable-corpus.json");

if (!existsSync(join(TILES, "manifest.json"))) {
  console.error("Missing bathymetry tiles. Run build-bathymetry-tiles.mjs first.");
  process.exit(1);
}

const grid = new BathyGrid(TILES, 240);
const corpus = JSON.parse(readFileSync(CORPUS, "utf-8"));
const COVERAGE = { minLat: 11.0, maxLat: 90.0, minLng: -70.5, maxLng: 43.0 };

/** Samples per route. Fixed rather than per-km so every route contributes
 *  equally to pooled statistics -- otherwise the 6,419 km route would outvote
 *  a hundred short ones and the result would describe that one cable. */
const SAMPLES = 200;

// Rebuild the validated 355: inside coverage, and no missing terrain.
const routes = [];
for (const r of corpus.routes) {
  if (!r.coordinates.every(([lng, lat]) =>
    lat >= COVERAGE.minLat && lat <= COVERAGE.maxLat && lng >= COVERAGE.minLng && lng <= COVERAGE.maxLng)) continue;
  if (!r.coordinates.every(([lng, lat]) => grid.elevation(lat, lng) !== null)) continue;
  routes.push(r);
}
console.log(`Routes with complete terrain: ${routes.length}\n`);

// --- Per-route geometry and terrain ----------------------------------------
const rows = [];
for (const r of routes) {
  const [lng1, lat1] = r.coordinates[0];
  const [lng2, lat2] = r.coordinates[r.coordinates.length - 1];
  const geodesicKm = haversineKm(lat1, lng1, lat2, lng2);
  if (geodesicKm < 1) continue; // loops / near-coincident endpoints

  const obs = resampleByLength(r.coordinates, SAMPLES);
  const geo = Array.from({ length: SAMPLES }, (_, k) =>
    interpolateGreatCircle(lat1, lng1, lat2, lng2, k / (SAMPLES - 1)));

  // How far off the straight line did it go?
  let maxXt = 0, sumXt = 0;
  for (const [la, ln] of obs) {
    const xt = Math.abs(crossTrackKm(lat1, lng1, lat2, lng2, la, ln));
    if (xt > maxXt) maxXt = xt;
    sumXt += xt;
  }

  // Was the straight line even available? Terrain outside the loaded corridor
  // is unknown, not water -- conflating the two would silently classify
  // unexamined geodesics as navigable.
  let geoLand = 0, geoUnknown = 0;
  const sample = (pts) => {
    const d = [], s = [], g = [];
    for (const [la, ln] of pts) {
      const dep = grid.depth(la, ln);
      const sl = grid.slope(la, ln);
      const ro = grid.roughness(la, ln);
      if (dep !== null) d.push(dep);
      if (sl !== null) s.push(sl);
      if (ro !== null) g.push(ro);
    }
    return { depth: d, slope: s, rough: g };
  };
  for (const [la, ln] of geo) {
    const e = grid.elevation(la, ln);
    if (e === null) geoUnknown++;
    else if (e >= 0) geoLand++;
  }

  rows.push({
    source: r.source,
    lengthKm: r.lengthKm,
    geodesicKm,
    sinuosity: r.lengthKm / geodesicKm,
    maxCrossTrackKm: maxXt,
    meanCrossTrackKm: sumXt / SAMPLES,
    geoLandFrac: geoLand / SAMPLES,
    geoUnknownFrac: geoUnknown / SAMPLES,
    obsTerrain: sample(obs),
    geoTerrain: sample(geo),
  });
}

// --- Statistics helpers -----------------------------------------------------
const median = (a) => {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (a, p) => {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

/** Exact-ish sign test on paired differences. Chosen over a t-test because
 *  these distributions are heavily skewed and nothing here is Gaussian. */
function signTest(diffs) {
  const nz = diffs.filter((d) => d !== 0 && Number.isFinite(d));
  const pos = nz.filter((d) => d > 0).length;
  const n = nz.length;
  if (n < 8) return { n, pos, p: NaN };
  const z = (Math.abs(pos - n / 2) - 0.5) / Math.sqrt(n / 4);
  // Two-sided normal approximation to the binomial.
  const p = 2 * (1 - 0.5 * (1 + erf(z / Math.SQRT2)));
  return { n, pos, p };
}
function erf(x) {
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

// --- STEP 1: do routes deviate at all? -------------------------------------
console.log("=== STEP 1: DEVIATION FROM THE GEODESIC ===");
console.log(`  n = ${rows.length} routes\n`);
const sin = rows.map((r) => r.sinuosity);
console.log("  sinuosity (route length / straight-line length)");
console.log(`    p10 ${quantile(sin, 0.1).toFixed(3)}   median ${median(sin).toFixed(3)}   ` +
  `p90 ${quantile(sin, 0.9).toFixed(3)}   max ${Math.max(...sin).toFixed(2)}`);
const straight = rows.filter((r) => r.sinuosity < 1.02).length;
console.log(`    routes within 2% of straight: ${straight} (${((100 * straight) / rows.length).toFixed(1)}%)`);

const mx = rows.map((r) => r.maxCrossTrackKm);
console.log("\n  maximum lateral departure from the straight line, km");
console.log(`    p10 ${quantile(mx, 0.1).toFixed(1)}   median ${median(mx).toFixed(1)}   ` +
  `p90 ${quantile(mx, 0.9).toFixed(1)}   max ${Math.max(...mx).toFixed(0)}`);

// --- STEP 1b: was the straight line even legal? ----------------------------
console.log("\n=== STEP 1b: WAS GOING STRAIGHT POSSIBLE? ===");
const blocked = rows.filter((r) => r.geoLandFrac > 0.01);
const unknown = rows.filter((r) => r.geoLandFrac <= 0.01 && r.geoUnknownFrac > 0.05);
const open = rows.filter((r) => r.geoLandFrac <= 0.01 && r.geoUnknownFrac <= 0.05);
console.log(`  geodesic crosses land      : ${blocked.length}  (deviation is forced -- excluded)`);
console.log(`  geodesic leaves coverage   : ${unknown.length}  (cannot verify -- excluded)`);
console.log(`  geodesic entirely navigable: ${open.length}  <-- the informative subset`);

const openKm = open.reduce((a, r) => a + r.lengthKm, 0);
console.log(`  informative subset: ${Math.round(openKm).toLocaleString()} km`);

if (open.length < 30) {
  console.log("\n  *** Too few routes with a navigable straight line to test. ***");
  process.exit(0);
}

const oSin = open.map((r) => r.sinuosity);
const oMx = open.map((r) => r.maxCrossTrackKm);
console.log("\n  Within that subset -- these cables COULD have gone straight over water:");
console.log(`    sinuosity      median ${median(oSin).toFixed(3)}  p90 ${quantile(oSin, 0.9).toFixed(3)}`);
console.log(`    max departure  median ${median(oMx).toFixed(1)} km  p90 ${quantile(oMx, 0.9).toFixed(1)} km`);
const oStraight = open.filter((r) => r.sinuosity < 1.02).length;
console.log(`    still within 2% of straight: ${oStraight} (${((100 * oStraight) / open.length).toFixed(1)}%)`);

// --- STEP 2: does the seabed explain where they went instead? --------------
console.log("\n=== STEP 2: DOES THE SEABED EXPLAIN THE DEVIATION? ===");
console.log("  Paired per route: terrain along the OBSERVED route vs along the");
console.log("  straight line it declined to take. Negative = observed is lower.\n");

const stat = (t, key, fn) => (t[key].length ? fn(t[key]) : NaN);
const comparisons = [
  ["median depth (m)", "depth", (a) => median(a)],
  ["max depth (m)", "depth", (a) => Math.max(...a)],
  ["median slope (m/m)", "slope", (a) => median(a)],
  ["90th pct slope (m/m)", "slope", (a) => quantile(a, 0.9)],
  ["median roughness (m)", "rough", (a) => median(a)],
];

console.log("  " + "measure".padEnd(24) + "obs median".padStart(12) + "geo median".padStart(12) +
  "median diff".padStart(13) + "obs lower".padStart(11) + "p".padStart(10));

const results = [];
for (const [label, key, fn] of comparisons) {
  const diffs = [];
  const obsVals = [];
  const geoVals = [];
  for (const r of open) {
    const o = stat(r.obsTerrain, key, fn);
    const g = stat(r.geoTerrain, key, fn);
    if (!Number.isFinite(o) || !Number.isFinite(g)) continue;
    obsVals.push(o);
    geoVals.push(g);
    diffs.push(o - g);
  }
  const t = signTest(diffs);
  const lowerPct = (100 * (t.n - t.pos)) / t.n;
  const fmt = key === "slope" ? 5 : 1;
  console.log(
    "  " + label.padEnd(24) +
    median(obsVals).toFixed(fmt).padStart(12) +
    median(geoVals).toFixed(fmt).padStart(12) +
    median(diffs).toFixed(fmt).padStart(13) +
    `${lowerPct.toFixed(0)}%`.padStart(11) +
    (t.p < 1e-4 ? "<1e-4" : t.p.toFixed(4)).padStart(10)
  );
  results.push({ label, obsMedian: median(obsVals), geoMedian: median(geoVals), medianDiff: median(diffs), lowerPct, p: t.p, n: t.n });
}

console.log("\n  READING THIS: 'obs lower' is the share of routes where the observed");
console.log("  route scores below its straight line. 50% means the seabed is doing");
console.log("  nothing. With n in the hundreds, p-values will be small for effects");
console.log("  too weak to matter -- judge the median difference, not the p.");

writeFileSync(join(__dirname, ".cache", "deviation-analysis.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  samplesPerRoute: SAMPLES,
  totals: { analysed: rows.length, blockedByLand: blocked.length, outsideCoverage: unknown.length, informative: open.length },
  informativeKm: openKm,
  sinuosity: { median: median(oSin), p90: quantile(oSin, 0.9) },
  maxCrossTrackKm: { median: median(oMx), p90: quantile(oMx, 0.9) },
  terrainComparisons: results,
}, null, 2));
console.log("\n  wrote deviation-analysis.json");
