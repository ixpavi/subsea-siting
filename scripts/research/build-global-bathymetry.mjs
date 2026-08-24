// Phase 2 bathymetry: the corpus routes EMODnet cannot serve.
//
// EMODnet Bathymetry covers lat 11..90, lng -70.5..43. That leaves 56 corpus
// routes outside it entirely -- French overseas territories in the Pacific,
// Indian Ocean and Caribbean, which are also the deepest and longest routes in
// the corpus. Excluding them is why the study is 75% European by length, which
// is the first thing a reviewer attacks on generalisation.
//
// SOURCE. NOAA NCEI's global DEM mosaic, served as an ArcGIS ImageServer that
// exports float32 GeoTIFF for an arbitrary bbox and size. It is a MULTI-SOURCE
// COMPOSITE -- GEBCO plus higher-resolution regional surveys where they exist
// -- not a single uniform-accuracy product, and it is labelled that way rather
// than as "GEBCO".
//
// WHY NOT THE GEBCO NETCDF DIRECTLY. The full global grid is a single multi-GB
// NetCDF download, and this needs a few hundred one-degree squares. Requesting
// exactly the tiles the corpus touches is the same targeted approach used for
// EMODnet, for the same reason: the download becomes a decision with a number
// behind it instead of a blind bulk fetch.
//
// GRID COMPATIBILITY. Tiles are requested at 240x240 per degree, identical to
// the EMODnet tiles, so BathyGrid reads either without knowing the difference
// and the two phases are directly comparable.
import { fromArrayBuffer } from "geotiff";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(__dirname, ".cache", "cable-corpus.json");
const TILES = join(__dirname, ".cache", "bathy-tiles-global");
if (!existsSync(TILES)) mkdirSync(TILES, { recursive: true });

const SERVICE =
  "https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_global_mosaic/ImageServer/exportImage";
const EMODNET = { minLat: 11, maxLat: 90, minLng: -70.5, maxLng: 43 };
const PER_DEG = 240;
const DILATION = 1;
const CONCURRENCY = 3;
const NODATA = -32768;

const corpus = JSON.parse(readFileSync(CORPUS, "utf-8"));

const insideEmodnet = (r) =>
  r.coordinates.every(
    ([lng, lat]) =>
      lat >= EMODNET.minLat && lat <= EMODNET.maxLat &&
      lng >= EMODNET.minLng && lng <= EMODNET.maxLng
  );

const outside = corpus.routes.filter((r) => !insideEmodnet(r));
const km = Math.round(outside.reduce((a, r) => a + r.lengthKm, 0));
console.log(`Routes outside EMODnet coverage: ${outside.length} (${km.toLocaleString()} km)`);

const bySource = new Map();
for (const r of outside) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
for (const [s, n] of bySource) console.log(`  ${s.padEnd(22)} ${n}`);

// --- Tiles needed ----------------------------------------------------------
const wanted = new Set();
for (const r of outside) {
  for (const [lng, lat] of r.coordinates) {
    const bLat = Math.floor(lat);
    const bLng = Math.floor(lng);
    for (let dy = -DILATION; dy <= DILATION; dy++) {
      for (let dx = -DILATION; dx <= DILATION; dx++) {
        const tLat = bLat + dy;
        const tLng = bLng + dx;
        if (tLat < -90 || tLat >= 90) continue;
        // Longitude wraps; keep tile keys in -180..179.
        const wrapped = ((tLng + 180) % 360 + 360) % 360 - 180;
        wanted.add(`${tLat},${wrapped}`);
      }
    }
  }
}
const tiles = [...wanted]
  .map((k) => {
    const [lat, lng] = k.split(",").map(Number);
    return { lat, lng };
  })
  .sort((a, b) => a.lat - b.lat || a.lng - b.lng);

console.log(`\nTiles needed at +/-${DILATION} deg, ${PER_DEG}/deg: ${tiles.length}`);
console.log(`Estimated download: ${((tiles.length * PER_DEG * PER_DEG * 4) / 1e6).toFixed(0)} MB\n`);

