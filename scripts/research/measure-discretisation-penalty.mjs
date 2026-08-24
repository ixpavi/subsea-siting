// Is the grid itself penalising the routers?
//
// The prediction experiment found every bathymetry-aware method WORSE than a
// great circle at reproducing real cables. Before that can be reported as
// "terrain does not help", one confound has to be eliminated.
//
// The geodesic is a smooth analytic curve. Every other method is a path over an
// 8-connected 460 m grid, which can only step in 45-degree increments and must
// snap its endpoints to water cells. Those are properties of the SEARCH, not of
// terrain, and they add deviation on their own. If that penalty is large, then
// "A* is worse than a straight line" says something about A* on a grid rather
// than something about bathymetry, and the headline would be wrong.
//
// THE MEASUREMENT. Take the zero-weight router -- terrain completely ignored,
// so it is trying to find the shortest path, which over open water IS the
// geodesic -- and measure how far its output lands from the true great circle.
// Any difference is pure discretisation and endpoint-snapping cost, with no
// terrain involved at all.
//
// Restricted to route pairs whose great circle stays in open water, because
// where the geodesic crosses land the two SHOULD differ and the comparison
// would measure obstacle avoidance instead.
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { BathyGrid, interpolateGreatCircle } from "./lib/bathyGrid.mjs";
import { routeBetween, ZERO_WEIGHTS } from "./lib/corridorRouter.mjs";
import { routeDeviationKm, geodesicPath } from "./lib/routeDeviation.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const grid = new BathyGrid(join(__dirname, ".cache", "bathy-tiles"), 240);
const corpus = JSON.parse(readFileSync(join(__dirname, ".cache", "cable-corpus.json"), "utf-8"));
const COVERAGE = { minLat: 11, maxLat: 90, minLng: -70.5, maxLng: 43 };

const MIN_KM = 40, MAX_KM = 500, CORRIDOR = 1.0;

const routes = corpus.routes.filter(
  (r) =>
    r.lengthKm >= MIN_KM && r.lengthKm <= MAX_KM &&
    r.coordinates.every(
      ([lng, lat]) =>
        lat >= COVERAGE.minLat && lat <= COVERAGE.maxLat &&
        lng >= COVERAGE.minLng && lng <= COVERAGE.maxLng &&
        grid.elevation(lat, lng) !== null
    )
);

const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (a, p) => {
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

console.log(`Routes in band: ${routes.length}`);
console.log("Measuring how far the ZERO-WEIGHT router lands from the true great");
console.log("circle, on pairs whose great circle never touches land.\n");

const clean = [];
const penalties = [];
let blocked = 0;

for (const r of routes) {
  const obs = r.coordinates.map(([lng, lat]) => [lat, lng]);
  const a = obs[0], b = obs[obs.length - 1];

  // Is the great circle navigable end to end? If not, A* SHOULD diverge and
  // the pair says nothing about discretisation.
  let allWater = true;
  for (let i = 0; i <= 60; i++) {
    const [lat, lng] = interpolateGreatCircle(a[0], a[1], b[0], b[1], i / 60);
    const e = grid.elevation(lat, lng);
    if (e === null || e >= 0) { allWater = false; break; }
  }
  if (!allWater) { blocked++; continue; }

  const res = routeBetween(grid, a, b, ZERO_WEIGHTS, CORRIDOR);
  if (!res.reachable) continue;
  const dev = routeDeviationKm(geodesicPath(a, b), res.path);
  if (!dev) continue;

  clean.push(r);
  penalties.push(dev.meanKm);
}

console.log(`  great circle crosses land : ${blocked} (excluded -- divergence there is obstacle avoidance)`);
console.log(`  usable open-water pairs   : ${penalties.length}\n`);

if (penalties.length < 20) {
  console.log("  Too few open-water pairs to measure the penalty.");
  process.exit(0);
}

const med = median(penalties);
const p90 = quantile(penalties, 0.9);
const mean = penalties.reduce((x, y) => x + y, 0) / penalties.length;

console.log("=== DISCRETISATION PENALTY (no terrain involved) ===");
console.log(`  median ${med.toFixed(2)} km   mean ${mean.toFixed(2)} km   p90 ${p90.toFixed(2)} km`);
console.log("");
console.log("  This is how far a shortest-path search over the grid lands from the");
console.log("  straight line it is trying to reproduce, using no terrain at all.");

// --- What it means for the headline ---------------------------------------
const pred = JSON.parse(readFileSync(join(__dirname, ".cache", "route-prediction.json"), "utf-8"));
const byId = Object.fromEntries(pred.summary.map((s) => [s.id, s]));
const geo = byId.geodesic.medianKm;
const sea = byId.seapath.medianKm;
const fitted = byId.fitted.medianKm;
const observedGap = sea - geo;

console.log("\n=== DOES THE PENALTY EXPLAIN THE HEADLINE? ===");
console.log(`  geodesic error vs real cables      : ${geo.toFixed(2)} km`);
console.log(`  shortest sea path error            : ${sea.toFixed(2)} km`);
console.log(`  gap to explain                     : ${observedGap.toFixed(2)} km`);
console.log(`  measured discretisation penalty    : ${med.toFixed(2)} km`);
console.log("");

const explains = med >= observedGap * 0.6;
if (explains) {
  console.log("  THE PENALTY LARGELY EXPLAINS THE GAP.");
  console.log("  The grid search is handicapped by roughly the amount that separates");
  console.log("  it from the geodesic, so 'A* is worse than a straight line' is a");
  console.log("  statement about the discretisation, NOT about bathymetry. The valid");
  console.log("  comparison is between weighted and unweighted A*, which share the");
  console.log("  handicap exactly -- and there terrain preference does help");
  console.log(`  (fitted ${fitted.toFixed(2)} km vs sea path ${sea.toFixed(2)} km).`);
} else {
  console.log("  THE PENALTY DOES NOT EXPLAIN THE GAP.");
  console.log("  The grid handicap is small compared with how far the terrain-aware");
  console.log("  routes land from real cables, so the result stands: routing over this");
  console.log("  bathymetry predicts real cable positions worse than a straight line.");
}

console.log("\n  Either way, the weighted-vs-unweighted comparison is the sound one:");
console.log("  both run the same search on the same grid, so the discretisation");
console.log("  penalty cancels and only the terrain preference differs.");

writeFileSync(join(__dirname, ".cache", "discretisation-penalty.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  design: "zero-weight A* vs true great circle, on pairs whose great circle is entirely over water",
  openWaterPairs: penalties.length,
  blockedByLand: blocked,
  penaltyKm: { median: med, mean, p90 },
  headline: { geodesicKm: geo, seapathKm: sea, fittedKm: fitted, gapKm: observedGap },
  penaltyExplainsGap: explains,
}, null, 2));
console.log("\nwrote discretisation-penalty.json");
