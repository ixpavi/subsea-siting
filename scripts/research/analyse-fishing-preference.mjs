// Do cables sit where fishing is light -- and if so, is that a cause or a consequence?
//
// THE HYPOTHESIS. 80-86% of submarine cable faults are fishing and anchoring,
// overwhelmingly in water shallower than 200 m. The study's own conclusion is
// that bathymetry explains little about where cables go and that the real
// drivers are "landing-point constraints, existing infrastructure, fishing and
// anchoring zones, jurisdiction". Two of those are now measured. This measures
// the third.
//
// THE INSTRUMENT is the study's placebo-displaced control, unchanged: take the
// observed geometry, displace it sideways perpendicular to the local heading,
// and re-run the identical measurement. A displaced line is not a cable and
// cannot express an engineering preference, but it shares the route's shape,
// heading and general setting -- so whatever it scores is what the instrument
// reads when no preference exists. 50 means no preference; below 50 means the
// cable sits in lighter fishing than the water beside it.
//
// THE CONFOUND THAT DECIDES WHETHER ANY OF THIS MEANS ANYTHING.
//
// Cable protection zones restrict fishing NEAR CABLES. Where one exists, light
// fishing beside a cable is a CONSEQUENCE of the cable, not a reason for its
// route -- and a naive reading reports "cables avoid fishing grounds" with the
// causality exactly backwards. This is not a hypothetical: protection zones are
// the standard mitigation and the reason the effect would be there at all.
//
// THE DISPLACEMENT SWEEP IS THE DISCRIMINATOR, and it is the whole design.
// Protection zones are narrow -- typically a few hundred metres to about 2 km
// either side. Route selection operates at the scale at which a route is
// chosen, tens of kilometres. So the two explanations predict different
// SHAPES, not merely different magnitudes:
//
//   SUPPRESSION  the effect is near zero while the control is still inside the
//                zone, then rises sharply as the control crosses out of it --
//                a step at 1-3 km, flat thereafter.
//   ROUTE CHOICE the effect grows smoothly with displacement as the control
//                wanders into genuinely different water -- no step, and it
//                keeps growing past any plausible zone width.
//
// Reading a single displacement cannot tell these apart. The sweep can --
// EXCEPT AT THE LOW END, WHERE THIS SURFACE CANNOT RESOLVE THE QUESTION.
//
// The fishing grid is ~1.85 km per cell (native ~1.7 km). A control displaced
// 1 km therefore usually lands in the SAME CELL as the cable and reads exactly
// the same value, scoring 50 by construction. The measured near-zero effect at
// 1-2 km is that artefact, not evidence that a protection zone is absent -- and
// no resampling can fix it, because a typical zone is narrower than the native
// cell. The suppression hypothesis is UNTESTABLE with this instrument and is
// reported as untested rather than as rejected. The 3 km row is the first that
// resolves anything, and the sweep is only informative from there up.
//
// TEMPORAL DIRECTION, stated once and applying to every number below: the
// fishing data is an annual average for one recent year, and most corpus
// cables were laid earlier. Nothing here can establish that route planners
// avoided fishing grounds. At most it establishes that cables and fishing
// effort are spatially separated today, and the sweep says whether that
// separation is plausibly the cable's doing.
//
// PSEUDOREPLICATION. Samples within one route are heavily autocorrelated --
// adjacent vertices sit in the same fishing ground -- so significance is
// computed across ROUTES, on per-route means, never across samples. Treating
// 10,000 correlated samples as independent would manufacture significance out
// of a handful of routes.
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { BathyGrid, haversineKm } from "./lib/bathyGrid.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, ".cache");
const FISH_DIR = join(CACHE, "fishing-tiles-60");
const BATHY_DIR = join(CACHE, "bathy-tiles-lh60");
const PER_DEG = 60;

if (!existsSync(join(FISH_DIR, "manifest.json"))) {
  console.error(`No fishing surface at ${FISH_DIR}. Run build-fishing-surface.mjs first.`);
  process.exit(1);
}
const fishManifest = JSON.parse(readFileSync(join(FISH_DIR, "manifest.json"), "utf-8"));
const corpus = JSON.parse(readFileSync(join(CACHE, "cable-corpus.json"), "utf-8"));
const bathy = new BathyGrid(BATHY_DIR, PER_DEG);

/** Perpendicular offsets, both sides, in km. Deliberately dense at the low end:
 *  that is where a protection-zone step would appear. */
