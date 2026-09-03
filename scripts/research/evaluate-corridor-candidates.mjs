// Does the corridor result survive a proper candidate set?
//
// THE WEAKNESS THIS TESTS. evaluate-longhaul-prediction.mjs measures corridor
// distance against the 412-route EMODnet corpus with a same-agency exclusion.
// For a transatlantic route that leaves a handful of candidates, all European,
// so the corridor term saturates across most of the ocean. The strongest result
// in the study -- corridor beating hand-set terrain on 15/15 routes above
// 2,000 km -- therefore rests on the sparsest possible candidate set.
//
// TeleGeography catalogues 724 systems worldwide. Swapping it in is the obvious
// strengthening, with two costs that are measured rather than waved away:
// its geometry is schematic (see lib/tgCorridorIndex.mjs), and the subject
// cable is in the candidate set, so exclusion has to be geometric.
//
// THE EXCLUSION SWEEP IS THE EXPERIMENT. TeleGeography contains the subject
// cable, so a router given the raw index can partly trace the answer. Systems
// are ranked by how closely they shadow the subject and the top k are dropped:
// k=0 shows the uncontrolled reading, k=1 removes the subject's own entry, k=3
// removes it plus its two nearest corridor-mates. If the effect is the router
// finding itself it collapses at k=1. If it is corridor reuse it decays
// gradually and should still clear the great-circle floor at k=3.
//
// Reports, for every band and k, against the same great-circle floor and the
// same corpus-based corridor number the previous run produced, so the two
// candidate sets are directly comparable.
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { BathyGrid, resampleByLength } from "./lib/bathyGrid.mjs";
import { routeBetween, ZERO_WEIGHTS } from "./lib/corridorRouter.mjs";
import { routeDeviationKm, geodesicPath } from "./lib/routeDeviation.mjs";
import { buildCorridorIndex, corridorDistanceFor, EXCLUSION } from "./lib/corridorIndex.mjs";
import { buildTgIndex, bestMatchingSystems, tgCorridorDistanceFor } from "./lib/tgCorridorIndex.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, ".cache");
const GRID_DIR = join(CACHE, "bathy-tiles-lh60");
const PER_DEG = 60;
const CORRIDOR_DEG = 1.0;
const EXPANSION_BUDGET = (km) => Math.max(2_000_000, Math.ceil(km * 4_000));

/**
 * How many of the closest-tracking TeleGeography systems to exclude.
 *
 * A RADIUS DOES NOT WORK ON THIS DATA, and finding that out was the useful
 * part. Measured across the corpus, the best-matching TeleGeography system
 * sits at a median of 12.3 km from a 40-500 km subject, 27.1 km at
 * 1,000-2,000 km and 44.3 km at 2,000+ km -- and NOT ONE subject anywhere has
 * a system within 5 km. TeleGeography carries 7.3 vertices per 1,000 km; it is
 * a connectivity schematic, not a route, so it never traces a real cable
 * closely. A radius small enough to mean "this is the same cable" therefore
 * fires on nothing, and one large enough to fire takes half the ocean's
 * genuine corridor-mates with it.
 *
 * Ranking systems by how closely they shadow the subject and dropping the top
 * k targets the leak directly. k=0 is reported so the uncontrolled reading is
 * visible; k=1 removes whatever TeleGeography holds for the subject cable
 * itself; k=3 removes it along with its two nearest corridor-mates, which is
 * the conservative end.
 */
const EXCLUDE_K = [0, 1, 3];
/** Subject samples used to decide exclusion. Enough to characterise the whole
 *  route; more would only slow the per-route exclusion pass. */
const SHADOW_SAMPLES = 60;

const BANDS = [
  { id: "regional", label: "40-500 km", min: 40, max: 500 },
  { id: "medium", label: "500-1,000 km", min: 500, max: 1000 },
  { id: "long", label: "1,000-2,000 km", min: 1000, max: 2000 },
  { id: "veryLong", label: "2,000+ km", min: 2000, max: Infinity },
];

const args = process.argv.slice(2);
const ONLY = (() => { const i = args.indexOf("--band"); return i >= 0 ? args[i + 1] : null; })();
const LIMIT = (() => { const i = args.indexOf("--limit"); return i >= 0 ? Number(args[i + 1]) : Infinity; })();

