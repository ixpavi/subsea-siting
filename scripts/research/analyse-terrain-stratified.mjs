// EXPERIMENT STEP 4: does the effect behave like a real mechanism?
//
// analyse-local-preference.mjs found that cables sit on flatter, less rugged
// seabed than displaced controls -- but only by ~1.6 percentile points. An
// effect that small is worth exactly one more question before it is believed
// or dismissed: does it appear WHERE IT SHOULD?
//
// The reasoning is physical, and it makes a prediction that could fail. Over
// featureless shelf there is no meaningful choice to make: every position for
// tens of km is equally flat, so even an engineer optimising hard for terrain
// would produce a route indistinguishable from a random line, and the measured
// preference must collapse toward zero. Over rugged ground the same engineer
// has real alternatives and real reasons to prefer some, so the preference
// should be much larger.
//
// If instead the effect is uniform across terrain -- or, worse, strongest on
// flat ground where no choice exists -- then it is not seabed avoidance. It is
// some residue of the measurement, and the earlier result should be discarded
// however good its p-value looked.
//
// The placebo is stratified identically. Rugged terrain could plausibly bias
// the instrument on its own, so each stratum is judged against its own
// displaced-line baseline rather than against a single global one.
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

const HALF_KM = 5;
const STEP_KM = 0.464;
const ALONG_STEP_KM = 2;
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
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** One pass, returning PER ROUTE results plus the terrain each route crosses,
 *  so the same run can be sliced by ruggedness afterwards. */
function run(displacementKm) {
  const out = [];
  for (const r of routes) {
    const acc = { depth: [], slope: [], rough: [] };
    const context = [];
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
          [lat, lng] = project(lat, lng, displacementKm >= 0 ? perp : perp + Math.PI, Math.abs(displacementKm));
        }

        const vals = { depth: [], slope: [], rough: [] };
        let ok = true, centreIdx = -1;
        for (let x = -HALF_KM; x <= HALF_KM + 1e-9; x += STEP_KM) {
          const [tla, tln] = x === 0 ? [lat, lng]
            : project(lat, lng, x >= 0 ? perp : perp + Math.PI, Math.abs(x));
          const dep = grid.depth(tla, tln);
          const sl = grid.slope(tla, tln);
          const ro = grid.roughness(tla, tln);
          if (dep === null || sl === null || ro === null) { ok = false; break; }
          if (Math.abs(x) < STEP_KM / 2) centreIdx = vals.depth.length;
          vals.depth.push(dep); vals.slope.push(sl); vals.rough.push(ro);
        }
        if (!ok || centreIdx < 0 || vals.depth.length < 5) continue;

        // How much terrain variation the transect actually offered. A cable
        // cannot express a preference across ground that is uniformly flat,
        // so this is the "was there a choice here" measure.
        const rMin = Math.min(...vals.rough), rMax = Math.max(...vals.rough);
        context.push({ reliefSpread: rMax - rMin, medianRough: median(vals.rough) });

        for (const m of METRICS) {
          const v = vals[m][centreIdx];
          let below = 0, equal = 0;
          for (const u of vals[m]) { if (u < v) below++; else if (u === v) equal++; }
          acc[m].push((100 * (below + equal / 2)) / vals[m].length);
        }
      }
      carried = Math.max(0, carried + Math.ceil((segKm - carried) / ALONG_STEP_KM) * ALONG_STEP_KM - segKm);
    }
    if (acc.slope.length < 5) continue;
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    out.push({
      source: r.source,
      lengthKm: r.lengthKm,
      n: acc.slope.length,
      depth: mean(acc.depth), slope: mean(acc.slope), rough: mean(acc.rough),
      terrainRuggedness: median(context.map((c) => c.medianRough)),
    });
  }
  return out;
}

console.log(`Routes: ${routes.length}   transect half-width ${HALF_KM} km\n`);
console.log("Running real pass...");
const real = run(0);
console.log("Running placebo passes (+20 km, -20 km)...");
const plusP = run(20);
const minusP = run(-20);

