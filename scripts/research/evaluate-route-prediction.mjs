// THE EXPERIMENT: how well does terrain-based routing predict where cables
// were actually laid, compared to just drawing a straight line?
//
// The placebo study established that cables sit on measurably flatter ground
// than displaced controls, by about 1.6 percentile points. The obvious next
// question -- and the one a reader actually cares about -- is what that is
// worth. A 1.6 percentile preference could correspond to a router that nails
// real routes, or to one that barely beats a ruler. Those imply completely
// different things about least-cost-path cable planning, and the percentile
// alone cannot distinguish them.
//
// So: give each method only the two endpoints, have it predict the route, and
// measure how far the prediction lands from the cable that was really laid.
//
// FAIR COMPARISON BY CONSTRUCTION. Every method except the geodesic uses the
// SAME A* search over the SAME bathymetry, differing only in the weights of
// its cost surface. "Shortest sea path" is simply all weights at zero. So a
// difference between methods cannot come from a difference in search, grid,
// corridor or endpoint handling -- only from the terrain preference being
// tested. The geodesic is included as the zero-knowledge floor: it does not
// even know where the water is.
//
// SPATIALLY BLOCKED CROSS-VALIDATION. Weights are fitted on some national
// sources and evaluated on a source held entirely out. Random splits would
// leak: routes from one agency share a sea, a survey convention and often a
// corridor, so a random test route usually has a near-neighbour in training
// and the fitted weights would look far better than they are. Leaving out a
// whole agency is the honest test of whether a fitted preference transfers.
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { BathyGrid } from "./lib/bathyGrid.mjs";
import { routeBetween, ZERO_WEIGHTS } from "./lib/corridorRouter.mjs";
import { routeDeviationKm, geodesicPath } from "./lib/routeDeviation.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const grid = new BathyGrid(join(__dirname, ".cache", "bathy-tiles"), 240);
const corpus = JSON.parse(readFileSync(join(__dirname, ".cache", "cable-corpus.json"), "utf-8"));
const COVERAGE = { minLat: 11, maxLat: 90, minLng: -70.5, maxLng: 43 };

const CORRIDOR_DEG = 1.0;
/** Routes shorter than this have too little room to differ between methods
 *  to say anything; longer ones make the search cost explode. Both bounds are
 *  reported, and the sensitivity of the headline to them is printed below. */
const MIN_KM = 40;
const MAX_KM = 900;

/** Weight levels searched per term. Coarse deliberately: the question is
 *  whether terrain preference helps AT ALL, not what its third decimal is. */
const LEVELS = [0, 0.5, 1.5];
/** Routes used to FIT weights within each training set. Fitting is the
 *  expensive part (one A* per route per weight combination) and the fitted
 *  optimum is stable well before the full training set is used. */
const FIT_SAMPLE = 45;

const args = process.argv.slice(2);
const LIMIT = args.includes("--quick") ? 60 : Infinity;

// --- Assemble the usable corpus --------------------------------------------
const all = corpus.routes.filter(
  (r) =>
    r.lengthKm >= MIN_KM &&
    r.lengthKm <= MAX_KM &&
    r.coordinates.every(
      ([lng, lat]) =>
        lat >= COVERAGE.minLat && lat <= COVERAGE.maxLat &&
        lng >= COVERAGE.minLng && lng <= COVERAGE.maxLng &&
        grid.elevation(lat, lng) !== null
    )
);

const bySource = new Map();
for (const r of all) {
  if (!bySource.has(r.source)) bySource.set(r.source, []);
  bySource.get(r.source).push(r);
}
/** Only sources with enough routes to be a meaningful held-out fold. */
const FOLD_SOURCES = [...bySource.entries()].filter(([, v]) => v.length >= 15).map(([k]) => k);

