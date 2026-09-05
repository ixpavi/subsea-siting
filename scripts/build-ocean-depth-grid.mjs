// Global seabed DEPTH grid in real metres, on the shipped land/water mask.
//
// WHAT THIS REPLACES. build-ocean-grid.mjs rasterises Natural Earth's
// bathymetry CONTOUR POLYGONS into 12 depth bands at 0.5 degrees. A band is a
// lower bound: a cell in the ">=3000m" band could be 3,000m or 5,999m, and the
// source cannot tell you which. Every depth figure downstream -- the difficulty
// index, the cost model, the depth profile -- inherits that. This grid stores
// the actual modelled depth instead, on the same mask and the same grid.
//
// WHY NOT THE RESEARCH CACHE. scripts/research/.cache holds bathymetry at 460 m
// and 1.85 km, which sounds like the obvious source. It is not: those tiles
// were fetched around the study's route corridors and cover 4.9% of the globe.
// A shipped grid has to answer for anywhere a user drops a pin, so this fetches
// a coarse global raster instead of stitching a corridor-shaped one.
//
// SOURCE. NOAA NCEI's DEM_global_mosaic ImageServer, the same service
// scripts/research/build-global-bathymetry.mjs uses -- a MULTI-SOURCE
// COMPOSITE (GEBCO plus higher-resolution regional surveys where they exist),
// not a single uniform-accuracy product, and labelled as such rather than as
// "GEBCO". Requested as four full-width strips because one global request is a
// single point of failure and four are individually resumable.
//
// STORAGE, AND WHAT IT COSTS. Int16 positive metres below sea level, 0 = land,
// written as a raw binary sidecar. Measured over the wire:
//
//   before  ocean-grid.json   509 KB raw   35 KB gzipped
//   after   ocean-depth.bin   506 KB raw  286 KB gzipped
//
// So this is +252 KB gzipped, NOT a saving -- the raw sizes are nearly equal
// and it is tempting to stop there, but they compress nothing alike. The band
// grid was a JSON array of 259,200 integers drawn from an alphabet of 13, which
// gzip flattens almost to nothing. Real depths are high-entropy and do not
// compress. That is the actual price of the change, and it is paid only by
// users who route: the grid is fetched lazily inside the routing worker on the
// first route request, several clicks into the planning wizard.
//
// LAND SENTINEL. 0 means land, exactly as the band grid's 0 did. The mask, not
// the elevation model, decides which cells those are.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { fromArrayBuffer } from "geotiff";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "data");
const CACHE = join(__dirname, ".cache-depth-strips");

const SERVICE =
  "https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_global_mosaic/ImageServer/exportImage";

// Matches the Natural Earth mask exactly -- see the mask section below.
const RES = Number(process.env.GRID_RES ?? 0.5);
const COLS = Math.round(360 / RES); // 1440
const ROWS = Math.round(180 / RES); // 720
const STRIP_DEG = 45; // four strips, each 1440 x 180
const STRIPS = [];
for (let lat = -90; lat < 90; lat += STRIP_DEG) STRIPS.push({ minLat: lat, maxLat: lat + STRIP_DEG });

if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });

async function fetchStrip(s) {
  const cached = join(CACHE, `strip_${s.minLat}_${RES}.tif`);
  if (existsSync(cached)) return { buf: readFileSync(cached), cached: true };

  const rows = Math.round((s.maxLat - s.minLat) / RES);
  const url =
    `${SERVICE}?bbox=-180,${s.minLat},180,${s.maxLat}&bboxSR=4326` +
    `&size=${COLS},${rows}&imageSR=4326&format=tiff&pixelType=F32` +
    `&interpolation=RSP_BilinearInterpolation&f=image`;

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      // An ArcGIS error comes back as a short JSON body with a 200 status, so
      // size is the cheapest way to tell a failure from a raster.
      if (buf.length < 10_000) throw new Error(`error body: ${buf.toString().slice(0, 160)}`);
      writeFileSync(cached, buf);
      return { buf, cached: false };
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw new Error(`strip ${s.minLat}..${s.maxLat} failed: ${lastErr?.message}`);
}

console.log(`Building ${COLS}x${ROWS} global depth grid at ${RES} deg\n`);

const depth = new Int16Array(COLS * ROWS);

for (const s of STRIPS) {
  const { buf, cached } = await fetchStrip(s);
  const tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  const img = await tiff.getImage();
  const [raster] = await img.readRasters();
  const w = img.getWidth();
  const h = img.getHeight();
  if (w !== COLS) throw new Error(`strip width ${w} != ${COLS}`);

  // GeoTIFF rows run NORTH to SOUTH (row 0 = maxLat). The shipped grid's row 0
  // is the SOUTHERNMOST band, matching rowForLat()'s (lat + 90) convention, so
  // each strip is flipped as it is written.
  let land = 0;
  for (let y = 0; y < h; y++) {
    const latOfRow = s.maxLat - (y + 0.5) * RES;
    const gridRow = Math.floor((latOfRow + 90) / RES);
    if (gridRow < 0 || gridRow >= ROWS) continue;
    for (let x = 0; x < w; x++) {
      const v = raster[y * w + x];
      let d = 0;
      if (Number.isFinite(v) && v < 0) d = Math.min(32767, Math.round(-v));
      else land++;
      depth[gridRow * COLS + x] = d;
    }
  }
  console.log(
    `  ${String(s.minLat).padStart(4)}..${String(s.maxLat).padStart(3)}  ${w}x${h}` +
      `  land ${((100 * land) / (w * h)).toFixed(1)}%${cached ? "  (cached)" : ""}`,
  );
}

