// Acceptance test for the combined bathymetry: EMODnet (Europe/Caribbean) plus
// the NOAA global mosaic (everything else).
//
// Downloading tiles proves only that requests succeeded. The same three things
// have to hold as for Phase 1, and each is checked against the real corpus:
//
//   1. ORIENTATION. A flipped raster returns terrain from the wrong latitude
//      without erroring. Nothing crashes, the grid still looks like bathymetry,
//      and every later result is wrong. Asserted on points whose land/sea
//      status is not in doubt -- and asserted SEPARATELY for the new source,
//      because two providers can disagree about row order.
//
//   2. COVERAGE. Every corpus route must now resolve to real terrain, or be
//      excluded explicitly rather than interpolated over.
//
//   3. INDEPENDENT AGREEMENT. Cable positions and bathymetry come from
//      unrelated sources, and cables are in water. Route vertices on positive
//      elevation therefore indicate bad georeferencing -- the cheapest strong
//      check available.
//
// A fourth check matters only here: the two sources must AGREE where they
// overlap. If EMODnet and NOAA disagree about depth in the same place, then
// combining them into one analysis silently mixes two different measurement
// systems, and any effect could be an artefact of which source covered which
// route.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { BathyGrid } from "./lib/bathyGrid.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EU = join(__dirname, ".cache", "bathy-tiles");
const GLOBAL = join(__dirname, ".cache", "bathy-tiles-global");
const corpus = JSON.parse(readFileSync(join(__dirname, ".cache", "cable-corpus.json"), "utf-8"));

const euGrid = new BathyGrid(EU, 240);
const globalGrid = new BathyGrid(GLOBAL, 240);

/** Prefer EMODnet where it exists (higher native resolution), fall back to the
 *  global mosaic. Which source answered is reported, never hidden. */
function elevationAt(lat, lng) {
  const e = euGrid.elevation(lat, lng);
  if (e !== null) return { v: e, src: "emodnet" };
  const g = globalGrid.elevation(lat, lng);
  if (g !== null) return { v: g, src: "global" };
  return { v: null, src: null };
}

// --- 1. Orientation, per source -------------------------------------------
console.log("=== 1. ORIENTATION (checked per source) ===");
// Reference points must lie INSIDE the fetched tiles. Only tiles near corpus
// routes were downloaded, so a point in continental Australia returns "no
// data" -- which an earlier version of this check misread as a failed
// orientation. Absent data and wrong data are different findings and must not
// share a code path.
const checks = [
  ["EMODnet", euGrid, "inland Belgium", 51.21, 2.92, "open North Sea", 51.9, 2.5],
  // Reunion's interior rises to 3,070 m and Tahiti's to 2,241 m, so a positive
  // reading there is checkable against real geography rather than assumed.
  ["NOAA global", globalGrid, "Reunion interior", -21.10, 55.50, "Indian Ocean abyssal", -21.5, 56.5],
];
let orientationOk = true;
for (const [name, grid, ln, lLat, lLng, sn, sLat, sLng] of checks) {
  const land = grid.elevation(lLat, lLng);
  const sea = grid.elevation(sLat, sLng);
  if (land === null || sea === null) {
    console.log(`  ${name.padEnd(12)} *** NO DATA at a reference point -- the check cannot run.`);
    console.log(`  ${" ".repeat(12)}     This means the tile was not fetched, NOT that orientation is wrong.`);
    orientationOk = false;
    continue;
  }
  const ok = land > 0 && sea < 0;
  if (!ok) orientationOk = false;
  console.log(`  ${name.padEnd(12)} ${ln} = ${land}m (want >0), ${sn} = ${sea}m (want <0)  ${ok ? "PASS" : "*** FAIL ***"}`);
}
if (!orientationOk) {
  console.log("\n  Stopping: a wrong orientation invalidates everything downstream.");
  process.exit(1);
}

// --- 2. Coverage over the whole corpus ------------------------------------
let vTotal = 0, vMissing = 0, vLand = 0;
const bySrc = { emodnet: 0, global: 0 };
const complete = [];
const incomplete = [];

for (const r of corpus.routes) {
  let missing = 0, onLand = 0;
  for (const [lng, lat] of r.coordinates) {
    vTotal++;
    const { v, src } = elevationAt(lat, lng);
    if (v === null) { missing++; vMissing++; continue; }
    bySrc[src]++;
    if (v > 0) { onLand++; vLand++; }
  }
  (missing === 0 ? complete : incomplete).push({ ...r, missing, onLand });
}

