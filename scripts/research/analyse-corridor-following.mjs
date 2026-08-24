// If not terrain, then what? Testing whether cables follow each other.
//
// The placebo study and the prediction experiment agree that seabed terrain
// explains only a modest part of where cables go. The most plausible
// alternative is not exotic: cable projects reuse corridors. Existing routes
// come with survey data, established permits, known burial conditions and
// proven landing approaches, all expensive to obtain afresh.
//
// This uses exactly the same instrument as the terrain study -- displace the
// route, re-measure, take the difference -- so the two effects are directly
// comparable rather than being measured on different scales.
//
// THE CONFOUND THAT DECIDES EVERYTHING. EMODnet publishes route SEGMENTS, not
// whole cable systems. If a route's nearest neighbour is another segment of the
// SAME physical cable, then "cables follow cables" is true by construction and
// means nothing at all. The same applies one level up: a single agency
// surveying one busy corridor densely will produce many nearby features that
// have nothing to do with operators reusing each other's routes.
//
// So the measurement is run at three exclusion strengths and all three are
// reported. A result that survives only the weakest is a finding about how the
// data is chopped up, not about cable engineering.
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { haversineKm } from "./lib/bathyGrid.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(__dirname, ".cache", "cable-corpus.json"), "utf-8"));

const SAMPLE_EVERY = 8;
const DISPLACEMENTS_KM = [20, -20, 50, -50];
const BUCKET = 1;
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

const routes = corpus.routes;
console.log(`Corpus: ${routes.length} routes`);

/** Normalises the per-agency identifiers into one cable-system key. */
function systemKey(r) {
  const p = r.properties ?? {};
  const raw = p.name ?? p.naam ?? p.kabel_nr ?? p.omschrijvi ?? null;
  return raw ? String(raw).trim().toUpperCase() : null;
}
const sysKeys = routes.map(systemKey);
console.log(`Routes carrying a cable-system identifier: ${sysKeys.filter(Boolean).length} of ${routes.length}\n`);

// --- Spatial index over every route vertex ---------------------------------
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

function proximityFor(routeIndex, displacementKm, excludes) {
  const r = routes[routeIndex];
  const ds = [];
  for (let i = 0; i < r.coordinates.length - 1; i += SAMPLE_EVERY) {
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

const LEVELS = [
  {
    id: "any-other-route",
    label: "any other route (weakest)",
    make: () => () => false,
  },
  {
    id: "different-system",
    label: "excluding segments of the SAME named cable",
    make: (ri) => {
      const k = sysKeys[ri];
      if (k === null) return () => false;
      return (other) => sysKeys[other] === k;
    },
  },
  {
    id: "different-agency",
    label: "excluding every route from the SAME agency (strictest)",
    make: (ri) => {
      const src = routes[ri].source;
      return (other) => routes[other].source === src;
    },
  },
];

const results = {};
for (const lvl of LEVELS) {
  const rows = [];
  for (let ri = 0; ri < routes.length; ri++) {
    const excludes = lvl.make(ri);
    const real = proximityFor(ri, 0, excludes);
    if (real === null) continue;
    const placebo = DISPLACEMENTS_KM
      .map((d) => proximityFor(ri, d, excludes))
      .filter((v) => v !== null);
    if (placebo.length < 2) continue;
    const pm = median(placebo);
    rows.push({ source: routes[ri].source, real, placebo: pm, diff: real - pm });
  }
  if (rows.length < 20) {
    results[lvl.id] = { label: lvl.label, routes: rows.length, insufficient: true };
    continue;
  }
  const realMed = median(rows.map((r) => r.real));
  const placMed = median(rows.map((r) => r.placebo));
  const t = signTest(rows.map((r) => r.diff));
  results[lvl.id] = {
    label: lvl.label,
    routes: rows.length,
    realMedianKm: realMed,
    placeboMedianKm: placMed,
    differenceKm: realMed - placMed,
    closerPct: (100 * t.neg) / t.n,
    n: t.n,
    p: t.p,
  };
}

console.log("=== CORRIDOR FOLLOWING, BY EXCLUSION STRICTNESS ===");
console.log("  Median distance to the nearest qualifying cable: real routes");
console.log("  versus the same routes displaced 20-50 km sideways.\n");
console.log(
  "  " + "compared against".padEnd(48) + "n".padStart(5) + "real".padStart(9) +
  "control".padStart(10) + "closer".padStart(9) + "p".padStart(9)
);
for (const lvl of LEVELS) {
  const r = results[lvl.id];
  if (r.insufficient) {
    console.log("  " + lvl.label.padEnd(48) + String(r.routes).padStart(5) + "  too few to test");
    continue;
  }
  console.log(
    "  " + lvl.label.padEnd(48) + String(r.routes).padStart(5) +
    `${r.realMedianKm.toFixed(1)}km`.padStart(9) +
    `${r.placeboMedianKm.toFixed(1)}km`.padStart(10) +
    `${r.closerPct.toFixed(0)}%`.padStart(9) +
    (r.p < 1e-4 ? "<1e-4" : r.p.toFixed(4)).padStart(9)
  );
}

console.log("\n=== VERDICT ===");
const strict = results["different-agency"];
const mid = results["different-system"];
const strictOk = strict && !strict.insufficient && strict.p < 0.01 && strict.differenceKm < 0;
const midOk = mid && !mid.insufficient && mid.p < 0.01 && mid.differenceKm < 0;

if (strictOk) {
  console.log("  Survives excluding every route from the same agency. Cables sit closer");
  console.log("  to OTHER operators' cables than displaced lines in the same water do,");
  console.log("  so this is corridor reuse and not an artefact of one dataset's");
  console.log("  segmentation or one agency's survey area.");
} else if (midOk) {
  console.log("  Survives excluding segments of the same named cable, but NOT the");
  console.log("  same-agency exclusion. Different cables do cluster, but this corpus");
  console.log("  cannot separate genuine corridor reuse from a single agency surveying");
  console.log("  one busy corridor densely. Reportable with that limitation stated, not");
  console.log("  as a clean finding.");
} else {
  console.log("  Does NOT survive the stricter exclusions. The effect is largely the");
  console.log("  same physical cable, or the same agency's survey area, appearing as");
  console.log("  multiple nearby features. Not a finding about cable planning.");
}

const terrain = "68% of routes, -1.65 percentile (placebo-corrected slope)";
console.log(`\n  For comparison, the terrain effect: ${terrain}`);

writeFileSync(join(__dirname, ".cache", "corridor-following.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  design: "median distance to the nearest vertex of a qualifying other route, real vs sideways-displaced",
  displacementsKm: DISPLACEMENTS_KM,
  sampleEveryNthVertex: SAMPLE_EVERY,
  levels: results,
  survivesSameAgencyExclusion: !!strictOk,
  survivesSameCableExclusion: !!midOk,
}, null, 2));
console.log("\nwrote corridor-following.json");
