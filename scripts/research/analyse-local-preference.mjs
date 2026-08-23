// EXPERIMENT STEP 3: local seabed preference, with a placebo control.
//
// WHY THIS TEST EXISTS. analyse-route-deviation.mjs compared each route against
// the geodesic between its endpoints and found almost nothing. Two weaknesses
// in that design could hide a real effect, and both are avoided here:
//
//   1. DILUTION. It averaged terrain over the whole route. Where observed route
//      and geodesic run within a few km of each other they sample nearly the
//      same seabed, so local avoidance is averaged away.
//
//   2. THE COUNTERFACTUAL MAY BE WRONG. EMODnet features are route segments
//      published by national authorities, not necessarily whole cable systems.
//      If a segment's endpoints are administrative cuts, the geodesic between
//      them is not a route anyone considered.
//
// THIS DESIGN. At each point along a route, take a transect perpendicular to
// the local heading and ask where the cable sits within it. If engineers prefer
// flat ground, the cable should sit at a lower slope percentile than the
// terrain either side. Purely local: no endpoints, no geodesic, no assumption
// about what the route was for. Under the null the expected percentile is 50.
//
// THE PLACEBO IS THE POINT. A percentile near 50 sounds like it must mean
// "no preference", but that is an assumption about the DESIGN, not a fact.
// Terrain is strongly autocorrelated and these transects are short; it is
// entirely possible for the geometry alone to push the centre of a transect
// off 50 for any line drawn on the seabed, cable or not. If so, the measured
// effect would be an artifact and the finding worthless.
//
// So the identical measurement is repeated on the same routes displaced
// sideways by 20 and 50 km. Displaced lines are not cables and cannot express
// engineering preference, but they have the same shape, the same length, the
// same headings and sit in the same terrain. Whatever they score is what this
// instrument reads when no preference exists. The real effect is the gap
// between the true routes and those, not the gap from 50.
//
// UNIT OF ANALYSIS. Adjacent samples share terrain and are not independent, so
// pooling them would inflate significance enormously. Each route contributes
// ONE number (its mean percentile) and tests run across routes.
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { BathyGrid, haversineKm, initialBearing } from "./lib/bathyGrid.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TILES = join(__dirname, ".cache", "bathy-tiles");
const CORPUS = join(__dirname, ".cache", "cable-corpus.json");

const grid = new BathyGrid(TILES, 240);
const corpus = JSON.parse(readFileSync(CORPUS, "utf-8"));
const COVERAGE = { minLat: 11.0, maxLat: 90.0, minLng: -70.5, maxLng: 43.0 };

const STEP_KM = 0.464;      // transect sampling, matched to the 464 m grid
const ALONG_STEP_KM = 2;    // spacing of sample points along each route
const METRICS = ["depth", "slope", "rough"];

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const R = 6371;

function project(lat, lng, b, d) {
  const dr = d / R;
  const la = Math.asin(Math.sin(rad(lat)) * Math.cos(dr) + Math.cos(rad(lat)) * Math.sin(dr) * Math.cos(b));
  const ln = rad(lng) + Math.atan2(
    Math.sin(b) * Math.sin(dr) * Math.cos(rad(lat)),
    Math.cos(dr) - Math.sin(rad(lat)) * Math.sin(la)
  );
  return [deg(la), deg(ln)];
}

const routes = corpus.routes.filter((r) =>
  r.coordinates.every(([lng, lat]) =>
    lat >= COVERAGE.minLat && lat <= COVERAGE.maxLat &&
    lng >= COVERAGE.minLng && lng <= COVERAGE.maxLng &&
    grid.elevation(lat, lng) !== null));

