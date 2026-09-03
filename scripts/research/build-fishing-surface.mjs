// Fishing intensity as a routing cost surface, on the same grid as the bathymetry.
//
// WHY THIS DATASET, AND NOT GLOBAL FISHING WATCH.
//
// The study's discussion says the dominant influences on cable routing are
// "landing-point constraints, existing infrastructure, fishing and anchoring
// zones, jurisdiction" -- and then tests only the first two. Fishing is the
// obvious next candidate and the best-motivated one: 80-86% of real cable
// faults are fishing and anchoring, overwhelmingly in water shallower than
// 200 m. A router optimising deep-water bathymetric difficulty is optimising a
// variable that is not where cables actually break.
//
// Global Fishing Watch (Kroodsma et al., Science 2018) is the citable global
// source and its public dataset is downloadable from Zenodo without an
// account. It was NOT chosen as the primary surface, for two reasons:
//
//   - RESOLUTION. GFW's public grid is 0.1 degrees (~11 km). The routing grid
//     here is 1.85 km. A 0.1 degree cost surface cannot resolve a routing
//     decision the study is trying to detect.
//   - CONSISTENCY. EMODnet Human Activities publishes AIS-derived vessel
//     density by ship type at ~1.7 km, from the same organisation and the same
//     WCS service family as the cable routes and bathymetry this study already
//     uses. Keeping the instrument family constant removes a whole class of
//     cross-provider confound, and preserves the project's "no API key, no
//     account, Node only" reproducibility property.
//
// GFW remains the right source for a GLOBAL extension and should be cited as
// the reason this question is worth asking. This is the European instrument
// for a European-weighted corpus.
//
// COVERAGE. emodnet__vesseldensity_01avg is "Vessel Density Annual Averages -
// Fishing", EPSG:3857, spanning roughly 15N-78N and 88W-98E, annual layers
// 2017-2024, in hours per square kilometre per month. Corpus routes outside
// that envelope -- the southern-hemisphere and Pacific SHOM routes -- cannot be
// scored and are reported as uncovered rather than as zero fishing.
//
// TWO CONFOUNDS THAT MUST TRAVEL WITH ANY RESULT FROM THIS SURFACE.
//
//   1. TEMPORAL DIRECTION. The fishing data is 2017-2024. Most corpus cables
//      were laid earlier. So this cannot show that cable routers avoided
//      fishing grounds; at best it shows that cables and fishing effort are
//      spatially separated today. Fishing grounds are persistent, which makes
//      the measurement informative, but the causal arrow is not established by
//      it.
//
//   2. REVERSE CAUSALITY, and this one is sharper. Cable protection zones
//      restrict fishing near cables. Wherever such a zone exists, low fishing
//      effort near a cable is a CONSEQUENCE of the cable, not a reason for its
//      route. A naive reading would report that as "cables avoid fishing" with
//      the causality exactly backwards. Any analysis built on this surface has
//      to address it -- the obvious control is the placebo displacement the
//      study already uses, since a displaced line sits outside the protection
//      zone while sharing the fishing ground.
//
// Writes Float32 tiles, one per degree at 60 cells/degree, matching
// bathy-tiles-lh60 cell-for-cell so a router can read both without resampling.
import { fromArrayBuffer } from "geotiff";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, ".cache");
const OUT = join(CACHE, "fishing-tiles-60");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const WCS = "https://ows.emodnet-humanactivities.eu/wcs";
const COVERAGE = "emodnet__vesseldensity_01avg";
const PER_DEG = 60;
const CORRIDOR_DEG = 1.0;
const MIN_KM = 40;
const CONCURRENCY = 2;
/** Native coverage envelope in degrees, from DescribeCoverage (EPSG:3857
 *  bounds converted). Requests outside it return an error rather than an empty
 *  tile, so they are skipped and recorded as uncovered. */
