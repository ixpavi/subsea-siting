// Can the 1.85 km grid still SEE the effect the study is about?
//
// THE THREAT THIS ADDRESSES, and it is the one that could invalidate the whole
// long-haul extension. Moving from 460 m to 1.85 km cells is a 4x coarsening.
// The terrain signal being tested is small -- about 1.6 percentile points of
// local flatness -- and slope and roughness are exactly the quantities a block
// mean smooths away. If the coarser grid cannot resolve that preference, then a
// long-haul result reading "terrain does not predict these routes" is
// INDISTINGUISHABLE from "the grid is too blunt to tell", and the extension
// would produce a confident null that means nothing.
//
// The BSH-CONTIS anomaly already showed this failure mode in the study: the one
// national source contradicting the main finding is the one whose terrain
// relief sits below the grid's own noise floor. A coarser grid raises that
// floor for everyone.
//
// So this does not ask "is the coarse grid accurate". It asks the only question
// that matters for the experiment: RUN THE SAME MEASUREMENT AT BOTH
// RESOLUTIONS ON THE SAME ROUTES, and see whether the finding survives.
//
// FOUR CHECKS.
//
//   1. TERRAIN STATISTICS. How much slope and roughness does the coarsening
//      remove? Reported as distributions, not a single ratio, because the
//      smoothing is not uniform -- it bites hardest exactly on the rugged
//      cells that carry the signal.
//
//   2. THE PLACEBO MEASUREMENT, AT BOTH RESOLUTIONS. The study's core result:
//      real routes sit on flatter, less rugged seabed than lines displaced
//      sideways from them. Re-run at 60/deg on the same routes. If the effect
//      holds, the coarse grid is fit for the experiment. If it collapses, the
//      long-haul extension cannot be run this way and that has to be known
//      BEFORE any long-haul number is quoted, not after.
//
//   3. PRODUCT AGREEMENT. The grid mixes EMODnet with the NOAA mosaic. Where
//      both cover the same tile, how far apart are they? Two instruments
//      averaged silently into one grid is a confound; measured, it is a
//      stratification variable.
//
//   4. RESAMPLING CONSISTENCY. Tiles fetched natively at 60/deg were reduced
//      by NOAA's server; tiles downsampled here were reduced by our 4x4 block
//      mean. Where a tile exists at NOAA 240 and can also be fetched at 60,
//      the two reductions should agree. If they do not, the grid is
//      inhomogeneous in a way that tracks how each tile happened to be built.
import { readFileSync, existsSync, writeFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { BathyGrid } from "./lib/bathyGrid.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, ".cache");
const FINE = join(CACHE, "bathy-tiles");        // EMODnet, 240/deg
const NOAA240 = join(CACHE, "bathy-tiles-global");
const COARSE = join(CACHE, "bathy-tiles-lh60"); // uniform, 60/deg

const NODATA = -32768;
const corpus = JSON.parse(readFileSync(join(CACHE, "cable-corpus.json"), "utf-8"));

const fine = new BathyGrid(FINE, 240);
const coarse = new BathyGrid(COARSE, 60);

/** Matches analyse-local-preference.mjs so the two runs are comparable. */
const DISPLACEMENTS_KM = [20, -20, 50, -50];
const SAMPLE_EVERY = 8;
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

const median = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (a, p) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const fmt = (n, d = 3) => (n === null ? "n/a" : n.toFixed(d));

console.log("=".repeat(78));
console.log("LONG-HAUL GRID VALIDATION  (460 m EMODnet  vs  1.85 km composite)");
console.log("=".repeat(78));

if (!existsSync(COARSE)) {
  console.error(`\nCoarse grid not found at ${COARSE}. Run build-longhaul-grid.mjs first.`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(join(COARSE, "manifest.json"), "utf-8"));
console.log(`Coarse grid: ${manifest.tileCount.toLocaleString("en-US")} tiles, ` +
  `${manifest.approxCellMetres} m cells`);
console.log(`  by source: ${JSON.stringify(manifest.bySource)}`);

// Routes usable for a paired comparison: inside EMODnet's envelope, so BOTH
// grids can measure them. Restricted to the current study's length band so the
// comparison is against a published result rather than a new one.
const EMODNET = { minLat: 11, maxLat: 90, minLng: -70.5, maxLng: 43 };
const paired = corpus.routes.filter(
  (r) =>
    r.lengthKm >= 40 && r.lengthKm <= 500 &&
    r.coordinates.every(
      ([lng, lat]) =>
        lat >= EMODNET.minLat && lat <= EMODNET.maxLat &&
        lng >= EMODNET.minLng && lng <= EMODNET.maxLng &&
        fine.elevation(lat, lng) !== null && coarse.elevation(lat, lng) !== null
    )
);
console.log(`Routes measurable on BOTH grids (40-500 km, EMODnet envelope): ${paired.length}`);

// --- 1. What the coarsening removes -----------------------------------------
console.log("\n--- 1. TERRAIN STATISTICS AT EACH RESOLUTION -----------------------");
console.log("Sampled at real route vertices, so this describes the terrain the");
console.log("study actually measures, not the ocean at large.\n");

const fineSlope = [], coarseSlope = [], fineRough = [], coarseRough = [], depthDiff = [];
for (const r of paired) {
  for (let i = 0; i < r.coordinates.length; i += SAMPLE_EVERY) {
    const [lng, lat] = r.coordinates[i];
    const fs = fine.slope(lat, lng), cs = coarse.slope(lat, lng);
    const fr = fine.roughness(lat, lng), cr = coarse.roughness(lat, lng);
    const fd = fine.elevation(lat, lng), cd = coarse.elevation(lat, lng);
    if (fs !== null && cs !== null) { fineSlope.push(fs); coarseSlope.push(cs); }
    if (fr !== null && cr !== null) { fineRough.push(Math.abs(fr)); coarseRough.push(Math.abs(cr)); }
    if (fd !== null && cd !== null) depthDiff.push(cd - fd);
  }
}

const row = (label, f, c) =>
  console.log(
    label.padEnd(26) +
    fmt(median(f), 4).padStart(12) + fmt(median(c), 4).padStart(12) +
    (median(f) ? `${((median(c) / median(f)) * 100).toFixed(0)}%`.padStart(10) : "n/a".padStart(10))
  );

console.log("Metric".padEnd(26) + "460 m".padStart(12) + "1.85 km".padStart(12) + "retained".padStart(10));
row("median slope (m/m)", fineSlope, coarseSlope);
row("median relief (m)", fineRough, coarseRough);
console.log("");
console.log(`  p90 slope   460 m ${fmt(quantile(fineSlope, 0.9), 4)}   1.85 km ${fmt(quantile(coarseSlope, 0.9), 4)}`);
console.log(`  p90 relief  460 m ${fmt(quantile(fineRough, 1 - 0.1), 1)} m 1.85 km ${fmt(quantile(coarseRough, 0.9), 1)} m`);
console.log(`  elevation bias (coarse - fine): mean ${fmt(mean(depthDiff), 2)} m, median ${fmt(median(depthDiff), 2)} m`);
console.log(`  n samples: ${fineSlope.length.toLocaleString("en-US")}`);
console.log("");
console.log("  A retained fraction well under 100% is EXPECTED -- a block mean");
console.log("  smooths. What matters is check 2: whether the PREFERENCE survives.");

// --- 2. The placebo measurement at both resolutions -------------------------
// This is the check the extension stands or falls on.
console.log("\n--- 2. PLACEBO-DISPLACED PREFERENCE, MEASURED ON BOTH GRIDS --------");
console.log("Real route vs the same route displaced sideways. Percentile of the");
console.log("real sample within the local distribution of {real + displaced}.");
console.log("50 = no preference. Lower = the cable sits on flatter/smoother ground.\n");

/** Percentile of `value` within `pool`, as a 0-100 rank. */
function percentileOf(value, pool) {
  if (!pool.length) return null;
  let below = 0;
  for (const p of pool) if (p < value) below++;
  return (100 * below) / pool.length;
}

function measurePreference(grid) {
  const slopePct = [], roughPct = [], depthPct = [];
  for (const r of paired) {
    const c = r.coordinates;
    for (let i = 1; i < c.length - 1; i += SAMPLE_EVERY) {
      const [lng, lat] = c[i];
      const brg = bearingOf(c[i - 1][1], c[i - 1][0], c[i + 1][1], c[i + 1][0]);

      const real = {
        slope: grid.slope(lat, lng),
        rough: grid.roughness(lat, lng),
        depth: grid.depth(lat, lng),
      };
      if (real.slope === null || real.rough === null || real.depth === null) continue;

      const poolS = [], poolR = [], poolD = [];
      let ok = true;
      for (const d of DISPLACEMENTS_KM) {
        // Perpendicular to the local heading, both sides, so the control
        // shares the route's shape, length and general terrain setting.
        const [dLat, dLng] = project(lat, lng, brg + (d > 0 ? Math.PI / 2 : -Math.PI / 2), Math.abs(d));
        const s = grid.slope(dLat, dLng), rr = grid.roughness(dLat, dLng), dd = grid.depth(dLat, dLng);
        if (s === null || rr === null || dd === null) { ok = false; break; }
        poolS.push(s); poolR.push(Math.abs(rr)); poolD.push(dd);
      }
      if (!ok) continue;

      // The pool includes the real value, so a route with no preference reads
      // 50 by construction rather than by luck.
      const ps = percentileOf(real.slope, [...poolS, real.slope]);
      const pr = percentileOf(Math.abs(real.rough), [...poolR, Math.abs(real.rough)]);
      const pd = percentileOf(real.depth, [...poolD, real.depth]);
      if (ps !== null) slopePct.push(ps);
      if (pr !== null) roughPct.push(pr);
      if (pd !== null) depthPct.push(pd);
    }
  }
  return { slopePct, roughPct, depthPct };
}

console.log("  measuring at 460 m ...");
const atFine = measurePreference(fine);
console.log("  measuring at 1.85 km ...");
const atCoarse = measurePreference(coarse);

const prefRow = (label, f, c) => {
  const mf = mean(f), mc = mean(c);
  console.log(
    label.padEnd(20) +
      `${fmt(mf, 2)}`.padStart(10) + `${fmt(mf === null ? null : mf - 50, 2)}`.padStart(10) +
      `${fmt(mc, 2)}`.padStart(12) + `${fmt(mc === null ? null : mc - 50, 2)}`.padStart(10) +
      `${f.length.toLocaleString("en-US")}`.padStart(10)
  );
};
console.log("");
console.log("Metric".padEnd(20) + "460 m".padStart(10) + "vs 50".padStart(10) +
  "1.85 km".padStart(12) + "vs 50".padStart(10) + "n".padStart(10));
prefRow("slope percentile", atFine.slopePct, atCoarse.slopePct);
prefRow("relief percentile", atFine.roughPct, atCoarse.roughPct);
prefRow("depth percentile", atFine.depthPct, atCoarse.depthPct);

// NOT comparable to the study's published -1.6 percentile points. That figure
// comes from analyse-local-preference.mjs, which ranks against a bucketed
// local distribution; this ranks against a 5-value pool (the real sample plus
// four displacements), so its percentiles are coarser-grained and its
// magnitudes are on a different scale entirely. The only valid reading here is
// the INTERNAL one: the same measurement, on the same routes, at two
// resolutions. That is what the gate needs.
const retention = (f, c) => {
  const df = mean(f) - 50, dc = mean(c) - 50;
  return df === 0 ? null : (dc / df) * 100;
};
console.log("");
console.log("  Effect retained at 1.85 km, as a share of the same measurement at 460 m:");
console.log(`    slope   ${fmt(retention(atFine.slopePct, atCoarse.slopePct), 0)}%`);
console.log(`    relief  ${fmt(retention(atFine.roughPct, atCoarse.roughPct), 0)}%`);
console.log(`    depth   ${fmt(retention(atFine.depthPct, atCoarse.depthPct), 0)}%`);
console.log("");
console.log("  GATE: same sign and a substantial share retained means the coarse grid");
console.log("  can carry the experiment, with reduced sensitivity that must be stated.");
console.log("  Collapse toward 0 would make a long-haul null uninterpretable -- it could");
console.log("  not be distinguished from the grid being too blunt to see the effect.");

// --- 3. Do the two products agree where they overlap? -----------------------
console.log("\n--- 3. EMODNET vs NOAA WHERE BOTH COVER THE SAME TILE --------------");
const emodnetTiles = new Set(readdirSync(FINE).filter((f) => f.endsWith(".bin")).map((f) => f.slice(0, -4)));
const noaaTiles = existsSync(NOAA240)
  ? new Set(readdirSync(NOAA240).filter((f) => f.endsWith(".bin")).map((f) => f.slice(0, -4)))
  : new Set();
const overlap = [...emodnetTiles].filter((t) => noaaTiles.has(t));
console.log(`Tiles held in both products: ${overlap.length}`);

if (overlap.length === 0) {
  console.log("  No overlap, so the two products cannot be compared directly here.");
  console.log("  The grid is still a composite: report which routes sit on which,");
  console.log("  and treat product as a stratification variable in the results.");
} else {
  // EMODnet writes exact 0 for out-of-coverage rather than a nodata sentinel:
  // 4.85% of its cells, and 36 tiles that are 100% zero. Differencing those
  // against real NOAA bathymetry produced a mean of -1,550 m on the first run
  // of this check, which said nothing about the two products and everything
  // about a fill value. Both readings are kept below, because the naive one is
  // exactly the trap a reader would otherwise fall into.
  const naive = [], real = [];
  let zeroCells = 0;
  for (const key of overlap.slice(0, 40)) {
    const a = readFileSync(join(FINE, `${key}.bin`));
    const b = readFileSync(join(NOAA240, `${key}.bin`));
    const A = new Int16Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength));
    const B = new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    if (A.length !== B.length) continue;
    for (let i = 0; i < A.length; i += 37) {
      if (A[i] === NODATA || B[i] === NODATA) continue;
      naive.push(B[i] - A[i]);
      if (A[i] === 0) { zeroCells++; continue; }
      // Genuine comparison: both products reporting seabed at this cell.
      if (A[i] < 0 && B[i] < 0) real.push(B[i] - A[i]);
    }
  }
  const absd = real.map(Math.abs);
  console.log(`  sampled cells: ${naive.length.toLocaleString("en-US")}` +
    `  (EMODnet zero-fill: ${zeroCells.toLocaleString("en-US")}, ` +
    `${((100 * zeroCells) / Math.max(1, naive.length)).toFixed(1)}%)`);
  console.log(`  naive mean signed difference, zero-fill INCLUDED: ${fmt(mean(naive), 1)} m  <- artefact`);
  console.log("");
  console.log(`  where BOTH report seabed (n=${real.length.toLocaleString("en-US")}):`);
  console.log(`    mean signed difference (NOAA - EMODnet): ${fmt(mean(real), 2)} m`);
  console.log(`    median |difference|: ${fmt(median(absd), 2)} m, p90 ${fmt(quantile(absd, 0.9), 1)} m`);
  console.log("  A large mean signed difference here would mean the two halves of the");
  console.log("  grid sit at systematically different depths -- which a router crossing");
  console.log("  the seam would read as a slope that is not there.");
}