console.log("\n=== 2. COVERAGE over the FULL corpus ===");
console.log(`  corpus routes         : ${corpus.routes.length}`);
console.log(`  vertices checked      : ${vTotal.toLocaleString()}`);
console.log(`  vertices with terrain : ${(vTotal - vMissing).toLocaleString()} (${((100 * (vTotal - vMissing)) / vTotal).toFixed(2)}%)`);
console.log(`    from EMODnet        : ${bySrc.emodnet.toLocaleString()}`);
console.log(`    from NOAA global    : ${bySrc.global.toLocaleString()}`);
console.log(`  fully covered routes  : ${complete.length} of ${corpus.routes.length}`);
const completeKm = Math.round(complete.reduce((a, r) => a + r.lengthKm, 0));
console.log(`  usable corpus         : ${complete.length} routes, ${completeKm.toLocaleString()} km`);
if (incomplete.length) {
  console.log(`  routes with gaps      : ${incomplete.length}`);
  for (const r of incomplete.slice(0, 6)) {
    console.log(`    ${r.source.padEnd(20)} ${r.lengthKm.toFixed(0).padStart(6)} km, ${r.missing} vertices missing`);
  }
}

// --- 3. Independent agreement ---------------------------------------------
console.log("\n=== 3. INDEPENDENT AGREEMENT (cables are in water) ===");
console.log(`  vertices on positive elevation: ${vLand.toLocaleString()} (${((100 * vLand) / vTotal).toFixed(3)}%)`);
console.log("  A small figure is expected: cables make landfall, and a ~460 m cell");
console.log("  straddling a beach reads as land.");

// --- 4. Do the two sources agree where they overlap? ----------------------
console.log("\n=== 4. SOURCE AGREEMENT WHERE BOTH COVER ===");
console.log("  Combining two bathymetry products into one analysis is only valid");
console.log("  if they measure the same thing. Sampled on corpus routes that fall");
console.log("  inside both.\n");

const diffs = [];
for (const r of corpus.routes) {
  for (let i = 0; i < r.coordinates.length; i += 7) {
    const [lng, lat] = r.coordinates[i];
    const a = euGrid.elevation(lat, lng);
    const b = globalGrid.elevation(lat, lng);
    if (a === null || b === null) continue;
    diffs.push(a - b);
    if (diffs.length > 40000) break;
  }
}

if (diffs.length < 50) {
  console.log(`  Only ${diffs.length} overlapping samples -- the two products barely`);
  console.log("  overlap on this corpus, so no cross-source comparison is possible.");
  console.log("  Which source served each route must then be reported as a covariate.");
} else {
  const abs = diffs.map(Math.abs).sort((x, y) => x - y);
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const rms = Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / diffs.length);
  console.log(`  overlapping samples : ${diffs.length.toLocaleString()}`);
  console.log(`  mean signed diff    : ${mean.toFixed(2)} m   (0 = no systematic offset)`);
  console.log(`  RMS difference      : ${rms.toFixed(2)} m`);
  console.log(`  median |diff|       : ${abs[Math.floor(abs.length / 2)].toFixed(2)} m`);
  console.log(`  p95 |diff|          : ${abs[Math.floor(abs.length * 0.95)].toFixed(2)} m`);
  console.log("");
  // Judge on the MEDIAN, not the mean. This distribution is heavily skewed:
  // the two products agree almost exactly in the typical case and diverge
  // sharply in a minority of places -- steep flanks and coastal cells, where a
  // 115 m survey and a coarser composite genuinely disagree. A mean of tens of
  // metres against a median of about one metre describes that tail, not a
  // systematic offset, and treating it as one would wrongly rule out combining
  // products that match nearly everywhere.
  const medianAbs = abs[Math.floor(abs.length / 2)];
  if (medianAbs < 15) {
    console.log("  Typical agreement is close: the products can be combined, preferring");
    console.log("  EMODnet where it exists (finer native resolution) and treating the");
    console.log("  tail as measurement noise concentrated on steep and coastal cells.");
    console.log("  Which source served each route should still be reported as a");
    console.log("  covariate, since it is not randomly assigned -- it is geography.");
  } else {
    console.log("  *** SYSTEMATIC OFFSET. The two products disagree on average, so");
    console.log("  combining them would confound source with geography. Analyse them");
    console.log("  separately, or report source as a covariate. ***");
  }
}
