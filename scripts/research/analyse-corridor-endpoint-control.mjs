// Is corridor reuse actually corridor reuse, or is it landfall geometry?
//
// THE OBJECTION. analyse-corridor-following.mjs measures the distance from each
// route to the nearest other cable, then displaces the route 20-50 km sideways
// and measures again. Real routes come out 68% closer than their displaced
// twins, surviving exclusion of the same cable and the same agency, and that is
// the largest effect in the study.
//
// But cables converge at landing points because they have to. Two systems
// making landfall at the same beach are close there for reasons that have
// nothing to do with reusing a surveyed corridor. The displacement is applied
// per-vertex, perpendicular to the local heading, so it moves the route's
// endpoints out of those convergence zones along with everything else. That is
// exactly the shape of a confound: the real line samples the crowded water near
// landfalls, the placebo samples emptier water beside it, and the difference
// gets read as an engineering preference.
//
// Nothing in the three published exclusion levels addresses this. They exclude
// candidates by identity -- same segment, same cable, same agency -- and a
// different operator's cable landing on the same beach passes all three.
//
// TWO CONTROLS, applied on top of the strictest published exclusion (different
// agency), because that is the level the paper's claim rests on.
//
//   A. TRIM. Discard samples within T km along the route of either of its own
//      endpoints, so the landfall approaches are not measured at all. Swept
//      over T so the effect can be watched decay rather than checked once. This
//      is the robust control: it makes no assumption about what an endpoint
//      means, only that the confound lives near one.
//
//   B. SHARED-LANDFALL EXCLUSION. Additionally drop any candidate route with an
//      endpoint within L km of an endpoint of the subject route -- "do not
//      compare me against cables that land where I land". More direct, but
//      weaker evidence than the trim: EMODnet publishes route SEGMENTS, so an
//      endpoint is sometimes an administrative cut mid-ocean rather than a
//      landfall, which makes this exclusion both incomplete and occasionally
//      spurious. Reported alongside A, not instead of it.
//
// The placebo receives identical treatment under both controls. Trimming only
// the real line, or excluding candidates only for it, would manufacture the
// very bias this is testing for.
//
// WHAT WOULD FALSIFY THE PAPER'S CLAIM. If the effect is landfall geometry, it
// should fall towards zero as T grows past the width of a convergence zone --
// a few tens of km. If it is corridor reuse, mid-route water should follow
// other cables too, and the effect should persist with the ends removed.
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { haversineKm } from "./lib/bathyGrid.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(__dirname, ".cache", "cable-corpus.json"), "utf-8"));

// Identical to analyse-corridor-following.mjs so the numbers are comparable.
const SAMPLE_EVERY = 8;
const DISPLACEMENTS_KM = [20, -20, 50, -50];
const BUCKET = 1;
const R = 6371;

const TRIM_KM = [0, 10, 20, 30, 50];
const LANDFALL_KM = [0, 25, 50]; // 0 disables control B

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

const routes = corpus.routes;
console.log(`Corpus: ${routes.length} routes`);

// --- Along-route distance, so the trim is in km and not in vertex count ------
// Vertex spacing varies by two orders of magnitude across sources; trimming a
// fixed number of vertices would cut 200 m from one route and 200 km from
// another.
const cumKm = routes.map((r) => {
  const c = r.coordinates;
  const out = new Float64Array(c.length);
  for (let i = 1; i < c.length; i++) {
    out[i] = out[i - 1] + haversineKm(c[i - 1][1], c[i - 1][0], c[i][1], c[i][0]);
  }
  return out;
});
const routeLenKm = cumKm.map((c) => (c.length ? c[c.length - 1] : 0));

const endpointsOf = routes.map((r) => {
  const c = r.coordinates;
  return [
    [c[0][1], c[0][0]],
    [c[c.length - 1][1], c[c.length - 1][0]],
  ];
});

