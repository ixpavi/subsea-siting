// Downloads the EMODnet Bathymetry tiles needed to study the as-laid cable
// corpus, as a sparse Int16 tile set.
//
// SCOPE. Phase 1 of the bathymetry work: Europe + Caribbean, the 356 of 412
// corpus routes that fall entirely inside EMODnet Bathymetry's envelope
// (lat 11..90, lng -70.5..43). The remaining 56 routes are French overseas
// territories in the Pacific and Indian Ocean; they need a global product and
// are Phase 2. Splitting this way means the modelling pipeline can be built and
// validated against 134,557 km of real routes without first committing to a
// multi-gigabyte global download.
//
// RESOLUTION. Tiles are requested at 240x240 per degree (~460 m) rather than
// the native 960x960 (~115 m). validate-scaling.mjs and validate-scaling-bias.mjs
// established that this is safe: the server interpolates rather than point
// samples (0.1% of output cells equal a source cell), the reduction is unbiased
// at scale (global mean signed error -1.2 m), and the residual is interpolation
// noise concentrated on steep cells (steep-decile RMS 47 m) against relief of
// thousands of metres. That is 8x less data for error well below the depth
// variation the cost model needs to resolve. 460 m also sits comfortably under
// the corpus's 2 km median route sampling, so the grid can resolve the
// features the routes actually bend around.
//
// CORRIDOR. Tiles are collected within +/-1 degree (~111 km) of every route
// vertex, not just on the routes. The study asks why a cable went here and not
// there; "there" has to be loaded too, or every observed route trivially looks
// optimal for want of any competing terrain. LIMITATION TO REPORT: 111 km is
// generous for the median 171 km route but tight for the 49 routes over
// 1,000 km, where genuine alternatives may lie outside the loaded corridor.
//
// STORAGE. Int16 metres, one .bin per tile plus a manifest. Rounding to the
// metre costs 0.5 m of precision, two orders of magnitude below the 20 m
// interpolation noise already present, so it is free. A dense raster over the
// corpus bbox would be 565 MB and mostly empty -- the routes are corridors,
// not a rectangle -- so tiles stay sparse.
import { fromArrayBuffer } from "geotiff";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(__dirname, ".cache", "cable-corpus.json");
const TILES = join(__dirname, ".cache", "bathy-tiles");
if (!existsSync(TILES)) mkdirSync(TILES, { recursive: true });

const WCS = "https://ows.emodnet-bathymetry.eu/wcs";
const COVERAGE = { minLat: 11.0, maxLat: 90.0, minLng: -70.5, maxLng: 43.0 };
const PER_DEG = 240;
const DILATION = 1;
const CONCURRENCY = 4;
/** Int16 sentinel for "no bathymetry here". Distinct from any real depth. */
const NODATA = -32768;

if (!existsSync(CORPUS)) {
  console.error("Missing cable-corpus.json. Run build-cable-corpus.mjs first.");
  process.exit(1);
}

const corpus = JSON.parse(readFileSync(CORPUS, "utf-8"));
const inCoverage = (lat, lng) =>
  lat >= COVERAGE.minLat && lat <= COVERAGE.maxLat && lng >= COVERAGE.minLng && lng <= COVERAGE.maxLng;

const covered = corpus.routes.filter(
  (r) => r.coordinates.every(([lng, lat]) => inCoverage(lat, lng))
);

// --- Work out which tiles we need ------------------------------------------
const wanted = new Set();
for (const r of covered) {
  for (const [lng, lat] of r.coordinates) {
    const bLat = Math.floor(lat);
    const bLng = Math.floor(lng);
    for (let dy = -DILATION; dy <= DILATION; dy++) {
      for (let dx = -DILATION; dx <= DILATION; dx++) {
        const tLat = bLat + dy;
        const tLng = bLng + dx;
        if (tLat < COVERAGE.minLat || tLat >= COVERAGE.maxLat) continue;
        if (tLng < COVERAGE.minLng || tLng >= COVERAGE.maxLng) continue;
        wanted.add(`${tLat},${tLng}`);
      }
    }
  }
}

const tileList = [...wanted]
  .map((k) => {
    const [lat, lng] = k.split(",").map(Number);
    return { lat, lng, key: k };
  })
  .sort((a, b) => a.lat - b.lat || a.lng - b.lng);

console.log(`Corpus routes inside EMODnet Bathymetry: ${covered.length} of ${corpus.routes.length}`);
console.log(`Tiles needed at +/-${DILATION} deg corridor, ${PER_DEG}/deg (~${Math.round(111320 / PER_DEG)} m): ${tileList.length}`);
console.log(`Estimated download: ${((tileList.length * PER_DEG * PER_DEG * 4) / 1e6).toFixed(0)} MB\n`);

