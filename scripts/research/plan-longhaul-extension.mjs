// What would it take to run the prediction experiment on routes over 500 km?
//
// THE PROBLEM THIS SIZES. evaluate-route-prediction.mjs caps routes at 500 km
// ("longer ones make the search cost explode") and restricts itself to
// EMODnet's envelope. That leaves the study testing terrain-driven routing on
// REGIONAL routes while the literature it argues with -- Wang/Zukerman et al.
// on trans-oceanic path planning -- is about long-haul. A reviewer will say the
// experiment does not test the regime the method is used in, and they will be
// right.
//
// 96 corpus routes exceed 500 km. Before writing any of the extension, three
// things have to be measured rather than assumed:
//
//   1. SEARCH SIZE. A* runs over a corridor around the endpoints' bounding
//      box, at 240 cells/degree. That area grows with the SQUARE of route
//      length. A 500 km route is a few million cells; a 3,000 km route is
//      tens of millions, which blows both the expansion cap (2,000,000) and
//      the Map-backed gScore. The question is not "is it slower" but "at what
//      resolution does each length band become tractable at all".
//
//   2. TILE COVERAGE. Bathymetry was downloaded as a 1-degree dilation around
//      each observed ROUTE, but A* searches a corridor around the endpoints'
//      BOUNDING BOX. For a short route those are nearly the same region. For a
//      long one the bounding box is enormously larger than the route, so most
//      of the searchable corridor has no tiles at all. Missing tiles read as
//      null, which the router treats as land -- so the search would not fail
//      loudly, it would silently route around holes in the download. That is
//      the dangerous failure mode and it has to be quantified first.
//
//   3. WHICH TILE SET. Phase 1 (EMODnet, lat 11..90 / lng -70.5..43) and
//      Phase 2 (NOAA global mosaic, built only for the 56 routes outside
//      EMODnet) are separate directories in the same format. Long routes will
//      cross both, and some will need tiles neither set has.
//
// Reports only. Downloads nothing, routes nothing, writes one JSON summary.
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, ".cache");
const corpus = JSON.parse(readFileSync(join(CACHE, "cable-corpus.json"), "utf-8"));

const TILE_DIRS = {
  emodnet: join(CACHE, "bathy-tiles"),
  global: join(CACHE, "bathy-tiles-global"),
};

/** Matches evaluate-route-prediction.mjs so the numbers are comparable. */
const CORRIDOR_DEG = 1.0;
const PER_DEG_CURRENT = 240;
/** Coarser grids to consider for long-haul. 240 = ~460 m, 120 = ~930 m,
 *  60 = ~1.85 km, 30 = ~3.7 km. */
const PER_DEG_OPTIONS = [240, 120, 60, 30];
/** The router's own cap. A search needing more expansions than this returns
 *  "unreachable", which for this purpose means the band is not tractable. */
const MAX_EXPANSIONS = 2_000_000;

const BANDS = [
  { label: "40-500 km (current study)", min: 40, max: 500 },
  { label: "500-1,000 km", min: 500, max: 1000 },
  { label: "1,000-2,000 km", min: 1000, max: 2000 },
  { label: "2,000-3,000 km", min: 2000, max: 3000 },
  { label: "3,000+ km", min: 3000, max: Infinity },
];

const tileCache = new Map();
function tileExists(dir, tLat, tLng) {
  const key = `${dir}|${tLat}_${tLng}`;
  let v = tileCache.get(key);
  if (v === undefined) {
    v = existsSync(join(dir, `${tLat}_${tLng}.bin`));
    tileCache.set(key, v);
  }
  return v;
}

function wrapLng(lng) {
  return (((lng + 180) % 360) + 360) % 360 - 180;
}

/**
 * The 1-degree tiles A* could touch for this route: the endpoints' bounding
 * box dilated by the corridor width. Deliberately NOT the tiles along the
 * observed route -- that is what was downloaded, and the gap between the two
 * is the whole point of this script.
 */