// --- the land/water mask stays Natural Earth's ------------------------------
// MEASURED, NOT ASSUMED. Substituting NOAA's land/water decision for Natural
// Earth's was tried first. Scored the way the shipped connectivity test scores
// it -- 8-connected, the router's own neighbourhood -- on landing points that
// cannot reach the main ocean:
//
//   Natural Earth bands, 0.5 deg     4 / 1920   (the number to match)
//   pure NOAA,          0.25 deg    78 / 1920   no must-connect failures
//   pure NOAA,           0.5 deg   138 / 1920   Bab-el-Mandeb seals
//   this hybrid,         0.5 deg     4 / 1920   identical, by construction
//
// Resolution is not the lever: 0.25 deg halves the damage and still strands
// 78. Natural Earth's coastline is a CARTOGRAPHIC generalisation, drawn to keep
// real channels navigable because a map that closes the Red Sea is a bad map.
// NOAA's mosaic is a PHYSICAL elevation model, and a cell spanning
// Bab-el-Mandeb genuinely averages above sea level. One source is drawn to
// preserve navigability and the other is measured without regard to it.
//
// So each source is used for what it is good at: Natural Earth decides WHERE
// the water is, NOAA decides HOW DEEP it is. Connectivity is then identical to
// the shipped grid by construction -- same mask, same strait corrections, same
// tests -- and the only thing that changes is that a band index becomes a
// depth in metres, which was the actual limitation.
const prev = JSON.parse(readFileSync(join(OUT_DIR, "ocean-grid.json"), "utf-8"));
if (prev.resolutionDeg !== RES) {
  throw new Error(
    `mask is ${prev.resolutionDeg} deg but this build is ${RES} deg. The mask defines ` +
      `connectivity, so the depth grid must match it exactly.`,
  );
}
const mask = Uint8Array.from(prev.data);
const bandMinDepth = new Map(prev.depthBands.map((b) => [b.index, b.minDepthM]));

let carved = 0;
let filled = 0;
for (let i = 0; i < depth.length; i++) {
  const band = mask[i];
  if (band === 0) {
    // Natural Earth says land. NOAA's opinion does not get a vote, or the
    // mask's proven connectivity would leak away one cell at a time.
    if (depth[i] !== 0) carved++;
    depth[i] = 0;
  } else if (depth[i] === 0) {
    // Water per the mask, at or above sea level per NOAA -- a coastal or
    // strait-corrected cell. Fall back to the band's lower bound, which is
    // exactly what the app reported here before.
    depth[i] = Math.max(1, Math.round(bandMinDepth.get(band) ?? 0));
    filled++;
  }
}
console.log(`\n  mask: Natural Earth, ${RES} deg (connectivity preserved by construction)`);
console.log(`    NOAA-water cells rejected as land by the mask: ${carved.toLocaleString()}`);
console.log(`    mask-water cells with no NOAA depth, band-filled: ${filled.toLocaleString()}`);
const STRAITS = prev.straitCorrections;

// --- report -----------------------------------------------------------------
let sea = 0;
let deepest = 0;
for (let i = 0; i < depth.length; i++) {
  if (depth[i] > 0) {
    sea++;
    if (depth[i] > deepest) deepest = depth[i];
  }
}
const bin = Buffer.from(depth.buffer);
writeFileSync(join(OUT_DIR, process.env.GRID_OUT ?? "ocean-depth.bin"), bin);

const meta = {
  resolutionDeg: RES,
  rows: ROWS,
  cols: COLS,
  units: "metres below sea level, Int16 little-endian, row-major",
  landValue: 0,
  binary: process.env.GRID_OUT ?? "ocean-depth.bin",
  provenance:
    `Global seabed depth from NOAA NCEI's DEM_global_mosaic (a multi-source composite of GEBCO ` +
    `plus higher-resolution regional surveys, NOT a single uniform-accuracy product), resampled ` +
    `to a ${RES} degree grid by bilinear interpolation at build time. Values are modelled depths ` +
    `in metres, not point soundings, and a ${RES} degree cell is about 56 km across -- so a value ` +
    `is the interpolated depth of a 56 km square, not of any surveyed position within it. ` +
    `WHICH cells are water is decided by the Natural Earth land/water mask shipped in ` +
    `ocean-grid.json, not by this elevation model: that mask is a cartographic generalisation ` +
    `that keeps real channels navigable, and substituting the elevation model's own land/water ` +
    `decision was measured to seal Bab-el-Mandeb and strand 109 landing points. Depth is ` +
    `therefore NOAA's and geography is Natural Earth's. Where the mask says water but the ` +
    `elevation model is at or above sea level -- coastal cells and the named strait corrections ` +
    `-- the contour band's lower bound is used, which is exactly what was reported there before. ` +
    `Artificial canals (Suez, Panama) are deliberately NOT opened.`,
  source: {
    name: "NOAA NCEI DEM global mosaic",
    url: SERVICE,
    note: "Multi-source composite; label as NOAA NCEI, not as GEBCO.",
  },
  depthBands: prev.depthBands,
  straitCorrections: STRAITS,
  generatedAt: new Date().toISOString(),
};
writeFileSync(join(OUT_DIR, (process.env.GRID_OUT ?? "ocean-depth.bin").replace(".bin",".json")), JSON.stringify(meta, null, 2));

console.log(`\n  ocean cells: ${sea.toLocaleString()} of ${depth.length.toLocaleString()} (${((100 * sea) / depth.length).toFixed(1)}%)`);
console.log(`  deepest:     ${deepest.toLocaleString()} m`);
console.log(`\n  ocean-depth.bin   ${(bin.length / 1048576).toFixed(2)} MB raw`);
console.log(`  ocean-depth.json  metadata + ${STRAITS.length} strait corrections`);