async function fetchTile(t) {
  const bin = join(TILES, `${t.lat}_${t.lng}.bin`);
  if (existsSync(bin)) return { ...t, cached: true };

  const url =
    `${WCS}?service=WCS&version=2.0.1&request=GetCoverage&coverageId=emodnet__mean` +
    `&format=image/tiff&subset=Lat(${t.lat},${t.lat + 1})&subset=Long(${t.lng},${t.lng + 1})` +
    `&scalesize=i(${PER_DEG}),j(${PER_DEG})`;

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 2000) throw new Error(`error body: ${buf.toString().slice(0, 160)}`);

      const img = await (
        await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
      ).getImage();

      // Never trust the georeferencing implicitly -- a silently shifted tile
      // would misattribute terrain to the wrong stretch of cable, which is
      // exactly the kind of error that produces a confident wrong finding.
      if (img.getWidth() !== PER_DEG || img.getHeight() !== PER_DEG) {
        throw new Error(`size ${img.getWidth()}x${img.getHeight()}`);
      }
      const bb = img.getBoundingBox();
      const off = Math.max(
        Math.abs(bb[0] - t.lng), Math.abs(bb[1] - t.lat),
        Math.abs(bb[2] - (t.lng + 1)), Math.abs(bb[3] - (t.lat + 1))
      );
      if (off > 1e-6) throw new Error(`bbox drift ${off.toExponential(2)}`);

      const raw = (await img.readRasters())[0];
      const out = new Int16Array(PER_DEG * PER_DEG);
      let nodata = 0, ocean = 0, deepest = 0;
      for (let i = 0; i < raw.length; i++) {
        const v = raw[i];
        if (!Number.isFinite(v)) { out[i] = NODATA; nodata++; continue; }
        const m = Math.round(v);
        // Clamp defensively: anything outside this is not a real elevation and
        // must not be allowed to alias onto the NODATA sentinel.
        out[i] = m < -11000 ? -11000 : m > 9000 ? 9000 : m;
        if (out[i] < 0) { ocean++; if (out[i] < deepest) deepest = out[i]; }
      }
      writeFileSync(bin, Buffer.from(out.buffer));
      return { ...t, cached: false, nodata, ocean, deepest };
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  return { ...t, failed: String(lastErr?.message ?? lastErr) };
}

// --- Fetch with bounded concurrency -----------------------------------------
const results = [];
let done = 0;
const started = Date.now();

async function worker(queue) {
  for (;;) {
    const t = queue.shift();
    if (!t) return;
    const r = await fetchTile(t);
    results.push(r);
    done++;
    if (done % 10 === 0 || done === tileList.length) {
      const rate = done / ((Date.now() - started) / 1000);
      const eta = Math.round((tileList.length - done) / Math.max(rate, 0.01));
      process.stdout.write(
        `\r  ${done}/${tileList.length} tiles  ${rate.toFixed(1)}/s  ETA ${Math.floor(eta / 60)}m${eta % 60}s   `
      );
    }
  }
}

const queue = tileList.slice();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
console.log("");

const failed = results.filter((r) => r.failed);
const fetched = results.filter((r) => !r.cached && !r.failed);
const cached = results.filter((r) => r.cached);

console.log(`\n  downloaded ${fetched.length}, already cached ${cached.length}, failed ${failed.length}`);
if (failed.length) {
  console.log("  FAILURES (rerun to retry -- the script resumes):");
  for (const f of failed.slice(0, 10)) console.log(`    ${f.lat},${f.lng}: ${f.failed}`);
}

if (fetched.length) {
  const totalCells = fetched.length * PER_DEG * PER_DEG;
  const noData = fetched.reduce((a, r) => a + r.nodata, 0);
  const ocean = fetched.reduce((a, r) => a + r.ocean, 0);
  const deepest = Math.min(...fetched.map((r) => r.deepest));
  console.log(`\n  of newly fetched cells: ${((100 * ocean) / totalCells).toFixed(1)}% ocean, ` +
    `${((100 * noData) / totalCells).toFixed(2)}% nodata, deepest ${deepest} m`);
}

writeFileSync(
  join(TILES, "manifest.json"),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    product: "EMODnet Bathymetry DTM (coverage emodnet__mean)",
    service: WCS,
    provenance:
      "REAL source, DERIVED grid. EMODnet Bathymetry is itself a composite of national " +
      "hydrographic survey data and gap-filled where surveys are absent; it is a measured " +
      "product, not a model, but it is not uniform-accuracy survey data everywhere. " +
      "Downsampled server-side from the native 1/16 arc-minute to the resolution below; " +
      "see validate-scaling.mjs and validate-scaling-bias.mjs for the fidelity measurements " +
      "that justify that reduction.",
    nativeCellsPerDegree: 960,
    cellsPerDegree: PER_DEG,
    approxCellMetres: Math.round(111320 / PER_DEG),
    dilationDegrees: DILATION,
    corridorLimitation:
      "Tiles cover +/-1 degree (~111 km) around route vertices. Generous for the median " +
      "171 km route, tight for the 49 routes over 1,000 km, whose plausible alternatives " +
      "may lie outside the loaded corridor.",
    encoding: { type: "Int16LE", units: "metres", convention: "elevation, negative below sea level", nodata: NODATA },
    coverage: COVERAGE,
    corpusRoutesCovered: covered.length,
    corpusRoutesTotal: corpus.routes.length,
    tileCount: tileList.length,
    tiles: tileList.map((t) => `${t.lat}_${t.lng}`),
  }, null, 2)
);
console.log(`\n  wrote manifest.json (${tileList.length} tiles)`);