function corridorTiles(route) {
  const c = route.coordinates;
  const a = c[0], b = c[c.length - 1];
  const minLat = Math.min(a[1], b[1]) - CORRIDOR_DEG;
  const maxLat = Math.max(a[1], b[1]) + CORRIDOR_DEG;
  const minLng = Math.min(a[0], b[0]) - CORRIDOR_DEG;
  const maxLng = Math.max(a[0], b[0]) + CORRIDOR_DEG;

  const tiles = [];
  for (let tLat = Math.floor(minLat); tLat <= Math.floor(maxLat); tLat++) {
    for (let tLng = Math.floor(minLng); tLng <= Math.floor(maxLng); tLng++) {
      if (tLat < -90 || tLat >= 90) continue;
      tiles.push([tLat, wrapLng(tLng)]);
    }
  }
  return { tiles, spanLat: maxLat - minLat, spanLng: maxLng - minLng };
}

/**
 * Antimeridian check. A route crossing 180 degrees gets a bounding box
 * spanning almost the whole globe if longitudes are treated naively, which
 * would make the corridor meaningless. French Polynesia sits right there, so
 * this is not hypothetical for this corpus.
 */
function crossesAntimeridian(route) {
  const c = route.coordinates;
  for (let i = 1; i < c.length; i++) {
    if (Math.abs(c[i][0] - c[i - 1][0]) > 180) return true;
  }
  return false;
}

const rows = [];
for (const r of corpus.routes) {
  const { tiles, spanLat, spanLng } = corridorTiles(r);
  let have = 0, haveEmodnet = 0, haveGlobal = 0;
  const missing = [];
  for (const [tLat, tLng] of tiles) {
    const e = tileExists(TILE_DIRS.emodnet, tLat, tLng);
    const g = tileExists(TILE_DIRS.global, tLat, tLng);
    if (e) haveEmodnet++;
    if (g) haveGlobal++;
    if (e || g) have++;
    else missing.push([tLat, tLng]);
  }
  rows.push({
    source: r.source,
    lengthKm: r.lengthKm,
    vertices: r.vertices,
    spanLat,
    spanLng,
    antimeridian: crossesAntimeridian(r),
    tilesNeeded: tiles.length,
    tilesHave: have,
    tilesHaveEmodnet: haveEmodnet,
    tilesHaveGlobal: haveGlobal,
    tilesMissing: tiles.length - have,
    coverage: tiles.length ? have / tiles.length : 0,
    missingSample: missing.slice(0, 5),
  });
}

/** Cells in the corridor at a given resolution. This is the search space, and
 *  it is what decides tractability -- A* expands some fraction of it. */
function corridorCells(row, perDeg) {
  return row.spanLat * perDeg * row.spanLng * perDeg;
}

const fmt = (n) => Math.round(n).toLocaleString("en-US");
const pct = (x) => `${(x * 100).toFixed(0)}%`;

console.log("=".repeat(78));
console.log("LONG-HAUL EXTENSION FEASIBILITY");
console.log("=".repeat(78));
console.log(`Corpus: ${corpus.routes.length} routes`);
console.log(`Corridor: +/-${CORRIDOR_DEG} deg around the endpoints' bounding box`);
console.log(`Router expansion cap: ${fmt(MAX_EXPANSIONS)}`);
console.log("");

console.log("--- 1. SEARCH SIZE BY LENGTH BAND ---------------------------------");
console.log("Median corridor cells, by grid resolution. A band is tractable when");
console.log("this is within a small multiple of the expansion cap.\n");

const header = ["Band", "n", ...PER_DEG_OPTIONS.map((p) => `${p}/deg`)];
console.log(header[0].padEnd(26) + header[1].padStart(5) + PER_DEG_OPTIONS.map((p) => `${p}/deg`.padStart(14)).join(""));

