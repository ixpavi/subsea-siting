// If not terrain, then what? Testing whether cables follow each other.
//
// The placebo study and the prediction experiment agree that seabed terrain
// explains only a modest part of where cables go. That leaves the interesting
// question open, and the most plausible alternative is not exotic: cable
// projects reuse corridors. Existing routes come with survey data, established
// permits, known burial conditions and proven landing approaches, all of which
// are expensive to obtain afresh. A new cable near an old one inherits some of
// that.
//
// This is testable with exactly the same instrument as the terrain study, which
// is the point -- a hypothesis that needs a whole new method is hard to compare
// against the one it is meant to beat.
//
// DESIGN. For each route, measure the distance from its own geometry to the
// NEAREST OTHER cable in the corpus. Then displace that route sideways and
// measure again. Displaced lines are not cables, so whatever proximity they
// show is what this corridor of ocean offers by chance. The difference is
// corridor-following.
//
// The route being tested is excluded from its own comparison, or every route
// would trivially sit zero metres from a cable -- itself.
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { haversineKm } from "./lib/bathyGrid.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(__dirname, ".cache", "cable-corpus.json"), "utf-8"));

const SAMPLE_EVERY = 8;      // vertices, to keep the all-pairs search tractable
const DISPLACEMENTS_KM = [20, -20, 50, -50];
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
console.log(`Corpus: ${routes.length} routes\n`);

// --- Spatial index over all route vertices ---------------------------------
// Bucketed by whole degree so the nearest-other-cable search does not have to
// scan every vertex of every route for every sample.
const BUCKET = 1;
const buckets = new Map();
for (let ri = 0; ri < routes.length; ri++) {
  for (const [lng, lat] of routes[ri].coordinates) {
    const key = `${Math.floor(lat / BUCKET)}:${Math.floor(lng / BUCKET)}`;
    let b = buckets.get(key);
    if (!b) { b = []; buckets.set(key, b); }
    b.push([lat, lng, ri]);
  }
}

/** Distance to the nearest vertex belonging to a DIFFERENT route. Rings
 *  outward and stops once no closer bucket could contain anything. */
function nearestOtherRouteKm(lat, lng, excludeRouteIndex, exclude = () => false) {
  let best = Infinity;
  for (let ring = 0; ring <= 4; ring++) {
    const r0 = Math.floor(lat / BUCKET), c0 = Math.floor(lng / BUCKET);
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const b = buckets.get(`${r0 + dr}:${c0 + dc}`);
        if (!b) continue;
        for (const [bLat, bLng, ri] of b) {
          if (ri === excludeRouteIndex) continue;
          if (exclude(ri)) continue;
          const d = haversineKm(lat, lng, bLat, bLng);
          if (d < best) best = d;
        }
      }
    }
    // A ring at distance n covers at least (n-1) whole degrees, so once the
    // best find is inside that, no further ring can improve on it.
    if (best < (ring - 1) * BUCKET * 111) break;
  }
  return Number.isFinite(best) ? best : null;
}

/** Median nearest-other-cable distance along a route, optionally displaced. */
function proximityFor(routeIndex, displacementKm, exclude) {
  const r = routes[routeIndex];
  const ds = [];
  for (let i = 0; i < r.coordinates.length - 1; i += SAMPLE_EVERY) {
    const [lng1, lat1] = r.coordinates[i];
    const [lng2, lat2] = r.coordinates[i + 1];
    let lat = lat1, lng = lng1;
    if (displacementKm !== 0) {
      const perp = bearingOf(lat1, lng1, lat2, lng2) + Math.PI / 2;
      [lat, lng] = project(lat1, lng1, displacementKm >= 0 ? perp : perp + Math.PI, Math.abs(displacementKm));
    }
    const d = nearestOtherRouteKm(lat, lng, routeIndex, exclude);
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
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
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

// Three exclusion levels, reported together. A finding that only survives the
// weakest one is a finding about data structure, not about cable engineering.
const LEVELS = [
  {
    id: "different-feature",
    label: "any other route (weakest)",
    make: () => () => false,
  },
  {
    id: "different-system",
    label: "excluding segments of the SAME named cable",
    make: (ri) => {
      const k = sysKeys[ri];
      return k === null ? () => false : (other) => sysKeys[other] === k;
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
    const exclude = lvl.make(ri);
    const real = proximityFor(ri, 0, exclude);
    if (real === null) continue;
    const placebo = DISPLACEMENTS_KM.map((d) => proximityFor(ri, d, exclude)).filter((v) => v !== null);
    if (placebo.length < 2) continue;
    const pm = median(placebo);
    rows.push({ source: routes[ri].source, real, placebo: pm, diff: real - pm });
  }
  if (rows.length < 20) {
    console.log(`
${lvl.label}: only ${rows.length} routes measurable -- too few.`);
    results[lvl.id] = { routes: rows.length, insufficient: true };
    continue;
  }
  const realMed = median(rows.map((r) => r.real));
  const placMed = median(rows.map((r) => r.placebo));
  const t = signTest(rows.map((r) => r.diff));
  results[lvl.id] = {
    label: lvl.label, routes: rows.length, realMedianKm: realMed,
    placeboMedianKm: placMed, differenceKm: realMed - placMed,
    closerPct: (100 * t.neg) / t.n, n: t.n, p: t.p,
  };
}

console.log("
=== CORRIDOR FOLLOWING, BY EXCLUSION STRICTNESS ===");
console.log("  Median distance to the nearest qualifying cable, real vs displaced.
");
console.log("  " + "compared against".padEnd(46) + "n".padStart(5) + "real".padStart(8) +
  "control".padStart(9) + "closer".padStart(9) + "p".padStart(9));
for (const lvl of LEVELS) {
  const r = results[lvl.id];
  if (!r || r.insufficient) { console.log("  " + lvl.label.padEnd(46) + "too few"); continue; }
  console.log("  " + lvl.label.padEnd(46) + String(r.routes).padStart(5) +
    `${r.realMedianKm.toFixed(1)}km`.padStart(8) + `${r.placeboMedianKm.toFixed(1)}km`.padStart(9) +
    `${r.closerPct.toFixed(0)}%`.padStart(9) + (r.p < 1e-4 ? "<1e-4" : r.p.toFixed(4)).padStart(9));
}

console.log("
=== VERDICT ===");
const strict = results["different-agency"];
const mid = results["different-system"];
if (strict && !strict.insufficient && strict.p < 0.01 && strict.differenceKm < 0) {
  console.log("  The effect survives excluding every route from the same agency, so it");
  console.log("  is not an artefact of one dataset's segmentation. Cables genuinely sit");
  console.log("  closer to OTHER operators' cables than displaced lines in the same");
  console.log("  water do.");
} else if (mid && !mid.insufficient && mid.p < 0.01 && mid.differenceKm < 0) {
  console.log("  The effect survives excluding segments of the same named cable, but");
  console.log("  NOT the same-agency exclusion. That is still meaningful -- different");
  console.log("  cables do cluster -- but the strictest test cannot separate corridor");
  console.log("  reuse from one agency surveying one corridor densely.");
} else {
  console.log("  The effect does NOT survive the stricter exclusions. It is largely an");
  console.log("  artefact of the same physical cable, or the same agency's survey area,");
  console.log("  appearing as multiple nearby features. Not a finding about cables.");
}

writeFileSync(join(__dirname, ".cache", "corridor-following.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  design: "median distance to nearest vertex of any OTHER corpus route, real vs sideways-displaced",
  displacementsKm: DISPLACEMENTS_KM,
  levels: results,
}, null, 2));
console.log("\nwrote corridor-following.json");