// Placebo baseline per route, averaged over the two displacement directions.
const pIndex = new Map();
for (const arr of [plusP, minusP]) {
  for (const r of arr) {
    const k = `${r.source}|${r.lengthKm.toFixed(4)}`;
    const e = pIndex.get(k) ?? { depth: [], slope: [], rough: [] };
    for (const m of METRICS) e[m].push(r[m]);
    pIndex.set(k, e);
  }
}

// Keep only routes measurable in BOTH real and placebo, so every comparison is
// paired. An unpaired route would contribute to one side of the difference and
// not the other, which is how strata quietly acquire fake effects.
const paired = [];
for (const r of real) {
  const p = pIndex.get(`${r.source}|${r.lengthKm.toFixed(4)}`);
  if (!p || !p.slope.length) continue;
  const pm = (m) => p[m].reduce((a, b) => a + b, 0) / p[m].length;
  paired.push({
    ...r,
    dDepth: r.depth - pm("depth"),
    dSlope: r.slope - pm("slope"),
    dRough: r.rough - pm("rough"),
  });
}
console.log(`\nPaired routes (measurable real AND placebo): ${paired.length}\n`);

// --- Stratify by the ruggedness of the terrain each route crosses -----------
paired.sort((a, b) => a.terrainRuggedness - b.terrainRuggedness);
const Q = 4;
const size = Math.floor(paired.length / Q);
const strata = [];
for (let i = 0; i < Q; i++) {
  strata.push(paired.slice(i * size, i === Q - 1 ? paired.length : (i + 1) * size));
}

console.log("=== EFFECT BY TERRAIN RUGGEDNESS (placebo-corrected) ===");
console.log("  Quartiles of the local relief each route crosses. Negative = the");
console.log("  cable sits flatter/smoother than displaced lines in the same place.\n");
console.log("  " + "quartile".padEnd(10) + "relief m".padStart(16) + "routes".padStart(8) +
  "d slope".padStart(10) + "d rough".padStart(10) + "d depth".padStart(10));

const rows = [];
for (let i = 0; i < Q; i++) {
  const s = strata[i];
  const lo = s[0].terrainRuggedness, hi = s[s.length - 1].terrainRuggedness;
  const row = {
    quartile: i + 1,
    reliefFrom: lo, reliefTo: hi, routes: s.length,
    dSlope: median(s.map((r) => r.dSlope)),
    dRough: median(s.map((r) => r.dRough)),
    dDepth: median(s.map((r) => r.dDepth)),
  };
  rows.push(row);
  console.log("  " + `Q${i + 1}`.padEnd(10) +
    `${lo.toFixed(1)}-${hi.toFixed(1)}`.padStart(16) +
    String(s.length).padStart(8) +
    row.dSlope.toFixed(2).padStart(10) +
    row.dRough.toFixed(2).padStart(10) +
    row.dDepth.toFixed(2).padStart(10));
}

console.log("\n=== VERDICT ===");
const q1 = rows[0], q4 = rows[Q - 1];
console.log(`  flattest quartile  slope effect: ${q1.dSlope.toFixed(2)}`);
console.log(`  ruggedest quartile slope effect: ${q4.dSlope.toFixed(2)}`);
const ratio = q1.dSlope !== 0 ? q4.dSlope / q1.dSlope : NaN;
console.log(`  ratio: ${Number.isFinite(ratio) ? ratio.toFixed(1) + "x" : "n/a"}`);
console.log("\n  PREDICTION WAS: near zero on flat ground (no choice available),");
console.log("  clearly negative on rugged ground (real alternatives to choose from).");
console.log("  If Q1 is already strongly negative, or Q4 is not stronger than Q1,");
console.log("  the mechanism story fails and the effect is measurement residue.");

writeFileSync(join(__dirname, ".cache", "terrain-stratified.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  transectHalfWidthKm: HALF_KM,
  design: "placebo-corrected percentile effect, stratified by terrain ruggedness quartile",
  pairedRoutes: paired.length,
  strata: rows,
  perRoute: paired.map((r) => ({
    source: r.source, lengthKm: r.lengthKm, samples: r.n,
    terrainRuggedness: r.terrainRuggedness,
    dSlope: r.dSlope, dRough: r.dRough, dDepth: r.dDepth,
  })),
}, null, 2));
console.log("\nwrote terrain-stratified.json");
