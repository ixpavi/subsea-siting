// Why does one national source contradict the main finding?
//
// The placebo study found cables sit on flatter seabed than displaced
// controls, consistently across five of six sources. DE BSH-CONTIS is the
// exception: it shows +1.57 on slope, meaning its cables sit on STEEPER ground
// than controls. A single contradicting source is exactly what a reviewer will
// pick out, and "we report it honestly" is not an explanation.
//
// THE HYPOTHESIS, stated before testing it. BSH surveys the German Bight -- the
// flattest water in the corpus. The reduction of EMODnet's 115 m source to the
// 460 m grid used here was measured at 0.46-1.28 m RMS on shelf tiles. If the
// terrain BSH crosses varies by about that much, then its "slope" values are
// not terrain at all, they are the interpolation residual, and the sign of the
// effect there is noise. That is a claim with a number attached, and it can be
// wrong: if BSH routes cross relief far above the noise floor, the hypothesis
// fails and the contradiction is real and unexplained.
//
// The distinction matters for the paper. An anomaly explained by a measurement
// limit is a scope condition -- the method needs terrain above its noise floor.
// An unexplained one undermines the main result.
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { BathyGrid } from "./lib/bathyGrid.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const grid = new BathyGrid(join(__dirname, ".cache", "bathy-tiles"), 240);
const corpus = JSON.parse(readFileSync(join(__dirname, ".cache", "cable-corpus.json"), "utf-8"));
const COVERAGE = { minLat: 11, maxLat: 90, minLng: -70.5, maxLng: 43 };

/** Downsampling RMS measured on shelf tiles in validate-scaling.mjs: 0.46 m
 *  (Celtic shelf) to 1.28 m (southern North Sea, which is BSH's own water). */
const SHELF_NOISE_FLOOR_M = 1.28;

const routes = corpus.routes.filter((r) =>
  r.coordinates.every(
    ([lng, lat]) =>
      lat >= COVERAGE.minLat && lat <= COVERAGE.maxLat &&
      lng >= COVERAGE.minLng && lng <= COVERAGE.maxLng &&
      grid.elevation(lat, lng) !== null
  )
);

const bySource = new Map();
for (const r of routes) {
  if (!bySource.has(r.source)) bySource.set(r.source, []);
  bySource.get(r.source).push(r);
}

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

// --- Terrain each source actually crosses ----------------------------------
// Sampled every 2 km, matching the transect analysis, so these numbers describe
// the same measurement the anomaly came from.
console.log("=== TERRAIN CROSSED, BY SOURCE ===");
console.log("  Local relief is the 3x3 neighbourhood range -- the variation the");
console.log("  slope measurement has to resolve. Depth is context.\n");
console.log(
  "  " + "source".padEnd(22) + "routes".padStart(7) + "median relief m".padStart(17) +
  "p90 relief m".padStart(14) + "median depth m".padStart(16)
);