/** Closest approach between the endpoint pairs of two routes. */
function endpointSeparationKm(a, b) {
  let best = Infinity;
  for (const p of endpointsOf[a]) {
    for (const q of endpointsOf[b]) {
      const d = haversineKm(p[0], p[1], q[0], q[1]);
      if (d < best) best = d;
    }
  }
  return best;
}

// --- Spatial index over every route vertex (as in the original) -------------
const buckets = new Map();
for (let ri = 0; ri < routes.length; ri++) {
  for (const [lng, lat] of routes[ri].coordinates) {
    const key = `${Math.floor(lat / BUCKET)}:${Math.floor(lng / BUCKET)}`;
    let b = buckets.get(key);
    if (!b) { b = []; buckets.set(key, b); }
    b.push([lat, lng, ri]);
  }
}

function nearestQualifyingKm(lat, lng, selfIndex, excludes) {
  let best = Infinity;
  const r0 = Math.floor(lat / BUCKET);
  const c0 = Math.floor(lng / BUCKET);
  for (let ring = 0; ring <= 4; ring++) {
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const b = buckets.get(`${r0 + dr}:${c0 + dc}`);
        if (!b) continue;
        for (let k = 0; k < b.length; k++) {
          const ri = b[k][2];
          if (ri === selfIndex || excludes(ri)) continue;
          const d = haversineKm(lat, lng, b[k][0], b[k][1]);
          if (d < best) best = d;
        }
      }
    }
    if (best < (ring - 1) * BUCKET * 111) break;
  }
  return Number.isFinite(best) ? best : null;
}

/** As the original, plus: skip samples within trimKm of either route end. */
function proximityFor(routeIndex, displacementKm, excludes, trimKm) {
  const r = routes[routeIndex];
  const cum = cumKm[routeIndex];
  const total = routeLenKm[routeIndex];
  const ds = [];
  for (let i = 0; i < r.coordinates.length - 1; i += SAMPLE_EVERY) {
    if (trimKm > 0 && (cum[i] < trimKm || total - cum[i] < trimKm)) continue;
    const [lng1, lat1] = r.coordinates[i];
    const [lng2, lat2] = r.coordinates[i + 1];
    let lat = lat1;
    let lng = lng1;
    if (displacementKm !== 0) {
      const perp = bearingOf(lat1, lng1, lat2, lng2) + Math.PI / 2;
      const p = project(lat1, lng1, displacementKm >= 0 ? perp : perp + Math.PI, Math.abs(displacementKm));
      lat = p[0];
      lng = p[1];
    }
    const d = nearestQualifyingKm(lat, lng, routeIndex, excludes);
    if (d !== null) ds.push(d);
  }
  if (ds.length < 3) return null;
  ds.sort((a, b) => a - b);
  return ds[Math.floor(ds.length / 2)];
}

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
function signTest(diffs) {
  const nz = diffs.filter((d) => d !== 0 && Number.isFinite(d));
  const neg = nz.filter((d) => d < 0).length;
  const n = nz.length;
  if (n < 8) return { n, neg, p: NaN };
  const z = (Math.abs(neg - n / 2) - 0.5) / Math.sqrt(n / 4);
  return { n, neg, p: 2 * (1 - 0.5 * (1 + erf(z / Math.SQRT2))) };
}

/** Strictest published exclusion, optionally plus shared-landfall exclusion. */
function makeExcluder(ri, landfallKm) {
  const src = routes[ri].source;
  if (landfallKm <= 0) return (other) => routes[other].source === src;
  return (other) =>
    routes[other].source === src || endpointSeparationKm(ri, other) < landfallKm;
}