const ENVELOPE = { minLat: 15.0, maxLat: 78.6, minLng: -87.7, maxLng: 97.6 };

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const YEAR = (() => { const i = args.indexOf("--year"); return i >= 0 ? args[i + 1] : "2022"; })();
const LIMIT = (() => { const i = args.indexOf("--limit"); return i >= 0 ? Number(args[i + 1]) : Infinity; })();
const TIME = `${YEAR}-01-01T00:00:00.000Z`;

const corpus = JSON.parse(readFileSync(join(CACHE, "cable-corpus.json"), "utf-8"));
const wrapLng = (lng) => (((lng + 180) % 360) + 360) % 360 - 180;

/** Same corridor-tile rule as build-longhaul-grid.mjs, so the two grids cover
 *  the same ground. A fishing surface that stopped at the route would be
 *  useless to a router, which needs to know what it is steering around. */
function corridorTiles(route) {
  const c = route.coordinates;
  const a = c[0], b = c[c.length - 1];
  const minLat = Math.min(a[1], b[1]) - CORRIDOR_DEG;
  const maxLat = Math.max(a[1], b[1]) + CORRIDOR_DEG;
  const minLng = Math.min(a[0], b[0]) - CORRIDOR_DEG;
  const maxLng = Math.max(a[0], b[0]) + CORRIDOR_DEG;
  const out = [];
  for (let tLat = Math.floor(minLat); tLat <= Math.floor(maxLat); tLat++) {
    for (let tLng = Math.floor(minLng); tLng <= Math.floor(maxLng); tLng++) {
      if (tLat < -90 || tLat >= 90) continue;
      out.push([tLat, wrapLng(tLng)]);
    }
  }
  return out;
}

const wanted = new Map();
for (const r of corpus.routes) {
  if (r.lengthKm < MIN_KM) continue;
  for (const [lat, lng] of corridorTiles(r)) wanted.set(`${lat},${lng}`, { lat, lng });
}

const inEnvelope = (t) =>
  t.lat >= Math.floor(ENVELOPE.minLat) && t.lat < ENVELOPE.maxLat &&
  t.lng >= Math.floor(ENVELOPE.minLng) && t.lng < ENVELOPE.maxLng;

const all = [...wanted.values()];
const covered = all.filter(inEnvelope);
const outside = all.filter((t) => !inEnvelope(t));
const todo = covered.filter((t) => !existsSync(join(OUT, `${t.lat}_${t.lng}.bin`)));

console.log(`Corridor tiles wanted:        ${all.length.toLocaleString("en-US")}`);
console.log(`  inside coverage envelope:   ${covered.length.toLocaleString("en-US")}`);
console.log(`  OUTSIDE (cannot be scored): ${outside.length.toLocaleString("en-US")}`);
console.log(`  already built:              ${(covered.length - todo.length).toLocaleString("en-US")}`);
console.log(`  to fetch (year ${YEAR}):        ${todo.length.toLocaleString("en-US")}`);
console.log(`  approx bytes on disk:       ${((covered.length * PER_DEG * PER_DEG * 4) / 1e6).toFixed(0)} MB`);

if (DRY_RUN) { console.log("\n--dry-run: nothing written."); process.exit(0); }

