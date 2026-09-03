// Does the terrain result hold for LONG-HAUL cables?
//
// WHY THIS EXISTS. evaluate-route-prediction.mjs caps routes at 500 km and sits
// inside EMODnet's envelope. Its conclusion -- terrain preference is real,
// small, and beaten by corridor following -- is therefore a statement about
// REGIONAL, mostly shelf-and-margin cable routing. The literature it argues
// with (Wang/Zukerman et al. on submarine cable path planning) is about
// trans-oceanic systems. Testing on one regime and generalising to the other is
// the single clearest objection a reviewer can raise, and it would be correct.
//
// 96 corpus routes exceed 500 km, 49 exceed 1,000 km, 11 exceed 3,000 km, with
// depth exposure from shelf to abyssal plain. This runs the identical
// experiment across four length bands on one grid, so "does the finding hold in
// deep water" becomes a measured answer rather than a limitation paragraph.
//
// WHAT IS DELIBERATELY IDENTICAL to the 500 km experiment: the methods, the
// cost surface, the corridor exclusion (different agency only), the deviation
// metric, the leave-one-source-out design, and the rule that every non-geodesic
// method uses the same A* over the same bathymetry and differs ONLY in weights.
// A difference between bands must be the sea, not the harness.
//
// WHAT NECESSARILY CHANGES, and both are threats to be reported, not hidden:
//
//   1. RESOLUTION. 60 cells/degree (~1.85 km) instead of 240 (~460 m), because
//      at 240 a 3,000 km corridor is 37 million cells against a 2 million
//      expansion cap. validate-longhaul-grid.mjs measures whether the placebo
//      preference still registers at this resolution; if it does not, a null
//      here is uninterpretable and must not be reported as a finding. The
//      40-500 km band is run here TOO, precisely so the coarse result can be
//      set beside the published 460 m one and the cost of coarsening read off
//      directly.
//
//   2. FOLD STRUCTURE. Long-haul routes come from only three national sources,
//      and FR SHOM is about three quarters of them. Leave-one-source-out is
//      thin or impossible in the upper bands. So the fixed-weight methods --
//      which need no fitting and carry the headline -- are always reported,
//      while the FITTED method is reported only for bands that genuinely
//      support a fold, and is marked unavailable elsewhere rather than being
//      quietly fitted on the routes it is tested on.
//
//   3. TWO BATHYMETRIC PRODUCTS. The grid composites EMODnet with the NOAA
//      mosaic. Results are stratified by which product a route sat on, because
//      averaging across two instruments of different accuracy would hide a
//      difference that belongs in the open.
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { BathyGrid } from "./lib/bathyGrid.mjs";
import { routeBetween, ZERO_WEIGHTS } from "./lib/corridorRouter.mjs";
import { routeDeviationKm, geodesicPath } from "./lib/routeDeviation.mjs";
import { buildCorridorIndex, corridorDistanceFor, EXCLUSION } from "./lib/corridorIndex.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, ".cache");
const GRID_DIR = join(CACHE, "bathy-tiles-lh60");
const PER_DEG = 60;