const perSource = [];
for (const [src, rs] of [...bySource.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const relief = [];
  const depths = [];
  for (const r of rs) {
    for (let i = 0; i < r.coordinates.length; i += 1) {
      const [lng, lat] = r.coordinates[i];
      const ro = grid.roughness(lat, lng);
      const d = grid.depth(lat, lng);
      if (ro !== null) relief.push(Math.abs(ro));
      if (d !== null) depths.push(d);
      if (relief.length > 20000) break;
    }
  }
  const row = {
    source: src,
    routes: rs.length,
    medianReliefM: median(relief),
    p90ReliefM: quantile(relief, 0.9),
    medianDepthM: median(depths),
    samples: relief.length,
  };
  perSource.push(row);
  console.log(
    "  " + src.padEnd(22) + String(rs.length).padStart(7) +
    row.medianReliefM.toFixed(2).padStart(17) +
    row.p90ReliefM.toFixed(2).padStart(14) +
    row.medianDepthM.toFixed(0).padStart(16)
  );
}

// --- Signal-to-noise -------------------------------------------------------
console.log(`\n=== SIGNAL AGAINST THE MEASUREMENT FLOOR (${SHELF_NOISE_FLOOR_M} m RMS on shelf) ===`);
console.log("  A ratio near or below 1 means the slope differences that the");
console.log("  placebo test compared are the same size as the grid's own error.\n");
console.log("  " + "source".padEnd(22) + "median relief / noise".padStart(23) + "  verdict");

const verdicts = [];
for (const row of perSource) {
  const snr = row.medianReliefM / SHELF_NOISE_FLOOR_M;
  const verdict =
    snr < 1.5 ? "AT the measurement floor" : snr < 4 ? "marginal" : "well above the floor";
  verdicts.push({ source: row.source, snr, verdict });
  console.log("  " + row.source.padEnd(22) + snr.toFixed(2).padStart(23) + "  " + verdict);
}

// --- Does the anomaly track terrain, or the agency? ------------------------
// The decisive framing. If sources at the measurement floor behave erratically
// regardless of who they are, the explanation is terrain. If BSH is alone in
// misbehaving while other flat-water sources behave, it is something about BSH.
const stratified = JSON.parse(
  readFileSync(join(__dirname, ".cache", "terrain-stratified.json"), "utf-8")
);

console.log("\n=== EFFECT vs TERRAIN FLOOR, PER SOURCE ===");
console.log("  dSlope is the placebo-corrected effect: negative means cables sit");
console.log("  flatter than displaced controls, which is the main finding.\n");
console.log("  " + "source".padEnd(22) + "relief/noise".padStart(13) + "median dSlope".padStart(15) + "  agrees?");

const joined = [];
for (const row of perSource) {
  const rs = stratified.perRoute.filter((p) => p.source === row.source);
  if (rs.length < 3) continue;
  const dS = median(rs.map((p) => p.dSlope));
  const snr = row.medianReliefM / SHELF_NOISE_FLOOR_M;
  joined.push({ source: row.source, snr, medianDSlope: dS, n: rs.length });
  console.log(
    "  " + row.source.padEnd(22) + snr.toFixed(2).padStart(13) + dS.toFixed(2).padStart(15) +
    "  " + (dS < 0 ? "yes" : "NO -- contradicts")
  );
}

// --- Verdict ---------------------------------------------------------------
const contradicting = joined.filter((j) => j.medianDSlope >= 0);
const atFloor = joined.filter((j) => j.snr < 1.5);
console.log("\n=== VERDICT ===");
if (contradicting.length === 0) {
  console.log("  No source contradicts on this subset.");
} else {
  const allAtFloor = contradicting.every((c) => c.snr < 1.5);
  const cleanSources = joined.filter((j) => j.snr >= 1.5);
  const cleanAgree = cleanSources.filter((j) => j.medianDSlope < 0).length;
  console.log(`  contradicting sources : ${contradicting.map((c) => c.source).join(", ")}`);
  console.log(`  all of them at the measurement floor? ${allAtFloor ? "YES" : "NO"}`);
  console.log(`  sources above the floor that agree with the main finding: ${cleanAgree}/${cleanSources.length}`);
  console.log("");
  if (allAtFloor && cleanAgree === cleanSources.length) {
    console.log("  HYPOTHESIS SUPPORTED. Every contradicting source sits at the grid's");
    console.log("  own error floor, and every source with terrain above that floor agrees");
    console.log("  with the main finding. This is a scope condition -- the method needs");
    console.log("  relief above the bathymetry's noise -- not a contradiction of it.");
  } else {
    console.log("  HYPOTHESIS NOT SUPPORTED. The contradiction does not track the");
    console.log("  measurement floor, so it needs a different explanation and must be");
    console.log("  reported as unresolved.");
  }
}

console.log(`\n  (sources at the measurement floor: ${atFloor.map((a) => a.source).join(", ") || "none"})`);

writeFileSync(join(__dirname, ".cache", "bsh-anomaly.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  shelfNoiseFloorM: SHELF_NOISE_FLOOR_M,
  noiseFloorSource: "validate-scaling.mjs, shelf tiles: 0.46 m Celtic, 1.28 m southern North Sea",
  perSource,
  signalToNoise: verdicts,
  effectVsFloor: joined,
}, null, 2));
console.log("\nwrote bsh-anomaly.json");