async function fetchTile(t) {
  const key = `${t.lat}_${t.lng}`;
  const url =
    `${WCS}?service=WCS&version=2.0.1&request=GetCoverage&coverageId=${COVERAGE}` +
    `&format=image/tiff` +
    `&subsettingCrs=${encodeURIComponent("http://www.opengis.net/def/crs/EPSG/0/4326")}` +
    `&subset=${encodeURIComponent(`Lat(${t.lat},${t.lat + 1})`)}` +
    `&subset=${encodeURIComponent(`Long(${t.lng},${t.lng + 1})`)}` +
    `&subset=${encodeURIComponent(`time("${TIME}")`)}` +
    `&outputCrs=${encodeURIComponent("http://www.opengis.net/def/crs/EPSG/0/4326")}` +
    // Requested well above the 60/deg output, because the service pads the
    // subset outward: asking for 60x60 would spread those pixels across the
    // padded box and deliver something coarser than the target grid. 200x200
    // over a padded ~2.3 degree box is finer than the ~1.7 km native cell, so
    // nothing is lost before the sampling step below.
    `&scalesize=${encodeURIComponent("i(200),j(200)")}`;

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      // The DescribeCoverage envelope is the MOSAIC bounding box, not the data
      // extent, and the real extent is not a rectangle: probing on a 5-degree
      // lattice returns data across the north-east Atlantic and Europe but
      // nothing off the US coast below 50N, and only patchily below 35N. Where
      // no granule exists the service answers 500, which is a definitive "no
      // data here" rather than a transient fault -- retrying it three times
      // would just triple the time spent discovering the same absence.
      if (res.status === 500) return { key, uncovered: true };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 500 || (buf[0] !== 0x49 && buf[0] !== 0x4d)) {
        throw new Error(`not a tiff: ${buf.toString("utf-8", 0, 160).replace(/\s+/g, " ")}`);
      }
      const img = await (
        await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
      ).getImage();
      const W = img.getWidth(), H = img.getHeight();
      const bb = img.getBoundingBox(); // [minLng, minLat, maxLng, maxLat]

      // THE SERVICE DOES NOT RETURN THE BOX YOU ASK FOR. Its native grid is
      // EPSG:3857 at ~2.7 km, and a lat/lon subset is snapped outward to whole
      // source cells before reprojection, so a 1-degree request comes back
      // padded by up to ~0.67 degrees. An alignment check written against the
      // requested box therefore rejects every tile, and code that assumed
      // alignment would silently shift fishing effort by tens of kilometres --
      // attributing a fishing ground to the wrong stretch of ocean.
      //
      // So the returned georeference is used as the authority: each output cell
      // is sampled at its own centre from wherever it actually falls in the
      // source raster. The only thing verified is that the requested degree
      // square is CONTAINED in what came back.
      // What has to be covered is the SAMPLE POINTS, not the whole degree box.
      // Values are read at cell centres, which sit half a cell inside each
      // edge, so a returned box falling a few hundred metres short of the
      // boundary still contains every point actually read. Checking the full
      // box instead rejected good tiles over a ~330 m shortfall -- an eighteenth
      // of one output cell.
      const half = 0.5 / PER_DEG;
      const needMinLng = t.lng + half, needMaxLng = t.lng + 1 - half;
      const needMinLat = t.lat + half, needMaxLat = t.lat + 1 - half;
      if (bb[0] > needMinLng || bb[2] < needMaxLng ||
          bb[1] > needMinLat || bb[3] < needMaxLat) {
        throw new Error(
          `returned box [${bb[0].toFixed(3)},${bb[1].toFixed(3)},${bb[2].toFixed(3)},${bb[3].toFixed(3)}] ` +
          `does not contain requested ${t.lng},${t.lat},${t.lng + 1},${t.lat + 1}`
        );
      }

      const raw = (await img.readRasters())[0];
      const out = new Float32Array(PER_DEG * PER_DEG);
      let nodata = 0, active = 0, peak = 0;
      const spanLng = bb[2] - bb[0], spanLat = bb[3] - bb[1];
      for (let r = 0; r < PER_DEG; r++) {
        // Cell centres, so a value is sampled at the middle of the ground it
        // represents rather than at a corner shared with three neighbours.
        const lat = t.lat + 1 - (r + 0.5) / PER_DEG;
        const sy = Math.min(H - 1, Math.max(0, Math.floor(((bb[3] - lat) / spanLat) * H)));
        for (let c = 0; c < PER_DEG; c++) {
          const lng = t.lng + (c + 0.5) / PER_DEG;
          const sx = Math.min(W - 1, Math.max(0, Math.floor(((lng - bb[0]) / spanLng) * W)));
          const v = raw[sy * W + sx];
          // The nodata sentinel is -3.4e38; anything non-finite or absurd is
          // treated the same way. Zero is a REAL value here (no fishing
          // observed) and is deliberately never conflated with missing.
          if (!Number.isFinite(v) || v < -1e30) { out[r * PER_DEG + c] = NaN; nodata++; continue; }
          out[r * PER_DEG + c] = v;
          if (v > 0) active++;
          if (v > peak) peak = v;
        }
      }
      writeFileSync(join(OUT, `${key}.bin`), Buffer.from(out.buffer));
      return { key, nodata, active, peak };
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
  return { key, failed: String(lastErr?.message ?? lastErr) };
}