const DISPLACEMENTS_KM = [1, 2, 3, 5, 10, 20, 50];
/**
 * Along-route distance discarded from EACH END before measuring, in km.
 *
 * WHY THIS IS NOT OPTIONAL. A cable begins and ends at a coast, and coastal
 * water carries far more fishing effort than open sea. A perpendicular
 * displacement near landfall therefore moves the control OFFSHORE into lighter
 * traffic almost by construction -- so the real line scores heavier than its
 * controls for a reason that has nothing to do with route choice. This is the
 * same landfall confound that took the corridor effect from 68% to 29% in
 * analyse-corridor-endpoint-control.mjs, and it is measured the same way:
 * swept, so the effect can be watched decay rather than checked once.
 */
const TRIM_KM = [0, 10, 25, 50];
const SAMPLE_EVERY = 4;
const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

function project(lat, lng, bearing, d) {
  const dr = d / R;
  const la = Math.asin(Math.sin(rad(lat)) * Math.cos(dr) + Math.cos(rad(lat)) * Math.sin(dr) * Math.cos(bearing));
  const ln = rad(lng) + Math.atan2(
    Math.sin(bearing) * Math.sin(dr) * Math.cos(rad(lat)),
    Math.cos(dr) - Math.sin(rad(lat)) * Math.sin(la)
  );
  return [deg(la), deg(ln)];
}
function bearingOf(lat1, lng1, lat2, lng2) {
  const y = Math.sin(rad(lng2 - lng1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lng2 - lng1));
  return Math.atan2(y, x);
}

// --- Fishing surface access -------------------------------------------------
const fishCache = new Map();
/** @returns number (hours/km2/month), or null where the surface has no value. */
function fishing(lat, lng) {
  const key = `${Math.floor(lat)}_${Math.floor(lng)}`;
  let t = fishCache.get(key);
  if (t === undefined) {
    const p = join(FISH_DIR, `${key}.bin`);
    if (existsSync(p)) {
      const b = readFileSync(p);
      t = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    } else t = null;
    fishCache.set(key, t);
  }
  if (!t) return null;
  let row = Math.floor((Math.floor(lat) + 1 - lat) * PER_DEG);
  let col = Math.floor((lng - Math.floor(lng)) * PER_DEG);
  row = Math.max(0, Math.min(PER_DEG - 1, row));
  col = Math.max(0, Math.min(PER_DEG - 1, col));
  const v = t[row * PER_DEG + col];
  return Number.isNaN(v) ? null : v;
}

/**
 * Percentile of `value` within `pool`, using MIDRANK for ties.
 *
 * Ties are not a corner case here, they are the norm: fishing effort is
 * heavily zero-inflated, so a real sample and both its controls are often all
 * exactly zero. Counting only strictly-smaller pool members would score every
 * such triple at 0 and manufacture a large spurious preference out of empty
 * water. Midrank scores an all-tied triple at exactly 50 -- no preference,
 * which is the truth.
 */
function percentileOf(value, pool) {
  if (!pool.length) return null;
  let below = 0, equal = 0;
  for (const p of pool) {
    if (p < value) below++;
    else if (p === value) equal++;
  }
  return (100 * (below + equal / 2)) / pool.length;
}

const median = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/** Two-sided sign test across routes. */
function signTest(values, nullValue = 50) {
  const diffs = values.map((v) => v - nullValue).filter((d) => d !== 0);
  const below = diffs.filter((d) => d < 0).length;
  const n = diffs.length;
  if (n < 8) return { n, below, p: NaN };
  const z = (Math.abs(below - n / 2) - 0.5) / Math.sqrt(n / 4);
  const erf = (x) => {
    const s = x < 0 ? -1 : 1; x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  };
  return { n, below, p: 2 * (1 - 0.5 * (1 + erf(z / Math.SQRT2))) };
}

const DEPTH_BANDS = [
  { id: "shelf", label: "shelf (<200 m)", min: 0, max: 200 },
  { id: "slope", label: "slope (200-2,000 m)", min: 200, max: 2000 },
  { id: "deep", label: "deep (>2,000 m)", min: 2000, max: Infinity },
];

console.log("=".repeat(78));
console.log("DO CABLES SIT WHERE FISHING IS LIGHT?  placebo-displaced, swept");
console.log("=".repeat(78));
console.log(`Fishing surface: ${fishManifest.source.title}, ${fishManifest.source.year}, ` +
  `${fishManifest.source.units}`);
console.log(`  ${fishManifest.tilesBuilt} tiles built, ${fishManifest.tilesWithNoGranule} with no granule, ` +
  `${fishManifest.tilesOutsideEnvelope} corridor tiles outside coverage`);
console.log("");

// --- Measure -----------------------------------------------------------------
/** trim -> displacement -> per route -> mean percentile */
const perRoute = new Map(
  TRIM_KM.map((t) => [t, new Map(DISPLACEMENTS_KM.map((d) => [d, []]))])
);
/** per displacement -> per depth band -> sample percentiles */
const perDepth = new Map(
  DISPLACEMENTS_KM.map((d) => [d, new Map(DEPTH_BANDS.map((b) => [b.id, []]))])
);
const perSource = new Map();
let totalSamples = 0, usableSamples = 0, allZeroTriples = 0;
const realValues = [], controlValues = [];