async function fetchTile(t) {
  const bin = join(TILES, `${t.lat}_${t.lng}.bin`);
  if (existsSync(bin)) return { ...t, cached: true };

  const bbox = `${t.lng},${t.lat},${t.lng + 1},${t.lat + 1}`;
  const url =
    `${SERVICE}?bbox=${bbox}&bboxSR=4326&size=${PER_DEG},${PER_DEG}&imageSR=4326` +
    `&format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image`;

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 3000) throw new Error(`error body: ${buf.toString().slice(0, 140)}`);

      const img = await (
        await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
      ).getImage();
      if (img.getWidth() !== PER_DEG || img.getHeight() !== PER_DEG) {
        throw new Error(`size ${img.getWidth()}x${img.getHeight()}`);
      }
      // Never trust georeferencing implicitly: a silently shifted tile
      // attributes terrain to the wrong stretch of cable, which produces a
      // confident wrong finding rather than an error.
      const bb = img.getBoundingBox();
      const off = Math.max(
        Math.abs(bb[0] - t.lng), Math.abs(bb[1] - t.lat),
        Math.abs(bb[2] - (t.lng + 1)), Math.abs(bb[3] - (t.lat + 1))
      );
      if (off > 1e-5) throw new Error(`bbox drift ${off.toExponential(2)}`);

      const raw = (await img.readRasters())[0];
      const out = new Int16Array(PER_DEG * PER_DEG);
      let nodata = 0, ocean = 0, deepest = 0;
      for (let i = 0; i < raw.length; i++) {
        const v = raw[i];
        if (!Number.isFinite(v) || v < -12000 || v > 9500) { out[i] = NODATA; nodata++; continue; }
        out[i] = Math.round(v);
        if (out[i] < 0) { ocean++; if (out[i] < deepest) deepest = out[i]; }
      }
      writeFileSync(bin, Buffer.from(out.buffer));
      return { ...t, cached: false, nodata, ocean, deepest };
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
    }
  }
  return { ...t, failed: String(lastErr?.message ?? lastErr) };
}

const results = [];
let done = 0;
const started = Date.now();
async function worker(queue) {
  for (;;) {
    const t = queue.shift();
    if (!t) return;
    results.push(await fetchTile(t));
    done++;
    if (done % 10 === 0 || done === tiles.length) {
      const rate = done / ((Date.now() - started) / 1000);
      const eta = Math.round((tiles.length - done) / Math.max(rate, 0.01));
      console.log(`  ${done}/${tiles.length}  ${rate.toFixed(1)}/s  ETA ${Math.floor(eta / 60)}m${eta % 60}s`);
    }
  }
}
// ONE shared queue. Passing tiles.slice() here gave each worker its own full
// copy, so every worker fetched every tile -- three times the requests for the
// same result. The counter running past the total is what exposed it.
const queue = tiles.slice();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));

const failed = results.filter((r) => r.failed);
const fetched = results.filter((r) => !r.cached && !r.failed);
console.log(`\n  downloaded ${fetched.length}, cached ${results.filter((r) => r.cached).length}, failed ${failed.length}`);
for (const f of failed.slice(0, 8)) console.log(`    ${f.lat},${f.lng}: ${f.failed}`);

if (fetched.length) {
  const cells = fetched.length * PER_DEG * PER_DEG;
  const ocean = fetched.reduce((a, r) => a + r.ocean, 0);
  const nd = fetched.reduce((a, r) => a + r.nodata, 0);
  console.log(`  of new cells: ${((100 * ocean) / cells).toFixed(1)}% ocean, ` +
    `${((100 * nd) / cells).toFixed(2)}% nodata, deepest ${Math.min(...fetched.map((r) => r.deepest))} m`);
}

writeFileSync(join(TILES, "manifest.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  product: "NOAA NCEI global DEM mosaic (multi-source composite: GEBCO plus higher-resolution regional surveys where available)",
  service: SERVICE,
  provenance:
    "REAL source, DERIVED grid. A composite of many bathymetric surveys at differing native resolutions, " +
    "resampled by the service to the requested grid. NOT uniform-accuracy everywhere, and NOT a single " +
    "named product -- it must not be cited as 'GEBCO' without qualification.",
  cellsPerDegree: PER_DEG,
  approxCellMetres: Math.round(111320 / PER_DEG),
  dilationDegrees: DILATION,
  encoding: { type: "Int16LE", units: "metres", convention: "elevation, negative below sea level", nodata: NODATA },
  purpose: "Corpus routes outside EMODnet Bathymetry's envelope; removes the Europe-only limitation.",
  routesCovered: outside.length,
  routeKm: km,
  tileCount: tiles.length,
  tiles: tiles.map((t) => `${t.lat}_${t.lng}`),
}, null, 2));
console.log(`\n  wrote manifest.json (${tiles.length} tiles)`);
