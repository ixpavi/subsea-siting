// When does corridor following help, and when does it hurt?
//
// §4e reports that corridor following beats a great circle long-haul and loses
// to one regionally, and offers an explanation: the corridor term helps when
// the error in the neighbour geometry is small relative to the scale of the
// prediction. That was measured across three length bands -- three points, and
// three points will fit almost any story.
//
// This tests the rule where it can actually fail: per route, on all of them.
//
//   ratio = (how far the closest-tracking TeleGeography system sits from THIS
//            route) / (how far a great circle lands from THIS route)
//   gain  = (corridor error - great-circle error) / great-circle error
//
// Both quantities are already computed per route by
// evaluate-corridor-candidates.mjs; nothing is re-run here. If the rule is
// real, gain should rise with ratio -- a route whose neighbour geometry is
// poor relative to its own difficulty should be made worse by steering toward
// that geometry, and one with good relative geometry should be improved.
//
// WHY THIS MATTERS MORE THAN THE BAND RESULT. Length is confounded with
// everything: sea, agency, depth, corridor density. A per-band relationship
// could be any of those. The ratio is measured on each route individually, so
// a relationship that holds across 348 routes spanning every band is a
// statement about the mechanism rather than about the bands.
//
// The corridor variant used is tg1 -- TeleGeography with the single
// closest-tracking system removed. tg0 would let a route be predicted partly
// from its own catalogue entry, which is exactly the leak the ratio is supposed
// to be measuring the effect of.
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, ".cache");
const data = JSON.parse(readFileSync(join(CACHE, "corridor-candidates.json"), "utf-8"));

const rows = [];
for (const band of data.bands) {
  for (const r of band.perRoute ?? []) {
    const g = r.dev?.geodesic;
    const t1 = r.dev?.tg1;
    const track = r.nearestTrackKm;
    if (![g, t1, track].every(Number.isFinite) || g <= 0) continue;
    rows.push({
      band: band.label,
      source: r.source,
      lengthKm: r.lengthKm,
      trackingKm: track,
      geodesicKm: g,
      corridorKm: t1,
      ratio: track / g,
      gain: (t1 - g) / g,
      helped: t1 < g,
    });
  }
}
rows.sort((a, b) => a.ratio - b.ratio);

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Spearman: the relationship is monotonic but nowhere near linear -- gain is
 *  unbounded above and bounded below by -1 -- so a Pearson correlation would
 *  be dominated by a handful of routes where corridor following failed badly. */
function spearman(xs, ys) {
  const n = xs.length;
  const rank = (v) => {
    const order = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(n);
    for (let i = 0; i < n; i++) r[order[i][1]] = i;
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  const rho = num / Math.sqrt(dx * dy);
  return { rho, z: rho * Math.sqrt(n - 1), n };
}

console.log("=".repeat(78));
console.log("DOES THE ERROR RATIO PREDICT WHETHER CORRIDOR FOLLOWING HELPS?");
console.log("=".repeat(78));
console.log(`Routes with both quantities recorded: ${rows.length}`);
console.log("ratio = tracking error of the nearest TeleGeography system / great-circle error");
console.log("gain  = corridor error relative to great-circle error (negative = corridor helped)\n");

const BINS = 6;
console.log("  " + "ratio range".padEnd(20) + "n".padStart(5) + "med ratio".padStart(11) +
  "% helped".padStart(11) + "med gain".padStart(11));
const bins = [];
for (let i = 0; i < BINS; i++) {
  const seg = rows.slice((i * rows.length) / BINS | 0, ((i + 1) * rows.length) / BINS | 0);
  if (!seg.length) continue;
  const helped = seg.filter((s) => s.helped).length;
  const b = {
    lo: seg[0].ratio, hi: seg[seg.length - 1].ratio, n: seg.length,
    medianRatio: median(seg.map((s) => s.ratio)),
    pctHelped: (100 * helped) / seg.length,
    medianGainPct: 100 * median(seg.map((s) => s.gain)),
  };
  bins.push(b);
  console.log("  " + `${b.lo.toFixed(2)}-${b.hi.toFixed(2)}`.padEnd(20) +
    String(b.n).padStart(5) + b.medianRatio.toFixed(2).padStart(11) +
    `${b.pctHelped.toFixed(0)}%`.padStart(11) +
    `${b.medianGainPct > 0 ? "+" : ""}${b.medianGainPct.toFixed(1)}%`.padStart(11));
}

const sp = spearman(rows.map((r) => r.ratio), rows.map((r) => r.gain));
console.log("");
console.log(`  Spearman rho = ${sp.rho >= 0 ? "+" : ""}${sp.rho.toFixed(3)}   n = ${sp.n}   z = ${sp.z.toFixed(1)}`);
console.log("  Positive rho means a worse tracking ratio predicts a worse corridor outcome,");
console.log("  which is the direction the rule requires.");

console.log("\n  " + "threshold".padEnd(16) + "below".padStart(22) + "at or above".padStart(24));
const thresholds = [0.3, 0.5, 1.0];
const cuts = [];
for (const thr of thresholds) {
  const lo = rows.filter((r) => r.ratio < thr);
  const hi = rows.filter((r) => r.ratio >= thr);
  if (!lo.length || !hi.length) continue;
  const lp = (100 * lo.filter((r) => r.helped).length) / lo.length;
  const hp = (100 * hi.filter((r) => r.helped).length) / hi.length;
  cuts.push({ threshold: thr, belowN: lo.length, belowPctHelped: lp, aboveN: hi.length, abovePctHelped: hp });
  console.log("  " + `ratio ${thr}`.padEnd(16) +
    `${lo.length} routes, ${lp.toFixed(0)}% helped`.padStart(22) +
    `${hi.length} routes, ${hp.toFixed(0)}% helped`.padStart(24));
}

console.log("\n  The rule is descriptive, not causal: ratio and gain share a denominator");
console.log("  (great-circle error), so a route that is simply hard to predict pushes the");
console.log("  ratio down and the gain around. The binned view is reported alongside the");
console.log("  correlation because it is the part that does not depend on that shared term");
console.log("  being well behaved.");

writeFileSync(join(CACHE, "error-ratio.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  question: "Does the ratio of neighbour-geometry error to prediction scale predict whether corridor following helps?",
  corridorVariant: "tg1 -- TeleGeography with the single closest-tracking system removed",
  routes: rows.length,
  spearman: sp,
  bins,
  thresholds: cuts,
  caveat:
    "ratio and gain share the great-circle error as a denominator, so the correlation is not a clean " +
    "causal estimate. The monotonic binned pattern is the load-bearing part.",
  perRoute: rows,
}, null, 2));
console.log(`\nWrote ${join(CACHE, "error-ratio.json")}`);