for (const route of corpus.routes) {
  if (route.lengthKm < 40) continue;
  const c = route.coordinates;
  const routeAcc = new Map(
    TRIM_KM.map((t) => [t, new Map(DISPLACEMENTS_KM.map((d) => [d, []]))])
  );
  // Along-route distance, so the trim is in km rather than in vertex count:
  // vertex spacing varies by two orders of magnitude across sources, and
  // trimming a fixed number of vertices would cut 200 m from one route and
  // 200 km from another.
  const cum = new Float64Array(c.length);
  for (let k = 1; k < c.length; k++) {
    cum[k] = cum[k - 1] + haversineKm(c[k - 1][1], c[k - 1][0], c[k][1], c[k][0]);
  }
  const routeLen = cum[c.length - 1];

  for (let i = 1; i < c.length - 1; i += SAMPLE_EVERY) {
    const [lng, lat] = c[i];
    totalSamples++;
    const real = fishing(lat, lng);
    if (real === null) continue;
    const brg = bearingOf(c[i - 1][1], c[i - 1][0], c[i + 1][1], c[i + 1][0]);
    const depth = bathy.depth(lat, lng);

    let usedAny = false;
    for (const d of DISPLACEMENTS_KM) {
      const [aLat, aLng] = project(lat, lng, brg + Math.PI / 2, d);
      const [bLat, bLng] = project(lat, lng, brg - Math.PI / 2, d);
      const va = fishing(aLat, aLng);
      const vb = fishing(bLat, bLng);
      // Both controls must exist. Scoring against one side would let coastal
      // geometry -- where the seaward side has data and the landward side does
      // not -- masquerade as a preference.
      if (va === null || vb === null) continue;
      const pool = [real, va, vb];
      if (real === 0 && va === 0 && vb === 0) allZeroTriples++;
      const pct = percentileOf(real, pool);
      if (pct === null) continue;
      for (const tr of TRIM_KM) {
        if (cum[i] >= tr && routeLen - cum[i] >= tr) routeAcc.get(tr).get(d).push(pct);
      }
      usedAny = true;

      if (depth !== null) {
        const band = DEPTH_BANDS.find((b) => depth >= b.min && depth < b.max);
        if (band) perDepth.get(d).get(band.id).push(pct);
      }
      if (d === 20) { realValues.push(real); controlValues.push((va + vb) / 2); }
    }
    if (usedAny) usableSamples++;
  }

  for (const tr of TRIM_KM) for (const d of DISPLACEMENTS_KM) {
    const xs = routeAcc.get(tr).get(d);
    if (xs.length >= 5) {
      perRoute.get(tr).get(d).push(mean(xs));
      if (d === 20 && tr === 0) {
        if (!perSource.has(route.source)) perSource.set(route.source, []);
        perSource.get(route.source).push(mean(xs));
      }
    }
  }
}

console.log(`Samples on corpus routes: ${totalSamples.toLocaleString("en-US")} attempted, ` +
  `${usableSamples.toLocaleString("en-US")} with a value and at least one usable displacement`);
console.log(`All-zero triples (cable and both controls in empty water): ` +
  `${allZeroTriples.toLocaleString("en-US")} -- scored 50 by midrank, not 0`);
console.log("");

// --- 1. The sweep ------------------------------------------------------------
console.log("--- 1. EFFECT vs DISPLACEMENT -------------------------------------");
console.log("Mean percentile of the cable's own fishing effort within {cable, +d, -d}.");
console.log("50 = no preference. Below 50 = the cable sits in lighter fishing.");
console.log("Significance is across ROUTES, on per-route means.\n");
console.log("Each cell is the effect (mean percentile minus 50) with that much of");
console.log("each end discarded. A * marks p < 0.05 across routes.\n");
console.log("  " + "displacement".padEnd(14) +
  TRIM_KM.map((t) => (t === 0 ? "no trim" : `trim ${t} km`).padStart(15)).join(""));

const sweep = [];
for (const d of DISPLACEMENTS_KM) {
  const cells = [];
  for (const tr of TRIM_KM) {
    const xs = perRoute.get(tr).get(d);
    const m = mean(xs);
    const t = signTest(xs);
    sweep.push({
      displacementKm: d, trimKm: tr, routes: xs.length,
      meanPercentile: m, vs50: m === null ? null : m - 50,
      below: t.below, n: t.n, p: t.p,
    });
    const sig = !Number.isNaN(t.p) && t.p < 0.05 ? "*" : " ";
    cells.push((m === null ? "n/a" : `${(m - 50).toFixed(2)}${sig} n=${xs.length}`).padStart(15));
  }
  console.log("  " + `${d} km`.padEnd(14) + cells.join(""));
}
console.log("");
console.log("  Positive = the cable sits in HEAVIER fishing than the water beside it.");
console.log("  If the untrimmed effect is landfall geometry -- coastal water is busy,");
console.log("  and a perpendicular control near shore moves offshore into quieter");
console.log("  water -- it should shrink towards zero as the ends are removed.");