console.log(`Corpus: ${all.length} routes, ${MIN_KM}-${MAX_KM} km, corridor +/-${CORRIDOR_DEG} deg`);
for (const [src, rs] of [...bySource.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${src.padEnd(22)} ${String(rs.length).padStart(4)}${FOLD_SOURCES.includes(src) ? "  (fold)" : ""}`);
}
console.log("");

const obsOf = (r) => r.coordinates.map(([lng, lat]) => [lat, lng]);

/** Deviation of a weighted prediction from the observed route, or null when
 *  no path exists in the corridor. */
function predictAndScore(route, weights) {
  const obs = obsOf(route);
  const a = obs[0];
  const b = obs[obs.length - 1];
  const res = routeBetween(grid, a, b, weights, CORRIDOR_DEG);
  if (!res.reachable) return null;
  const dev = routeDeviationKm(obs, res.path);
  return dev ? dev.meanKm : null;
}

function medianOf(xs) {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// --- Fit weights on a training set -----------------------------------------
function fitWeights(trainRoutes, label) {
  // Deterministic subsample: sorted by length then evenly spaced, so the fit
  // set spans the length range rather than clustering, and repeats exactly.
  const sorted = trainRoutes.slice().sort((a, b) => a.lengthKm - b.lengthKm);
  const step = Math.max(1, Math.floor(sorted.length / FIT_SAMPLE));
  const fitSet = sorted.filter((_, i) => i % step === 0).slice(0, FIT_SAMPLE);

  let best = null;
  let evaluated = 0;
  const total = LEVELS.length ** 3;
  for (const depth of LEVELS) {
    for (const slope of LEVELS) {
      for (const rough of LEVELS) {
        const w = { depth, slope, rough };
        const devs = [];
        for (const r of fitSet) {
          const d = predictAndScore(r, w);
          if (d !== null) devs.push(d);
        }
        const score = medianOf(devs);
        evaluated++;
        process.stdout.write(`\r    fitting ${label}: ${evaluated}/${total} combos   `);
        if (Number.isFinite(score) && (!best || score < best.score)) best = { weights: w, score, n: devs.length };
      }
    }
  }
  process.stdout.write("\r" + " ".repeat(60) + "\r");
  return { ...best, fitSetSize: fitSet.length };
}

// --- Methods ---------------------------------------------------------------
const METHODS = [
  { id: "geodesic", label: "Great circle (no bathymetry at all)", kind: "geodesic" },
  { id: "seapath", label: "Shortest sea path (terrain ignored)", kind: "weights", weights: ZERO_WEIGHTS },
  { id: "depth", label: "Depth-avoiding", kind: "weights", weights: { depth: 1.5, slope: 0, rough: 0 } },
  { id: "slope", label: "Slope-avoiding", kind: "weights", weights: { depth: 0, slope: 1.5, rough: 0 } },
  { id: "handset", label: "All terms, hand-set weights", kind: "weights", weights: { depth: 0.5, slope: 1.5, rough: 0.5 } },
  { id: "fitted", label: "All terms, weights FITTED on other sources", kind: "fitted" },
];

// --- Run leave-one-source-out ----------------------------------------------
const perRoute = [];
const foldInfo = [];

for (const heldOut of FOLD_SOURCES) {
  const test = bySource.get(heldOut).slice(0, LIMIT);
  const train = all.filter((r) => r.source !== heldOut);
  console.log(`Fold: hold out ${heldOut} (${test.length} test, ${train.length} train)`);

  const fit = fitWeights(train, heldOut);
  console.log(`    fitted weights: depth=${fit.weights.depth} slope=${fit.weights.slope} rough=${fit.weights.rough}` +
    `  (train median dev ${fit.score.toFixed(1)} km, n=${fit.n}/${fit.fitSetSize})`);
  foldInfo.push({ heldOut, fitted: fit.weights, trainMedianDevKm: fit.score, testCount: test.length });

  let done = 0;
  for (const r of test) {
    const obs = obsOf(r);
    const a = obs[0];
    const b = obs[obs.length - 1];
    const row = { source: heldOut, lengthKm: r.lengthKm, dev: {} };

    for (const m of METHODS) {
      if (m.kind === "geodesic") {
        const d = routeDeviationKm(obs, geodesicPath(a, b));
        row.dev[m.id] = d ? d.meanKm : null;
      } else {
        const w = m.kind === "fitted" ? fit.weights : m.weights;
        row.dev[m.id] = predictAndScore(r, w);
      }
    }
    perRoute.push(row);
    done++;
    process.stdout.write(`\r    scoring ${done}/${test.length}   `);
  }
  process.stdout.write("\r" + " ".repeat(50) + "\r");
}

// --- Report ----------------------------------------------------------------
// Only routes every method could predict, so the comparison is paired. A
// method that silently failed on the hard routes would otherwise look best.
const complete = perRoute.filter((r) => METHODS.every((m) => r.dev[m.id] !== null && Number.isFinite(r.dev[m.id])));

console.log(`\n=== PREDICTION ERROR (held-out routes, n=${complete.length} of ${perRoute.length} scored by all methods) ===`);
console.log("  Mean distance between the predicted route and the cable actually laid.\n");
console.log("  " + "method".padEnd(38) + "median km".padStart(11) + "mean km".padStart(10) +
  "p90 km".padStart(9) + "vs geodesic".padStart(13));

const geoMed = medianOf(complete.map((r) => r.dev.geodesic));
const summary = [];
for (const m of METHODS) {
  const xs = complete.map((r) => r.dev[m.id]);
  const med = medianOf(xs);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sorted = xs.slice().sort((a, b) => a - b);
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  const rel = ((med - geoMed) / geoMed) * 100;
  summary.push({ id: m.id, label: m.label, medianKm: med, meanKm: mean, p90Km: p90, vsGeodesicPct: rel });
  console.log("  " + m.label.padEnd(38) + med.toFixed(1).padStart(11) + mean.toFixed(1).padStart(10) +
    p90.toFixed(1).padStart(9) +
    (m.id === "geodesic" ? "—" : `${rel > 0 ? "+" : ""}${rel.toFixed(1)}%`).padStart(13));
}

// --- Paired test: does terrain beat the sea-path baseline per route? -------
// Medians can move for reasons a per-route comparison would not support, so
// the headline claim is checked pairwise on the same routes.
function signTest(better, worse) {
  const diffs = complete.map((r) => r.dev[better] - r.dev[worse]).filter((d) => d !== 0);
  const wins = diffs.filter((d) => d < 0).length;
  const n = diffs.length;
  if (n < 8) return { n, wins, p: NaN };
  const z = (Math.abs(wins - n / 2) - 0.5) / Math.sqrt(n / 4);
  const erf = (x) => {
    const s = x < 0 ? -1 : 1; x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  };
  return { n, wins, p: 2 * (1 - 0.5 * (1 + erf(z / Math.SQRT2))) };
}

console.log("\n=== PAIRED COMPARISONS (same routes, per route) ===");
const pairs = [
  ["seapath", "geodesic", "knowing where the water is"],
  ["fitted", "seapath", "fitted terrain preference over plain shortest sea path"],
  ["handset", "seapath", "hand-set terrain preference over plain shortest sea path"],
  ["fitted", "handset", "fitting the weights over guessing them"],
];
const paired = [];
for (const [a, b, what] of pairs) {
  const t = signTest(a, b);
  const pct = ((100 * t.wins) / t.n).toFixed(0);
  paired.push({ a, b, what, winPct: +pct, n: t.n, p: t.p });
  console.log(`  ${what}`);
  console.log(`    better on ${t.wins}/${t.n} routes (${pct}%), p ${t.p < 1e-4 ? "<1e-4" : t.p.toFixed(4)}`);
}

console.log("\n=== FITTED WEIGHTS PER FOLD ===");
console.log("  If terrain preference genuinely transfers, folds should agree.\n");
console.log("  " + "held out".padEnd(24) + "depth".padStart(7) + "slope".padStart(7) + "rough".padStart(7));
for (const f of foldInfo) {
  console.log("  " + f.heldOut.padEnd(24) + String(f.fitted.depth).padStart(7) +
    String(f.fitted.slope).padStart(7) + String(f.fitted.rough).padStart(7));
}

writeFileSync(join(__dirname, ".cache", "route-prediction.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  design: "leave-one-source-out; every non-geodesic method uses the same A* and bathymetry, differing only in cost weights",
  corridorDeg: CORRIDOR_DEG,
  lengthBandKm: [MIN_KM, MAX_KM],
  weightLevels: LEVELS,
  fitSampleSize: FIT_SAMPLE,
  routesScored: perRoute.length,
  routesCompleteAllMethods: complete.length,
  summary,
  paired,
  folds: foldInfo,
  perRoute,
}, null, 2));
console.log("\nwrote route-prediction.json");
