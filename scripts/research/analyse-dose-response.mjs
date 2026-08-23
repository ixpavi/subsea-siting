// EXPERIMENT STEP 5: is the dose-response real, and is it terrain at all?
//
// analyse-terrain-stratified.mjs put the placebo-corrected slope effect at
// -0.69 on the flattest quartile of routes and -2.39 on the ruggedest -- the
// predicted direction, 3.5x. But the four bins were not monotonic (Q2 -2.04
// against Q3 -1.49), and "3.5x" quoted from the two extreme bins of a noisy
// series is a number chosen after seeing it. Two checks are needed before that
// gradient means anything.
//
//   1. TREND ON ALL THE DATA. Quartiles throw away most of the information and
//      let bin edges pick the answer. Spearman across all 343 routes uses every
//      one and cannot be tuned. Significance comes from a permutation test
//      rather than a table, because these distributions are not normal.
//
//   2. THE SOURCE CONFOUND. This is the serious one. The corpus is seven
//      national hydrographic offices whose survey fidelity differs by a factor
//      of thirty -- BSH at 3,369 vertices per 1,000 km, CICA at 89. They also
//      survey different seas: BSH the flat southern North Sea, SHOM the steep
//      Mediterranean and island margins. So "ruggedness" is partly a proxy for
//      "which agency drew this line", and a densely-surveyed route can hug real
//      terrain that a sparsely-surveyed one has smoothed into a straight line.
//      That alone could manufacture the entire gradient with no engineering
//      preference anywhere in it.
//
// If the trend survives within a single source, it is terrain. If it only
// exists across sources, it is cartography.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(__dirname, ".cache", "terrain-stratified.json"), "utf-8"));
const rows = data.perRoute;

const median = (a) => {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Fractional ranks, ties averaged. */
function ranks(v) {
  const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(v.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}
function spearman(a, b) {
  const ra = ranks(a), rb = ranks(b);
  const n = a.length;
  const ma = ra.reduce((x, y) => x + y, 0) / n;
  const mb = rb.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = ra[i] - ma, y = rb[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return num / Math.sqrt(da * db);
}
/** Permutation p-value: shuffle one variable, recompute, count exceedances.
 *  Makes no distributional assumption, which matters here. */
function permutationP(a, b, iters = 20000) {
  const observed = Math.abs(spearman(a, b));
  const shuffled = b.slice();
  let hits = 0;
  // Deterministic PRNG so the reported p-value is reproducible.
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let t = 0; t < iters; t++) {
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    if (Math.abs(spearman(a, shuffled)) >= observed) hits++;
  }
  return (hits + 1) / (iters + 1);
}

const rug = rows.map((r) => r.terrainRuggedness);

console.log("=== 1. TREND ACROSS ALL ROUTES (not binned) ===");
console.log(`  n = ${rows.length}\n`);
console.log("  " + "effect".padEnd(10) + "Spearman rho".padStart(14) + "perm p".padStart(10) + "  direction");
for (const key of ["dSlope", "dRough", "dDepth"]) {
  const v = rows.map((r) => r[key]);
  const rho = spearman(rug, v);
  const p = permutationP(rug, v);
  // Effects are negative for avoidance, so a NEGATIVE rho means "stronger
  // avoidance on rougher ground" -- the predicted dose-response.
  const dir = key === "dDepth"
    ? (rho > 0 ? "deeper on rugged ground" : "shallower on rugged ground")
    : (rho < 0 ? "stronger avoidance on rugged ground" : "weaker on rugged ground");
  console.log("  " + key.padEnd(10) + rho.toFixed(3).padStart(14) +
    (p < 1e-4 ? "<1e-4" : p.toFixed(4)).padStart(10) + "  " + dir);
}

console.log("\n=== 2. SOURCE COMPOSITION BY RUGGEDNESS QUARTILE ===");
console.log("  If sources segregate by quartile, ruggedness and agency are");
console.log("  confounded and the gradient cannot be attributed to terrain.\n");
const sorted = rows.slice().sort((a, b) => a.terrainRuggedness - b.terrainRuggedness);
const q = Math.floor(sorted.length / 4);
const sources = [...new Set(rows.map((r) => r.source))].sort();
console.log("  " + "source".padEnd(22) + "Q1".padStart(6) + "Q2".padStart(6) + "Q3".padStart(6) + "Q4".padStart(6));
for (const s of sources) {
  const counts = [0, 1, 2, 3].map((i) => {
    const slice = sorted.slice(i * q, i === 3 ? sorted.length : (i + 1) * q);
    return slice.filter((r) => r.source === s).length;
  });
  console.log("  " + s.padEnd(22) + counts.map((c) => String(c).padStart(6)).join(""));
}

console.log("\n=== 3. TREND WITHIN EACH SOURCE ===");
console.log("  The decisive test. Within one agency, survey fidelity and");
console.log("  cartographic convention are held constant, so any remaining");
console.log("  trend is terrain rather than who drew the line.\n");
console.log("  " + "source".padEnd(22) + "n".padStart(5) + "rho(rug, dSlope)".padStart(18) +
  "perm p".padStart(10) + "median dSlope".padStart(15));
const withinResults = [];
for (const s of sources) {
  const sub = rows.filter((r) => r.source === s);
  if (sub.length < 20) {
    console.log("  " + s.padEnd(22) + String(sub.length).padStart(5) + "too few".padStart(18));
    continue;
  }
  const a = sub.map((r) => r.terrainRuggedness);
  const b = sub.map((r) => r.dSlope);
  const rho = spearman(a, b);
  const p = permutationP(a, b, 10000);
  withinResults.push({ source: s, n: sub.length, rho, p, medianDSlope: median(b) });
  console.log("  " + s.padEnd(22) + String(sub.length).padStart(5) +
    rho.toFixed(3).padStart(18) + (p < 1e-4 ? "<1e-4" : p.toFixed(4)).padStart(10) +
    median(b).toFixed(2).padStart(15));
}

console.log("\n=== 4. IS THE EFFECT PRESENT IN EVERY SOURCE? ===");
console.log("  A finding that exists in one agency's data and nowhere else is a");
console.log("  property of that agency, not of submarine cables.\n");
console.log("  " + "source".padEnd(22) + "n".padStart(5) + "median dSlope".padStart(15) +
  "median dRough".padStart(15) + "  avoids?");
for (const s of sources) {
  const sub = rows.filter((r) => r.source === s);
  if (sub.length < 5) continue;
  const ds = median(sub.map((r) => r.dSlope));
  const dr = median(sub.map((r) => r.dRough));
  console.log("  " + s.padEnd(22) + String(sub.length).padStart(5) +
    ds.toFixed(2).padStart(15) + dr.toFixed(2).padStart(15) +
    "  " + (ds < 0 && dr < 0 ? "yes" : ds < 0 || dr < 0 ? "partial" : "NO"));
}