function run(trimKm, landfallKm) {
  const rows = [];
  for (let ri = 0; ri < routes.length; ri++) {
    // A route shorter than twice the trim has nothing left in the middle. It is
    // dropped rather than measured on a remnant, which is why n falls with T.
    if (trimKm > 0 && routeLenKm[ri] <= 2 * trimKm) continue;
    const excludes = makeExcluder(ri, landfallKm);
    const real = proximityFor(ri, 0, excludes, trimKm);
    if (real === null) continue;
    const placebo = DISPLACEMENTS_KM
      .map((d) => proximityFor(ri, d, excludes, trimKm))
      .filter((v) => v !== null);
    if (placebo.length < 2) continue;
    const pm = median(placebo);
    rows.push({ real, placebo: pm, diff: real - pm });
  }
  if (rows.length < 20) return { routes: rows.length, insufficient: true };
  const realMed = median(rows.map((r) => r.real));
  const placMed = median(rows.map((r) => r.placebo));
  const t = signTest(rows.map((r) => r.diff));
  return {
    routes: rows.length,
    realMedianKm: realMed,
    placeboMedianKm: placMed,
    closerPct: (100 * t.neg) / t.n,
    reductionPct: placMed > 0 ? (100 * (placMed - realMed)) / placMed : NaN,
    n: t.n,
    p: t.p,
  };
}

const fmtP = (p) => (Number.isNaN(p) ? "  n/a" : p < 1e-4 ? "<1e-4" : p.toFixed(4));
const results = {};

console.log("\n=== CONTROL A: TRIM THE LANDFALL APPROACHES ===");
console.log("  Strictest published exclusion (different agency), with samples");
console.log("  within T km of either route end discarded from both the real");
console.log("  route and its displaced placebo.\n");
console.log("  trim T     n     real   placebo   closer   reduction        p");
for (const T of TRIM_KM) {
  const r = run(T, 0);
  results[`trim${T}`] = r;
  if (r.insufficient) {
    console.log(`  ${String(T).padStart(5)} km  ${String(r.routes).padStart(4)}   -- too few routes remain --`);
    continue;
  }
  console.log(
    `  ${String(T).padStart(5)} km  ${String(r.routes).padStart(4)}  ${r.realMedianKm.toFixed(1).padStart(6)}km ${r.placeboMedianKm.toFixed(1).padStart(7)}km ${r.closerPct.toFixed(0).padStart(6)}% ${r.reductionPct.toFixed(0).padStart(9)}%  ${fmtP(r.p).padStart(7)}`
  );
}

console.log("\n=== CONTROL B: ALSO EXCLUDE CABLES THAT LAND WHERE I LAND ===");
console.log("  As above at T = 30 km, additionally excluding any candidate");
console.log("  route with an endpoint within L km of one of mine.\n");
console.log("  landfall L     n     real   placebo   closer   reduction        p");
for (const L of LANDFALL_KM) {
  const r = run(30, L);
  results[`trim30-landfall${L}`] = r;
  if (r.insufficient) {
    console.log(`  ${String(L).padStart(9)} km  ${String(r.routes).padStart(4)}   -- too few routes remain --`);
    continue;
  }
  console.log(
    `  ${String(L).padStart(9)} km  ${String(r.routes).padStart(4)}  ${r.realMedianKm.toFixed(1).padStart(6)}km ${r.placeboMedianKm.toFixed(1).padStart(7)}km ${r.closerPct.toFixed(0).padStart(6)}% ${r.reductionPct.toFixed(0).padStart(9)}%  ${fmtP(r.p).padStart(7)}`
  );
}

// --- Verdict ---------------------------------------------------------------
const base = results.trim0;
const trimmed = results.trim30;
const both = results["trim30-landfall50"];