if (!existsSync(join(GRID_DIR, "manifest.json"))) {
  console.error(`No grid at ${GRID_DIR}. Run build-longhaul-grid.mjs first.`);
  process.exit(1);
}
const grid = new BathyGrid(GRID_DIR, PER_DEG);
const corpus = JSON.parse(readFileSync(join(CACHE, "cable-corpus.json"), "utf-8"));
const cables = JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "data", "cables.json"), "utf-8"));

const obsOf = (r) => r.coordinates.map(([lng, lat]) => [lat, lng]);
const medianOf = (xs) => {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

console.log("=".repeat(78));
console.log("CORRIDOR CANDIDATE SET: EMODnet corpus  vs  TeleGeography 724 systems");
console.log("=".repeat(78));

const tg = buildTgIndex(cables);
console.log(`TeleGeography: ${tg.systemCount} systems, ${tg.rawVertices.toLocaleString("en-US")} raw vertices ` +
  `-> ${tg.points.toLocaleString("en-US")} points densified at ${tg.stepKm} km`);

function systemKey(r) {
  const p = r.properties ?? {};
  const raw = p.name ?? p.naam ?? p.kabel_nr ?? p.omschrijvi ?? null;
  return raw ? String(raw).trim().toUpperCase() : null;
}
const corpusIndex = buildCorridorIndex(corpus.routes, corpus.routes.map(systemKey));
const indexOf = new Map(corpus.routes.map((r, i) => [r, i]));

const usable = corpus.routes.filter(
  (r) => r.lengthKm >= 40 && r.coordinates.every(([lng, lat]) => grid.elevation(lat, lng) !== null)
);
console.log(`Corpus routes with full grid coverage: ${usable.length}\n`);

const CORRIDOR_W = { depth: 0, slope: 0, rough: 0, corridor: 1.5 };

function score(route, weights, corridorFn) {
  const obs = obsOf(route);
  const res = routeBetween(grid, obs[0], obs[obs.length - 1], weights, CORRIDOR_DEG,
    EXPANSION_BUDGET(route.lengthKm), corridorFn);
  if (!res.reachable) return null;
  const dev = routeDeviationKm(obs, res.path);
  return dev ? dev.meanKm : null;
}

const results = [];

for (const band of BANDS) {
  if (ONLY && band.id !== ONLY) continue;
  let inBand = usable.filter((r) => r.lengthKm >= band.min && r.lengthKm < band.max);
  if (Number.isFinite(LIMIT)) inBand = inBand.slice(0, LIMIT);
  console.log("-".repeat(78));
  console.log(`BAND ${band.label}  --  ${inBand.length} routes`);
  console.log("-".repeat(78));
  if (inBand.length < 8) { console.log("  too few routes, skipped\n"); continue; }

  const rows = [];
  let done = 0;
  for (const r of inBand) {
    const obs = obsOf(r);
    const row = { source: r.source, lengthKm: r.lengthKm, dev: {}, excluded: {} };

    const gd = routeDeviationKm(obs, geodesicPath(obs[0], obs[obs.length - 1]));
    row.dev.geodesic = gd ? gd.meanKm : null;
    row.dev.seapath = score(r, ZERO_WEIGHTS, null);

    // Baseline: the corpus index with same-agency exclusion, exactly as the
    // previous run computed it.
    const ri = indexOf.get(r);
    row.dev.corpus = ri === undefined ? null
      : score(r, CORRIDOR_W, corridorDistanceFor(corpusIndex, ri, EXCLUSION.sameAgency));

    // TeleGeography, excluding the k systems that shadow this route most
    // closely. k=0 is the uncontrolled reading and is reported so the size of
    // the self-prediction leak is visible rather than assumed away.
    const thinned = resampleByLength(r.coordinates, Math.min(SHADOW_SAMPLES, r.coordinates.length));
    for (const k of EXCLUDE_K) {
      const { excluded, ranked } = bestMatchingSystems(tg, thinned, k);
      row.excluded[k] = excluded.size;
      if (k === 0 && ranked.length) row.nearestTrackKm = ranked[0].medianKm;
      row.dev[`tg${k}`] = score(r, CORRIDOR_W, tgCorridorDistanceFor(tg, excluded));
    }

    rows.push(row);
    done++;
    if (process.stdout.isTTY) process.stdout.write(`\r  scoring ${done}/${inBand.length}   `);
  }
  if (process.stdout.isTTY) process.stdout.write("\r" + " ".repeat(60) + "\r");

  const keys = ["geodesic", "seapath", "corpus", ...EXCLUDE_K.map((x) => `tg${x}`)];
  const complete = rows.filter((r) => keys.every((k) => Number.isFinite(r.dev[k])));
  console.log(`  complete on all variants: ${complete.length} of ${rows.length}`);
  if (complete.length < 8) { console.log("  too few complete, skipped\n"); continue; }

  const geoMed = medianOf(complete.map((r) => r.dev.geodesic));
  console.log("");
  console.log("  " + "candidate set".padEnd(50) + "median".padStart(9) + "vs geodesic".padStart(13) +
    "excl.systems".padStart(14));
  const summary = [];
  for (const k of keys) {
    const med = medianOf(complete.map((r) => r.dev[k]));
    const rel = ((med - geoMed) / geoMed) * 100;
    const label =
      k === "geodesic" ? "Great circle" :
      k === "seapath" ? "Shortest sea path" :
      k === "corpus" ? "Corridor: EMODnet corpus (same-agency excl.)" :
      `Corridor: TeleGeography (top-${k.slice(2)} tracker excluded)`;
    const exclAvg = k.startsWith("tg")
      ? (complete.reduce((a, r) => a + (r.excluded[+k.slice(2)] ?? 0), 0) / complete.length).toFixed(1)
      : "—";
    summary.push({ key: k, label, medianKm: med, vsGeodesicPct: rel, meanExcluded: exclAvg });
    console.log("  " + label.padEnd(50) + med.toFixed(1).padStart(9) +
      (k === "geodesic" ? "—" : `${rel > 0 ? "+" : ""}${rel.toFixed(1)}%`).padStart(13) +
      String(exclAvg).padStart(14));
  }

  // Paired sign tests against the great-circle floor: the claim that matters is
  // "beats a straight line", per route, not "has a smaller median".
  function signTest(a, b) {
    const diffs = complete.map((r) => r.dev[a] - r.dev[b]).filter((d) => d !== 0);
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

  console.log("\n  paired vs great circle:");
  const paired = [];
  for (const k of ["corpus", ...EXCLUDE_K.map((x) => `tg${x}`)]) {
    const t = signTest(k, "geodesic");
    const pct = t.n ? ((100 * t.wins) / t.n).toFixed(0) : "—";
    paired.push({ key: k, winPct: +pct, n: t.n, p: t.p });
    console.log(`    ${k.padEnd(10)} better on ${String(t.wins).padStart(4)}/${String(t.n).padEnd(4)} (${pct}%)  ` +
      `p ${Number.isNaN(t.p) ? "n/a" : t.p < 1e-4 ? "<1e-4" : t.p.toFixed(4)}`);
  }
  console.log("");

  results.push({ ...band, n: inBand.length, complete: complete.length, summary, paired, perRoute: complete });
}

writeFileSync(join(CACHE, "corridor-candidates.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  question:
    "Does corridor following still predict real cables when candidates come from TeleGeography's 724 " +
    "systems rather than the 412-route EMODnet corpus?",
  telegeography: { systems: tg.systemCount, rawVertices: tg.rawVertices, densifiedPoints: tg.points, stepKm: tg.stepKm },
  exclusion: {
    method: "drop the k TeleGeography systems whose median distance along the subject route is smallest",
    k: EXCLUDE_K,
    subjectSamples: SHADOW_SAMPLES,
    minCoverage: 0.6,
    note:
      "A fixed radius was tried first and excluded nothing: no TeleGeography system tracks any corpus " +
      "route within 5 km (best-match median 12.3 km regional, 44.3 km at 2,000+ km).",
  },
  caveat:
    "TeleGeography geometry is schematic (7.3 vertices/1,000 km, median segment 69 km). Densifying a chord " +
    "does not recover the route, so corridor distance here is distance to a SCHEMATIC of a cable. This is a " +
    "more representative candidate set but a noisier instrument than the corpus-based one.",
  bands: results,
}, null, 2));
console.log(`Wrote ${join(CACHE, "corridor-candidates.json")}`);