const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
function erf(x) {
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
function signTestVs50(vals) {
  const nz = vals.filter((v) => Number.isFinite(v) && v !== 50);
  const below = nz.filter((v) => v < 50).length;
  const n = nz.length;
  if (n < 8) return { n, below, p: NaN };
  const z = (Math.abs(below - n / 2) - 0.5) / Math.sqrt(n / 4);
  return { n, below, p: 2 * (1 - 0.5 * (1 + erf(z / Math.SQRT2))) };
}

/** One full pass. displacementKm shifts every sample point sideways before the
 *  transect is built; 0 is the real routes, non-zero is the placebo. The code
 *  path is otherwise IDENTICAL -- a separately written placebo could differ in
 *  some subtle way and would no longer be a control. */
function run(halfKm, displacementKm) {
  const perRoute = { depth: [], slope: [], rough: [] };
  let used = 0, skipped = 0;

  for (const r of routes) {
    const acc = { depth: [], slope: [], rough: [] };
    let carried = 0;
    for (let i = 0; i < r.coordinates.length - 1; i++) {
      const [lng1, lat1] = r.coordinates[i];
      const [lng2, lat2] = r.coordinates[i + 1];
      const segKm = haversineKm(lat1, lng1, lat2, lng2);
      if (segKm <= 0) continue;
      const bearing = initialBearing(lat1, lng1, lat2, lng2);
      const perp = bearing + Math.PI / 2;

      for (let d = carried; d < segKm; d += ALONG_STEP_KM) {
        const f = d / segKm;
        let lat = lat1 + (lat2 - lat1) * f;
        let lng = lng1 + (lng2 - lng1) * f;
        if (displacementKm !== 0) {
          [lat, lng] = project(lat, lng,
            displacementKm >= 0 ? perp : perp + Math.PI, Math.abs(displacementKm));
        }

        // If ANY of the transect is land or unknown, discard the sample: a
        // truncated transect biases the percentile, because the missing side
        // is exactly the side the cable avoided.
        const vals = { depth: [], slope: [], rough: [] };
        let ok = true, centreIdx = -1;
        for (let x = -halfKm; x <= halfKm + 1e-9; x += STEP_KM) {
          const [tla, tln] = x === 0 ? [lat, lng]
            : project(lat, lng, x >= 0 ? perp : perp + Math.PI, Math.abs(x));
          const dep = grid.depth(tla, tln);
          const sl = grid.slope(tla, tln);
          const ro = grid.roughness(tla, tln);
          if (dep === null || sl === null || ro === null) { ok = false; break; }
          if (Math.abs(x) < STEP_KM / 2) centreIdx = vals.depth.length;
          vals.depth.push(dep); vals.slope.push(sl); vals.rough.push(ro);
        }
        if (!ok || centreIdx < 0 || vals.depth.length < 5) { skipped++; continue; }
        used++;

        // Ties split, so a perfectly flat transect scores 50 rather than 0.
        for (const m of METRICS) {
          const v = vals[m][centreIdx];
          let below = 0, equal = 0;
          for (const u of vals[m]) { if (u < v) below++; else if (u === v) equal++; }
          acc[m].push((100 * (below + equal / 2)) / vals[m].length);
        }
      }
      carried = Math.max(0, carried + Math.ceil((segKm - carried) / ALONG_STEP_KM) * ALONG_STEP_KM - segKm);
    }
    if (acc.slope.length >= 5) {
      for (const m of METRICS) perRoute[m].push(acc[m].reduce((a, b) => a + b, 0) / acc[m].length);
    }
  }
  const summary = {};
  for (const m of METRICS) {
    const t = signTestVs50(perRoute[m]);
    summary[m] = { medianPercentile: median(perRoute[m]), routesBelow50: t.below, n: t.n, p: t.p };
  }
  return { summary, used, skipped, routes: perRoute.slope.length };
}

console.log(`Routes: ${routes.length}   sample spacing ${ALONG_STEP_KM} km   transect step ${(STEP_KM * 1000).toFixed(0)} m\n`);

// --- Real routes, across transect widths -----------------------------------
console.log("=== REAL ROUTES ===");
console.log("  " + "half-width".padEnd(12) + "metric".padEnd(9) +
  "median pctile".padStart(15) + "routes below 50".padStart(18) + "p".padStart(10));
const real = {};
for (const halfKm of [2, 5, 10]) {
  real[halfKm] = run(halfKm, 0);
  for (const m of METRICS) {
    const s = real[halfKm].summary[m];
    console.log("  " + `${halfKm} km`.padEnd(12) + m.padEnd(9) +
      s.medianPercentile.toFixed(2).padStart(15) +
      `${s.routesBelow50}/${s.n} (${((100 * s.routesBelow50) / s.n).toFixed(0)}%)`.padStart(18) +
      (s.p < 1e-4 ? "<1e-4" : s.p.toFixed(4)).padStart(10));
  }
}

// --- Placebo: same instrument, lines that are not cables --------------------
console.log("\n=== PLACEBO: routes displaced sideways (5 km transects) ===");
console.log("  These are not cables. Whatever they read is this instrument's");
console.log("  zero point. Compare the real result against THESE, not against 50.\n");
console.log("  " + "displacement".padEnd(14) + "metric".padEnd(9) +
  "median pctile".padStart(15) + "routes below 50".padStart(18) + "p".padStart(10));
const placebo = {};
for (const disp of [20, -20, 50, -50]) {
  placebo[disp] = run(5, disp);
  for (const m of METRICS) {
    const s = placebo[disp].summary[m];
    console.log("  " + `${disp > 0 ? "+" : ""}${disp} km`.padEnd(14) + m.padEnd(9) +
      s.medianPercentile.toFixed(2).padStart(15) +
      `${s.routesBelow50}/${s.n} (${((100 * s.routesBelow50) / s.n).toFixed(0)}%)`.padStart(18) +
      (s.p < 1e-4 ? "<1e-4" : s.p.toFixed(4)).padStart(10));
  }
}

// --- Verdict ---------------------------------------------------------------
console.log("\n=== EFFECT SIZE AGAINST THE PLACEBO BASELINE (5 km transects) ===");
console.log("  " + "metric".padEnd(9) + "real".padStart(9) + "placebo mean".padStart(15) +
  "difference".padStart(13));
const verdict = {};
for (const m of METRICS) {
  const p = [20, -20, 50, -50].map((d) => placebo[d].summary[m].medianPercentile);
  const pMean = p.reduce((a, b) => a + b, 0) / p.length;
  const rv = real[5].summary[m].medianPercentile;
  verdict[m] = { real: rv, placeboMean: pMean, difference: rv - pMean };
  console.log("  " + m.padEnd(9) + rv.toFixed(2).padStart(9) + pMean.toFixed(2).padStart(15) +
    (rv - pMean).toFixed(2).padStart(13));
}
console.log("\n  If the placebo also sits well off 50, the instrument has a bias and");
console.log("  only the DIFFERENCE column is evidence of anything.");

writeFileSync(join(__dirname, ".cache", "local-preference.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  design: "percentile rank of the cable's position within a perpendicular transect",
  nullValue: 50,
  placeboNote: "Same measurement on the same routes displaced sideways; establishes the instrument's zero point.",
  alongStepKm: ALONG_STEP_KM, transectStepKm: STEP_KM,
  unitOfAnalysis: "route (mean of its samples), to avoid inflating n on autocorrelated samples",
  routes: routes.length,
  real: Object.fromEntries(Object.entries(real).map(([k, v]) => [k, v.summary])),
  placebo: Object.fromEntries(Object.entries(placebo).map(([k, v]) => [k, v.summary])),
  verdict,
}, null, 2));
console.log("\nwrote local-preference.json");