if (!existsSync(join(GRID_DIR, "manifest.json"))) {
  console.error(`No grid at ${GRID_DIR}. Run build-longhaul-grid.mjs first.`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(join(GRID_DIR, "manifest.json"), "utf-8"));
const grid = new BathyGrid(GRID_DIR, PER_DEG);
const corpus = JSON.parse(readFileSync(join(CACHE, "cable-corpus.json"), "utf-8"));

const CORRIDOR_DEG = 1.0;
/** Scaled per band: a long corridor legitimately needs more expansions, and a
 *  cap that silently truncates long routes would report them as unreachable
 *  and quietly bias the sample toward easy ones. */
const EXPANSION_BUDGET = (lengthKm) => Math.max(2_000_000, Math.ceil(lengthKm * 4_000));
const LEVELS = [0, 1];
const FIT_SAMPLE = 20;
/** A source needs at least this many routes in a band to serve as a held-out
 *  fold. Below it, a fold's median is noise. */
const MIN_FOLD = 8;

const BANDS = [
  { id: "regional", label: "40-500 km", min: 40, max: 500 },
  { id: "medium", label: "500-1,000 km", min: 500, max: 1000 },
  { id: "long", label: "1,000-2,000 km", min: 1000, max: 2000 },
  { id: "veryLong", label: "2,000+ km", min: 2000, max: Infinity },
];

const args = process.argv.slice(2);
const QUICK = args.includes("--quick");
const ONLY = (() => { const i = args.indexOf("--band"); return i >= 0 ? args[i + 1] : null; })();

const wrapLng = (lng) => (((lng + 180) % 360) + 360) % 360 - 180;
const obsOf = (r) => r.coordinates.map(([lng, lat]) => [lat, lng]);

/** Which bathymetric product this route's own vertices sit on. Corridor cells
 *  may come from either; this labels the route by where the CABLE is, which is
 *  what a stratified result needs to be about. */
const tileProv = manifest.tiles ?? {};
function productOf(route) {
  const seen = new Set();
  for (const [lng, lat] of route.coordinates) {
    const p = tileProv[`${Math.floor(lat)}_${wrapLng(Math.floor(lng))}`];
    if (p) seen.add(p.startsWith("emodnet") ? "EMODnet" : "NOAA");
  }
  if (seen.size === 0) return "unknown";
  if (seen.size === 1) return [...seen][0];
  return "mixed";
}

/** Usable = every vertex has bathymetry on THIS grid. No coverage box: the
 *  grid's own extent is the constraint, which is the point of building it. */
const usable = corpus.routes.filter(
  (r) => r.lengthKm >= 40 && r.coordinates.every(([lng, lat]) => grid.elevation(lat, lng) !== null)
);

console.log("=".repeat(78));
console.log("LONG-HAUL ROUTE PREDICTION  (uniform 1.85 km grid, all length bands)");
console.log("=".repeat(78));
console.log(`Grid: ${manifest.tileCount.toLocaleString("en-US")} tiles at ${PER_DEG}/deg ` +
  `(~${manifest.approxCellMetres} m), sources ${JSON.stringify(manifest.bySource)}`);
console.log(`Corpus routes with full coverage on this grid: ${usable.length} of ${corpus.routes.length}`);

// --- Corridor index over the whole corpus ----------------------------------
function systemKey(r) {
  const p = r.properties ?? {};
  const raw = p.name ?? p.naam ?? p.kabel_nr ?? p.omschrijvi ?? null;
  return raw ? String(raw).trim().toUpperCase() : null;
}
const corridorIndex = buildCorridorIndex(corpus.routes, corpus.routes.map(systemKey));
const indexOf = new Map(corpus.routes.map((r, i) => [r, i]));
function corridorFnFor(route) {
  const ri = indexOf.get(route);
  if (ri === undefined) return null;
  return corridorDistanceFor(corridorIndex, ri, EXCLUSION.sameAgency);
}

const W = (o) => ({ depth: 0, slope: 0, rough: 0, corridor: 0, ...o });
const METHODS = [
  { id: "geodesic", label: "Great circle (no bathymetry at all)", kind: "geodesic" },
  { id: "seapath", label: "Shortest sea path (terrain ignored)", kind: "weights", weights: ZERO_WEIGHTS },
  { id: "slope", label: "Terrain only (slope-avoiding)", kind: "weights", weights: W({ slope: 1.5 }) },
  { id: "handset", label: "Terrain, all terms hand-set", kind: "weights", weights: W({ depth: 0.5, slope: 1.5, rough: 0.5 }) },
  { id: "corridor", label: "Corridor only (other operators' cables)", kind: "weights", weights: W({ corridor: 1.5 }) },
  { id: "both", label: "Corridor + terrain", kind: "weights", weights: W({ slope: 1.5, corridor: 1.5 }) },
  { id: "fitted", label: "Terrain, weights FITTED on other sources", kind: "fitted" },
];

function predictAndScore(route, weights) {
  const obs = obsOf(route);
  const a = obs[0], b = obs[obs.length - 1];
  const corridorFn = weights.corridor ? corridorFnFor(route) : null;
  const res = routeBetween(grid, a, b, weights, CORRIDOR_DEG, EXPANSION_BUDGET(route.lengthKm), corridorFn);
  if (!res.reachable) return null;
  const dev = routeDeviationKm(obs, res.path);
  return dev ? dev.meanKm : null;
}

/** Progress is written only to a terminal. Piped to a file, the CR-based
 *  counters produce one enormous unreadable line per fold. */
const TTY = process.stdout.isTTY;
const progress = (msg) => { if (TTY) process.stdout.write("\r" + msg + "   "); };
const clearProgress = () => { if (TTY) process.stdout.write("\r" + " ".repeat(70) + "\r"); };

const medianOf = (xs) => {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function fitWeights(trainRoutes, label) {
  const sorted = trainRoutes.slice().sort((a, b) => a.lengthKm - b.lengthKm);
  const step = Math.max(1, Math.floor(sorted.length / FIT_SAMPLE));
  const fitSet = sorted.filter((_, i) => i % step === 0).slice(0, FIT_SAMPLE);
  let best = null, evaluated = 0;
  const total = LEVELS.length ** 3;
  for (const depth of LEVELS) for (const slope of LEVELS) for (const rough of LEVELS) {
    const w = { depth, slope, rough, corridor: 0 };
    const devs = [];
    for (const r of fitSet) {
      const d = predictAndScore(r, w);
      if (d !== null) devs.push(d);
    }
    const score = medianOf(devs);
    evaluated++;
    progress(`    fitting ${label}: ${evaluated}/${total}`);
    if (Number.isFinite(score) && (!best || score < best.score)) best = { weights: w, score, n: devs.length };
  }
  clearProgress();
  return best ? { ...best, fitSetSize: fitSet.length } : null;
}

/** Sign test on paired per-route deviations. Non-parametric deliberately:
 *  these deviations are heavily skewed and a t-test would assume away the
 *  shape of the distribution being measured. */
function signTest(rows, better, worse) {
  const diffs = rows.map((r) => r.dev[better] - r.dev[worse]).filter((d) => d !== 0);
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

const bandResults = [];

for (const band of BANDS) {
  if (ONLY && band.id !== ONLY) continue;
  const inBand = usable.filter((r) => r.lengthKm >= band.min && r.lengthKm < band.max);
  console.log("\n" + "-".repeat(78));
  console.log(`BAND ${band.label}  --  ${inBand.length} routes with full grid coverage`);
  console.log("-".repeat(78));
  if (inBand.length < MIN_FOLD) {
    console.log(`  Too few routes (<${MIN_FOLD}) to report anything honestly. Skipped.`);
    bandResults.push({ ...band, n: inBand.length, skipped: "too few routes" });
    continue;
  }

  const bySource = new Map();
  for (const r of inBand) {
    if (!bySource.has(r.source)) bySource.set(r.source, []);
    bySource.get(r.source).push(r);
  }
  for (const [s, rs] of [...bySource.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${s.padEnd(22)} ${String(rs.length).padStart(4)}${rs.length >= MIN_FOLD ? "  (fold)" : ""}`);
  }
  const foldSources = [...bySource.entries()].filter(([, v]) => v.length >= MIN_FOLD).map(([k]) => k);
  const canFit = foldSources.length >= 2;
  if (!canFit) {
    console.log(`  NOTE: fewer than 2 sources reach ${MIN_FOLD} routes, so leave-one-source-out`);
    console.log(`  cannot be run. Fixed-weight methods are still reported; FITTED is not.`);
  }

  const perRoute = [];
  const foldInfo = [];
  const testSources = canFit ? foldSources : [...bySource.keys()];

  for (const heldOut of testSources) {
    let test = bySource.get(heldOut);
    if (QUICK) test = test.slice(0, 6);
    let fit = null;
    if (canFit && foldSources.includes(heldOut)) {
      const train = inBand.filter((r) => r.source !== heldOut);
      fit = fitWeights(train, `${band.id}/${heldOut}`);
      if (fit) {
        console.log(`  fold ${heldOut}: fitted depth=${fit.weights.depth} slope=${fit.weights.slope} ` +
          `rough=${fit.weights.rough} (train median ${fit.score.toFixed(1)} km, n=${fit.n}/${fit.fitSetSize})`);
        foldInfo.push({ heldOut, fitted: fit.weights, trainMedianDevKm: fit.score, testCount: test.length });
      }
    }

    let done = 0;
    for (const r of test) {
      const obs = obsOf(r);
      const a = obs[0], b = obs[obs.length - 1];
      const row = { source: heldOut, lengthKm: r.lengthKm, product: productOf(r), dev: {} };
      for (const m of METHODS) {
        if (m.kind === "geodesic") {
          const d = routeDeviationKm(obs, geodesicPath(a, b));
          row.dev[m.id] = d ? d.meanKm : null;
        } else if (m.kind === "fitted") {
          row.dev[m.id] = fit ? predictAndScore(r, fit.weights) : null;
        } else {
          row.dev[m.id] = predictAndScore(r, m.weights);
        }
      }
      perRoute.push(row);
      done++;
      progress(`    scoring ${heldOut} ${done}/${test.length}`);
    }
    clearProgress();
  }

  // Methods every route could be scored on. `fitted` is dropped from the
  // completeness requirement where folds were impossible, rather than
  // discarding every route in the band.
  const reported = METHODS.filter((m) => m.kind !== "fitted" || canFit);
  const complete = perRoute.filter((r) => reported.every((m) => Number.isFinite(r.dev[m.id])));
  const unreachable = perRoute.length - complete.length;

  console.log(`\n  scored ${perRoute.length}, complete on all reported methods ${complete.length}` +
    (unreachable ? `  (${unreachable} dropped: no path within corridor)` : ""));
  if (complete.length < MIN_FOLD) {
    console.log("  Too few complete routes to report. Skipped.");
    bandResults.push({ ...band, n: inBand.length, skipped: "too few complete routes", unreachable });
    continue;
  }

  const geoMed = medianOf(complete.map((r) => r.dev.geodesic));
  console.log("");
  console.log("  " + "method".padEnd(40) + "median".padStart(9) + "mean".padStart(9) +
    "p90".padStart(9) + "vs geodesic".padStart(13));
  const summary = [];
  for (const m of reported) {
    const xs = complete.map((r) => r.dev[m.id]);
    const med = medianOf(xs);
    const mn = xs.reduce((a, b) => a + b, 0) / xs.length;
    const p90 = xs.slice().sort((a, b) => a - b)[Math.floor(xs.length * 0.9)];
    const rel = ((med - geoMed) / geoMed) * 100;
    summary.push({ id: m.id, label: m.label, medianKm: med, meanKm: mn, p90Km: p90, vsGeodesicPct: rel });
    console.log("  " + m.label.padEnd(40) + med.toFixed(1).padStart(9) + mn.toFixed(1).padStart(9) +
      p90.toFixed(1).padStart(9) +
      (m.id === "geodesic" ? "—" : `${rel > 0 ? "+" : ""}${rel.toFixed(1)}%`).padStart(13));
  }

  const pairs = [
    ["corridor", "seapath", "corridor over shortest sea path"],
    ["corridor", "handset", "corridor over hand-set terrain"],
    ["handset", "seapath", "hand-set terrain over shortest sea path"],
    ["both", "corridor", "adding terrain on top of corridor"],
    ...(canFit ? [["corridor", "fitted", "corridor over fitted terrain"],
                  ["fitted", "seapath", "fitted terrain over shortest sea path"]] : []),
  ];
  console.log("\n  paired, per route:");
  const paired = [];
  for (const [a, b, what] of pairs) {
    const t = signTest(complete, a, b);
    const pct = t.n ? ((100 * t.wins) / t.n).toFixed(0) : "—";
    paired.push({ a, b, what, winPct: +pct, n: t.n, p: t.p });
    console.log(`    ${what.padEnd(42)} ${String(t.wins).padStart(4)}/${String(t.n).padEnd(4)} (${pct}%)  ` +
      `p ${Number.isNaN(t.p) ? "n/a" : t.p < 1e-4 ? "<1e-4" : t.p.toFixed(4)}`);
  }

  // Stratify by bathymetric product: a difference here is a difference between
  // instruments, and must not be read as a difference between seas.
  const byProduct = {};
  for (const r of complete) {
    (byProduct[r.product] ??= []).push(r);
  }
  if (Object.keys(byProduct).length > 1) {
    console.log("\n  by bathymetric product (corridor vs geodesic median):");
    for (const [p, rs] of Object.entries(byProduct)) {
      console.log(`    ${p.padEnd(10)} n=${String(rs.length).padStart(4)}  ` +
        `geodesic ${medianOf(rs.map((r) => r.dev.geodesic)).toFixed(1)} km  ` +
        `corridor ${medianOf(rs.map((r) => r.dev.corridor)).toFixed(1)} km`);
    }
  }

  bandResults.push({
    ...band, n: inBand.length, scored: perRoute.length, complete: complete.length,
    unreachable, canFit, foldSources, summary, paired, folds: foldInfo,
    byProduct: Object.fromEntries(Object.entries(byProduct).map(([p, rs]) => [p, rs.length])),
    perRoute,
  });
}

writeFileSync(join(CACHE, "longhaul-prediction.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  design:
    "Leave-one-source-out within each length band. Every non-geodesic method uses the same A* over the " +
    "same 60/deg composite grid, differing only in cost weights. Corridor term excludes all routes from " +
    "the subject's own agency.",
  gridCellsPerDegree: PER_DEG,
  gridApproxCellMetres: manifest.approxCellMetres,
  gridSources: manifest.bySource,
  corridorDeg: CORRIDOR_DEG,
  minFoldRoutes: MIN_FOLD,
  weightLevels: LEVELS,
  caveat:
    "Run at 1.85 km, not the 460 m of the published 40-500 km experiment. The regional band is included " +
    "here so the two resolutions can be compared directly; see validate-longhaul-grid.mjs for whether the " +
    "placebo preference survives coarsening at all.",
  bands: bandResults,
}, null, 2));
console.log(`\nWrote ${join(CACHE, "longhaul-prediction.json")}`);