const median = (a) => {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const bandStats = [];
for (const band of BANDS) {
  const inBand = rows.filter((r) => r.lengthKm >= band.min && r.lengthKm < band.max);
  const cellsByRes = PER_DEG_OPTIONS.map((p) => median(inBand.map((r) => corridorCells(r, p))));
  bandStats.push({ ...band, n: inBand.length, cellsByRes, rows: inBand });
  console.log(
    band.label.padEnd(26) +
      String(inBand.length).padStart(5) +
      cellsByRes.map((c) => fmt(c).padStart(14)).join("")
  );
}

console.log("");
console.log("--- 2. TILE COVERAGE OF THE SEARCH CORRIDOR ------------------------");
console.log("Tiles the corridor could touch vs tiles actually downloaded. A cell");
console.log("with no tile reads as null, which the router treats as LAND -- so a");
console.log("gap here does not error, it silently deforms the route.\n");

console.log(
  "Band".padEnd(26) + "n".padStart(5) + "median cov".padStart(12) +
  "fully cov".padStart(11) + "tiles missing".padStart(15)
);
for (const b of bandStats) {
  const covs = b.rows.map((r) => r.coverage);
  const full = b.rows.filter((r) => r.tilesMissing === 0).length;
  const totalMissing = b.rows.reduce((a, r) => a + r.tilesMissing, 0);
  console.log(
    b.label.padEnd(26) +
      String(b.n).padStart(5) +
      pct(median(covs)).padStart(12) +
      `${full}/${b.n}`.padStart(11) +
      fmt(totalMissing).padStart(15)
  );
}

console.log("");
console.log("--- 3. WHAT A LONG-HAUL RUN WOULD NEED TO DOWNLOAD -----------------");
const longHaul = rows.filter((r) => r.lengthKm >= 500);
// Unique across routes: long-haul corridors overlap heavily, so summing the
// per-route shortfalls would badly overcount what actually has to be fetched.
const uniqueMissing = new Set();
for (const r of corpus.routes) {
  if (r.lengthKm < 500) continue;
  const { tiles } = corridorTiles(r);
  for (const [tLat, tLng] of tiles) {
    if (!tileExists(TILE_DIRS.emodnet, tLat, tLng) && !tileExists(TILE_DIRS.global, tLat, tLng)) {
      uniqueMissing.add(`${tLat},${tLng}`);
    }
  }
}
const MB_PER_TILE = (240 * 240 * 2) / 1_000_000;
console.log(`Routes >= 500 km:                 ${longHaul.length}`);
console.log(`Unique 1-degree tiles missing:    ${fmt(uniqueMissing.size)}`);
console.log(`Approx download at 240/deg:       ${(uniqueMissing.size * MB_PER_TILE).toFixed(0)} MB`);
console.log(`Approx download at 60/deg:        ${(uniqueMissing.size * MB_PER_TILE / 16).toFixed(0)} MB`);

console.log("");
console.log("--- 4. AWKWARD CASES ----------------------------------------------");
const anti = rows.filter((r) => r.antimeridian);
console.log(`Routes crossing the antimeridian: ${anti.length}`);
for (const r of anti.slice(0, 10)) {
  console.log(`  ${r.source.padEnd(16)} ${fmt(r.lengthKm).padStart(7)} km  span ${r.spanLng.toFixed(1)} deg lng`);
}

console.log("");
console.log("--- 5. PER-SOURCE BREAKDOWN OF LONG-HAUL ROUTES --------------------");
const bySource = new Map();
for (const r of longHaul) {
  if (!bySource.has(r.source)) bySource.set(r.source, []);
  bySource.get(r.source).push(r);
}
console.log("Source".padEnd(18) + "n".padStart(5) + "median km".padStart(12) + "median cov".padStart(12));
for (const [src, rs] of [...bySource.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(
    src.padEnd(18) +
      String(rs.length).padStart(5) +
      fmt(median(rs.map((r) => r.lengthKm))).padStart(12) +
      pct(median(rs.map((r) => r.coverage))).padStart(12)
  );
}
console.log("");
console.log("NOTE ON FOLDS. The prediction experiment holds out one national");
console.log("source at a time, so a source needs enough long-haul routes to be a");
console.log("fold. Sources with only a handful cannot be held out, and the");
console.log("long-haul experiment may have fewer usable folds than the current one.");

writeFileSync(
  join(CACHE, "longhaul-plan.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      corridorDeg: CORRIDOR_DEG,
      perDegCurrent: PER_DEG_CURRENT,
      maxExpansions: MAX_EXPANSIONS,
      bands: bandStats.map(({ rows: _rows, ...b }) => b),
      longHaulCount: longHaul.length,
      uniqueMissingTiles: uniqueMissing.size,
      antimeridianRoutes: anti.length,
      perSource: [...bySource.entries()].map(([source, rs]) => ({
        source,
        n: rs.length,
        medianKm: median(rs.map((r) => r.lengthKm)),
        medianCoverage: median(rs.map((r) => r.coverage)),
      })),
    },
    null,
    2
  )
);
console.log(`\nWrote ${join(CACHE, "longhaul-plan.json")}`);