console.log("");
console.log("  RESOLUTION FLOOR: the fishing grid is ~1.85 km per cell, so a control");
console.log("  displaced 1-2 km often lands in the SAME cell as the cable and scores");
console.log("  50 by construction. Those rows measure the grid, not the sea. The");
console.log("  protection-zone hypothesis is therefore UNTESTED here, not rejected:");
console.log("  a typical zone is narrower than one native cell.");

// --- 2. Depth stratification -------------------------------------------------
console.log("\n--- 2. BY DEPTH, at each displacement ------------------------------");
console.log("Bottom-trawling and anchoring are shallow-water activities, so a real");
console.log("fishing-avoidance effect should be concentrated on the shelf.\n");
console.log("  " + "displacement".padEnd(15) + DEPTH_BANDS.map((b) => b.label.padStart(22)).join(""));
for (const d of DISPLACEMENTS_KM) {
  const cells = DEPTH_BANDS.map((b) => {
    const xs = perDepth.get(d).get(b.id);
    const m = mean(xs);
    return (m === null ? "n/a" : `${m.toFixed(1)} (n=${xs.length.toLocaleString("en-US")})`).padStart(22);
  });
  console.log("  " + `${d} km`.padEnd(15) + cells.join(""));
}

// --- 3. Raw magnitudes -------------------------------------------------------
console.log("\n--- 3. RAW FISHING EFFORT, cable vs controls at 20 km --------------");
const rz = realValues.filter((v) => v === 0).length;
const cz = controlValues.filter((v) => v === 0).length;
console.log(`  paired samples: ${realValues.length.toLocaleString("en-US")}`);
console.log(`  cable    median ${median(realValues)?.toFixed(3)}  mean ${mean(realValues)?.toFixed(3)}  zero in ${((100 * rz) / realValues.length).toFixed(1)}%`);
console.log(`  controls median ${median(controlValues)?.toFixed(3)}  mean ${mean(controlValues)?.toFixed(3)}  zero in ${((100 * cz) / controlValues.length).toFixed(1)}%`);
console.log("  Percentiles above are the primary measure; these raw values are");
console.log("  reported because a percentile shift on a heavily skewed quantity can");
console.log("  correspond to almost any absolute difference.");

// --- 4. Per source -----------------------------------------------------------
console.log("\n--- 4. BY PUBLISHING SOURCE, at 20 km ------------------------------");
console.log("The dose-response finding in this study collapsed once source was");
console.log("controlled for. Any effect here has to be checked the same way.\n");
console.log("  " + "source".padEnd(24) + "routes".padStart(8) + "mean pct".padStart(11) + "vs 50".padStart(9));
const bySource = [];
for (const [src, xs] of [...perSource.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const m = mean(xs);
  bySource.push({ source: src, routes: xs.length, meanPercentile: m });
  console.log("  " + src.padEnd(24) + String(xs.length).padStart(8) +
    (m === null ? "n/a" : m.toFixed(2)).padStart(11) +
    (m === null ? "n/a" : (m - 50).toFixed(2)).padStart(9));
}

writeFileSync(join(CACHE, "fishing-preference.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  question: "Do submarine cables sit in lighter fishing effort than displaced control lines beside them?",
  instrument: "placebo-displaced control, perpendicular to local heading, both sides, midrank percentile",
  fishingSource: fishManifest.source,
  displacementsKm: DISPLACEMENTS_KM,
  sampleEvery: SAMPLE_EVERY,
  totalSamples, usableSamples, allZeroTriples,
  significance: "sign test across routes on per-route mean percentiles; samples within a route are autocorrelated and are never treated as independent",
  confounds: fishManifest.confounds,
  sweep,
  byDepth: Object.fromEntries(DISPLACEMENTS_KM.map((d) => [d,
    Object.fromEntries(DEPTH_BANDS.map((b) => [b.id, { mean: mean(perDepth.get(d).get(b.id)), n: perDepth.get(d).get(b.id).length }]))])),
  bySource,
  raw20km: {
    n: realValues.length,
    cableMedian: median(realValues), cableMean: mean(realValues),
    controlMedian: median(controlValues), controlMean: mean(controlValues),
  },
}, null, 2));
console.log(`\nWrote ${join(CACHE, "fishing-preference.json")}`);