const queue = todo.slice(0, LIMIT === Infinity ? todo.length : LIMIT);
const failures = [];
let done = 0, activeCells = 0, nodataCells = 0, peakAll = 0, uncovered = 0;
const started = Date.now();

async function worker() {
  for (;;) {
    const t = queue.shift();
    if (!t) return;
    const r = await fetchTile(t);
    if (r.uncovered) uncovered++;
    else if (r.failed) failures.push(r);
    else { activeCells += r.active; nodataCells += r.nodata; peakAll = Math.max(peakAll, r.peak); }
    done++;
    if (done % 25 === 0 || done === queue.length + done - queue.length) {
      const rate = done / ((Date.now() - started) / 1000);
      const left = Math.round((todo.length - done) / Math.max(rate, 0.01));
      console.log(`  ${done}/${todo.length}  ${rate.toFixed(1)}/s  ETA ${Math.floor(left / 60)}m${left % 60}s`);
    }
  }
}
if (queue.length) {
  console.log(`\nFetching ${queue.length.toLocaleString("en-US")} tiles...`);
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

if (failures.length) {
  console.log(`\n  ${failures.length} failed:`);
  for (const f of failures.slice(0, 8)) console.log(`    ${f.key}: ${f.failed}`);
}
const built = covered.filter((t) => existsSync(join(OUT, `${t.lat}_${t.lng}.bin`)));

writeFileSync(join(OUT, "manifest.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: {
    service: WCS,
    coverage: COVERAGE,
    title: "Vessel Density Annual Averages - Fishing",
    publisher: "EMODnet Human Activities",
    upstream: "AIS purchased annually from Collecte Localisation Satellites (CLS) and ORBCOMM",
    year: YEAR,
    availableYears: "2017-2024",
    units: "hours per square kilometre per month",
  },
  provenance:
    "REAL source, DERIVED grid. AIS-derived vessel density for the Fishing ship-type class, resampled by " +
    "the WCS from its native ~1.7 km EPSG:3857 grid to 60 cells/degree in EPSG:4326. Cell values are an " +
    "annual average; zero means no fishing observed, NaN means outside coverage.",
  cellsPerDegree: PER_DEG,
  approxCellMetres: Math.round(111320 / PER_DEG),
  encoding: { type: "Float32LE", nodata: "NaN", zeroMeaning: "no fishing observed (a real value, not missing)" },
  envelope: ENVELOPE,
  tilesWanted: all.length,
  tilesInEnvelope: covered.length,
  tilesOutsideEnvelope: outside.length,
  tilesBuilt: built.length,
  tilesWithNoGranule: uncovered,
  confounds: [
    "TEMPORAL DIRECTION: fishing data is 2017-2024; most corpus cables were laid earlier, so spatial " +
      "separation today does not establish that routers avoided fishing grounds.",
    "REVERSE CAUSALITY: cable protection zones restrict fishing near cables, so low fishing effort beside " +
      "a cable can be a consequence of the cable rather than a reason for its route. The placebo " +
      "displacement is the natural control, since a displaced line leaves the protection zone while " +
      "staying in the same fishing ground.",
  ],
  tiles: built.map((t) => `${t.lat}_${t.lng}`),
}, null, 2));

console.log(`\nBuilt ${built.length.toLocaleString("en-US")} fishing tiles in ${OUT}`);
console.log(`  cells with non-zero fishing effort: ${activeCells.toLocaleString("en-US")}`);
console.log(`  cells outside coverage (NaN):       ${nodataCells.toLocaleString("en-US")}`);
console.log(`  tiles with no data granule (500):   ${uncovered.toLocaleString("en-US")}`);
console.log(`  peak observed: ${peakAll.toFixed(1)} hours/km2/month`);
console.log(`Wrote ${join(OUT, "manifest.json")}`);