// --- 4. Server resampling vs our block mean ---------------------------------
console.log("\n--- 4. RESAMPLING CONSISTENCY --------------------------------------");
const provTiles = manifest.tiles ?? {};
const native60 = Object.entries(provTiles).filter(([, v]) => v === "noaa-native60").map(([k]) => k);
const downNoaa = Object.entries(provTiles).filter(([, v]) => v === "noaa-downsampled").map(([k]) => k);
console.log(`  noaa-native60 tiles (server-reduced):     ${native60.length.toLocaleString("en-US")}`);
console.log(`  noaa-downsampled tiles (our block mean):  ${downNoaa.length.toLocaleString("en-US")}`);
console.log("  These two reductions are not identical operations. validate-scaling.mjs");
console.log("  established that EMODnet's server interpolates rather than point-samples");
console.log("  (0.1% exact matches, -1.2 m global bias); the equivalent check has NOT");
console.log("  been run against NOAA's ImageServer and should be before publication.");

writeFileSync(
  join(CACHE, "longhaul-grid-validation.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      pairedRoutes: paired.length,
      terrain: {
        medianSlopeFine: median(fineSlope), medianSlopeCoarse: median(coarseSlope),
        medianReliefFine: median(fineRough), medianReliefCoarse: median(coarseRough),
        p90SlopeFine: quantile(fineSlope, 0.9), p90SlopeCoarse: quantile(coarseSlope, 0.9),
        elevationBiasMean: mean(depthDiff), samples: fineSlope.length,
      },
      preference: {
        fine: {
          slope: mean(atFine.slopePct), relief: mean(atFine.roughPct),
          depth: mean(atFine.depthPct), n: atFine.slopePct.length,
        },
        coarse: {
          slope: mean(atCoarse.slopePct), relief: mean(atCoarse.roughPct),
          depth: mean(atCoarse.depthPct), n: atCoarse.slopePct.length,
        },
      },
      productOverlapTiles: overlap.length,
    },
    null,
    2
  )
);
console.log(`\nWrote ${join(CACHE, "longhaul-grid-validation.json")}`);