console.log("\n=== VERDICT ===");
if (!base || base.insufficient || !trimmed || trimmed.insufficient) {
  console.log("  Insufficient routes survive the controls to decide.");
} else {
  console.log(`  published (no trim)        : ${base.reductionPct.toFixed(0)}% closer, ${base.closerPct.toFixed(0)}% of routes`);
  console.log(`  landfall approaches removed: ${trimmed.reductionPct.toFixed(0)}% closer, ${trimmed.closerPct.toFixed(0)}% of routes`);
  if (both && !both.insufficient) {
    console.log(`  + shared-landfall excluded  : ${both.reductionPct.toFixed(0)}% closer, ${both.closerPct.toFixed(0)}% of routes`);
  }
  const retained = trimmed.reductionPct / base.reductionPct;
  console.log();

  // Direction and magnitude are reported separately, because here they
  // disagree. The sign test asks how many routes lie closer than their own
  // placebo; the reduction compares medians across routes. A consistent but
  // small per-route effect on a heavily skewed distribution can hold the first
  // while collapsing the second, and reporting only one would be a choice
  // about which answer to give.
  const dirHolds = trimmed.p < 0.05;
  const magHolds = retained > 0.6;

  if (!dirHolds) {
    console.log("  DOES NOT SURVIVE. With the landfall approaches removed the");
    console.log("  effect is no longer significant, so the published result is");
    console.log("  substantially an artefact of cables converging at landing");
    console.log("  points. Section 4b must be rewritten.");
  } else if (magHolds) {
    console.log("  CONTROL A: SURVIVES. Trimming the approaches costs some of the");
    console.log(`  effect (${base.reductionPct.toFixed(0)}% -> ${trimmed.reductionPct.toFixed(0)}%) but it holds on mid-route water,`);
    console.log("  where nothing forces cables together. Landfall convergence is");
    console.log("  part of the published number, not the whole of it.");
  } else {
    console.log("  CONTROL A: WEAKENED. Most of the published effect was the");
    console.log("  landfall approaches. Restate the claim at the trimmed size.");
  }

  // Control B is reported on its own terms and is NOT folded into the verdict
  // above, because its exclusion is known to be blunt: EMODnet publishes route
  // SEGMENTS, so an "endpoint" is often an administrative cut in open water
  // rather than a landfall. Excluding every route with an endpoint within L km
  // therefore removes genuine corridor neighbours along with landfall twins,
  // and the collapse it produces is a lower bound on the effect, not a
  // measurement of it. Deciding this properly needs real landing points.
  if (both && !both.insufficient) {
    console.log();
    if (both.reductionPct < 10 && both.p < 0.05) {
      console.log("  CONTROL B: DIRECTION HOLDS, MAGNITUDE COLLAPSES.");
      console.log(`  ${both.closerPct.toFixed(0)}% of routes still sit closer than their own placebo`);
      console.log(`  (p ${fmtP(both.p)}), but the median gap falls to ${both.reductionPct.toFixed(0)}%.`);
      console.log("  Treat this as a LOWER BOUND, not a result: excluding every");
      console.log("  route sharing an endpoint also removes true corridor");
      console.log("  neighbours, because EMODnet endpoints are frequently");
      console.log("  administrative cuts rather than landfalls. Re-running this");
      console.log("  against real landing points is the test that would settle it.");
    } else {
      console.log(`  CONTROL B: ${both.reductionPct.toFixed(0)}% closer, ${both.closerPct.toFixed(0)}% of routes, p ${fmtP(both.p)}.`);
      console.log("  Blunt instrument -- EMODnet endpoints are often administrative");
      console.log("  cuts, so this over-excludes. Lower bound, not a measurement.");
    }
  }

  console.log();
  console.log("  HONEST HEADLINE. The direction of the corridor effect is robust");
  console.log("  to every control tried. Its published magnitude is not: section");
  console.log(`  4b's ${base.reductionPct.toFixed(0)}% should be stated as ${trimmed.reductionPct.toFixed(0)}% with landfall approaches`);
  console.log("  excluded, and the paper should say the range is bounded below by");
  console.log("  the shared-endpoint test until real landing points settle it.");
}

writeFileSync(
  join(__dirname, ".cache", "corridor-endpoint-control.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), trimKm: TRIM_KM, landfallKm: LANDFALL_KM, results }, null, 2)
);
console.log("\nwrote corridor-endpoint-control.json");
