// A uniform ~1.85 km grid covering every corpus route's SEARCH CORRIDOR, so
// the prediction experiment can run past its current 500 km ceiling.
//
// WHY A COARSER GRID AT ALL. plan-longhaul-extension.mjs measured the search
// space: at 240 cells/degree the median corridor is 478k cells for a 40-500 km
// route but 37.5 MILLION for a 3,000 km one, against a 2,000,000 expansion cap.
// Long-haul is not slow at 460 m, it is impossible. At 60 cells/degree
// (~1.85 km) the same bands are 30k and 2.3M, which is tractable throughout.
//
// WHY THIS IS NOT A CLIMBDOWN. The study's own discretisation control exists
// precisely because grid resolution imposes a geometric penalty independent of
// terrain. That penalty is measured, not assumed -- so moving to a coarser grid
// is legitimate provided the penalty is RE-measured at the new resolution and
// every method is compared on the same footing. measure-discretisation-penalty
// must be re-run against this grid before any long-haul result is quoted.
// A 1.85 km cell is still well inside the corpus's ~2 km median vertex spacing.
//
// WHY ONE GRID FOR EVERY BAND. Running 40-500 km at 460 m and 500+ km at
// 1.85 km would confound length with resolution: any difference between bands
// could be the sea or could be the grid. Building every band on one grid makes
// the band comparison clean, and the overlap with the existing 240/deg results
// on 40-500 km becomes a free check on what coarsening costs.
//
// THREE PROVENANCES IN ONE GRID, RECORDED PER TILE. Cells come from:
//   emodnet-downsampled  4x4 block mean of the Phase 1 EMODnet tiles
//   noaa-downsampled     4x4 block mean of the Phase 2 NOAA mosaic tiles
//   noaa-native60        fetched from NOAA at 60/deg, never held at 240
// These are not equivalent products. EMODnet is a regional DTM; the NOAA
// mosaic is a multi-source composite of differing native accuracies. The
// manifest records which tile came from which, so results can be split by
// product rather than silently averaged across two instruments.
//
// AGGREGATION. Exact 4x4 block mean over non-nodata cells, matching the
// reduction validate-scaling.mjs established as the reference aggregation for
// this corpus. A block with no valid cell stays nodata; it is never filled.
//
// Resumable: an already-written tile is skipped. Re-run freely.
import { fromArrayBuffer } from "geotiff";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, ".cache");
const SRC_EMODNET = join(CACHE, "bathy-tiles");
const SRC_GLOBAL = join(CACHE, "bathy-tiles-global");
const OUT = join(CACHE, "bathy-tiles-lh60");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const SERVICE =
  "https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_global_mosaic/ImageServer/exportImage";

const SRC_PER_DEG = 240;
const OUT_PER_DEG = 60;
const FACTOR = SRC_PER_DEG / OUT_PER_DEG; // 4
const NODATA = -32768;
const CORRIDOR_DEG = 1.0;
const MIN_KM = 40;
const CONCURRENCY = 3;

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
/** Cap the download for a first pass; omit for the full build. */
const LIMIT = (() => {
  const i = args.indexOf("--limit");
  return i >= 0 ? Number(args[i + 1]) : Infinity;
})();

const corpus = JSON.parse(readFileSync(join(CACHE, "cable-corpus.json"), "utf-8"));

const wrapLng = (lng) => (((lng + 180) % 360) + 360) % 360 - 180;

/** Tiles A* could touch: the endpoints' bounding box dilated by the corridor.
 *  Deliberately not the tiles along the observed route -- that is the mistake
 *  that leaves holes in a long-haul search. */
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

const wanted = new Map(); // "lat,lng" -> {lat,lng}
for (const r of corpus.routes) {
  if (r.lengthKm < MIN_KM) continue;
  for (const [lat, lng] of corridorTiles(r)) {
    wanted.set(`${lat},${lng}`, { lat, lng });
  }
}

const tiles = [...wanted.values()];
console.log(`Corpus routes >= ${MIN_KM} km: ${corpus.routes.filter((r) => r.lengthKm >= MIN_KM).length}`);
console.log(`Corridor tiles wanted at ${OUT_PER_DEG}/deg: ${tiles.length.toLocaleString("en-US")}`);

// A tile is DERIVED when either 240/deg product covers it, and FETCHED only
// when neither does. EMODnet is preferred where it has real data and NOAA
// fills its holes, so both sources are carried forward rather than the tile
// being assigned to one of them up front.
const REBUILD = args.includes("--rebuild");
const plan = { derive: [], fetch: [], done: [] };
for (const t of tiles) {
  const key = `${t.lat}_${t.lng}`;
  const hasE = existsSync(join(SRC_EMODNET, `${key}.bin`));
  const hasN = existsSync(join(SRC_GLOBAL, `${key}.bin`));
  const entry = { ...t, key, hasE, hasN };
  if (existsSync(join(OUT, `${key}.bin`)) && !(REBUILD && (hasE || hasN))) {
    plan.done.push(entry);
    continue;
  }
  if (hasE || hasN) plan.derive.push(entry);
  else plan.fetch.push(entry);
}

console.log("");
console.log(`  already built:            ${plan.done.length.toLocaleString("en-US")}`);
console.log(`  derive from 240/deg:      ${plan.derive.length.toLocaleString("en-US")}` +
  `  (EMODnet ${plan.derive.filter((t) => t.hasE).length}, NOAA ${plan.derive.filter((t) => t.hasN).length})`);
console.log(`  to download from NOAA:    ${plan.fetch.length.toLocaleString("en-US")}`);
const mb = (plan.fetch.length * OUT_PER_DEG * OUT_PER_DEG * 2) / 1_000_000;
console.log(`  approx new bytes on disk: ${mb.toFixed(0)} MB`);
if (REBUILD) console.log("  --rebuild: derived tiles are recomputed from source.");

if (DRY_RUN) {
  console.log("\n--dry-run: nothing written.");
  process.exit(0);
}

/**
 * EMODNET ENCODES OUT-OF-COVERAGE AS EXACTLY ZERO, NOT AS NODATA.
 *
 * Measured over the 789 Phase 1 tiles: 4.85% of cells are exactly 0, and 36
 * tiles are 100% zero -- among them 13..15N/-59 (Barbados) and 40..41N/-38..-42
 * (mid-Atlantic), which are simply outside the DTM. NOAA's exact-zero rate is
 * 0.03%, i.e. genuine sea level.
 *
 * This matters twice over. Averaged into a block mean, those zeros fabricate a
 * shallow shelf where there is no data at all. And because BathyGrid.depth()
 * returns null for any elevation >= 0, a zero-filled cell reads as LAND -- so
 * the router treats a stretch of open Atlantic as a coastline and goes round
 * it, confidently and silently.
 *
 * So for EMODnet, exact 0 is treated as missing. The cost is real but small:
 * a genuine sea-level cell is discarded along with the fill. Since the same
 * cell is almost always available from NOAA, the fallback below recovers it.
 */
const EMODNET_ZERO_IS_NODATA = true;

/** Exact 4x4 block mean over valid cells. A block with no valid cell returns
 *  NODATA rather than being filled from neighbours -- an invented seabed value
 *  is worse than a hole the router will route around knowingly. */
function downsample(src, zeroIsNodata) {
  const out = new Int16Array(OUT_PER_DEG * OUT_PER_DEG);
  let dropped = 0;
  for (let r = 0; r < OUT_PER_DEG; r++) {
    for (let c = 0; c < OUT_PER_DEG; c++) {
      let sum = 0, n = 0;
      for (let dr = 0; dr < FACTOR; dr++) {
        for (let dc = 0; dc < FACTOR; dc++) {
          const v = src[(r * FACTOR + dr) * SRC_PER_DEG + (c * FACTOR + dc)];
          if (v === NODATA) continue;
          if (zeroIsNodata && v === 0) { dropped++; continue; }
          sum += v; n++;
        }
      }
      out[r * OUT_PER_DEG + c] = n ? Math.round(sum / n) : NODATA;
    }
  }
  return { out, dropped };
}

/** Fill NODATA cells of `primary` from `fallback`, cell by cell. Returns how
 *  many were filled, so a tile that is mostly fallback can be labelled as such
 *  instead of being passed off as the higher-quality product. */
function fillFrom(primary, fallback) {
  let filled = 0;
  for (let i = 0; i < primary.length; i++) {
    if (primary[i] === NODATA && fallback[i] !== NODATA) {
      primary[i] = fallback[i];
      filled++;
    }
  }
  return filled;
}

function readTile(dir, key) {
  const b = readFileSync(join(dir, `${key}.bin`));
  return new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

const provenance = new Map();
// A tile already on disk from an earlier run still has a real provenance, and
// it is recoverable from which source directory holds it. Recording these as
// "prebuilt" (the first version of this script did) throws away exactly the
// information the manifest exists to carry: the prediction harness stratifies
// results by product, and an unlabelled tile makes every route touching it
// "unknown". Resuming a build must not degrade the metadata.
for (const t of plan.done) {
  provenance.set(t.key, t.hasE ? "emodnet-downsampled" : t.hasN ? "noaa-downsampled" : "noaa-native60");
}

const stats = { emodnet: 0, noaaDown: 0, mixed: 0, noaaFetch: 0, failed: 0, zerosDropped: 0 };
/** Output cells still NODATA after deriving, per tile. A tile with holes and
 *  no NOAA source is queued for a native-60 fetch to fill them. */
const holes = new Map();

// --- 1. Derive from the 240/deg products ------------------------------------
// EMODnet first where it has real data (it is the higher-resolution regional
// DTM), NOAA filling anything EMODnet leaves empty -- including the zero-fill
// stripped above. A tile more than half filled from NOAA is labelled NOAA, not
// EMODnet, so the manifest does not overstate the better product's reach.
for (const t of plan.derive) {
  let out = null;
  let tag = null;

  if (t.hasE) {
    const src = readTile(SRC_EMODNET, t.key);
    if (src.length !== SRC_PER_DEG * SRC_PER_DEG) {
      console.log(`  ! ${t.key} EMODnet tile is ${src.length} cells, expected ${SRC_PER_DEG ** 2} -- ignored`);
    } else {
      const d = downsample(src, EMODNET_ZERO_IS_NODATA);
      out = d.out;
      stats.zerosDropped += d.dropped;
      tag = "emodnet-downsampled";
    }
  }

  if (t.hasN) {
    const src = readTile(SRC_GLOBAL, t.key);
    if (src.length === SRC_PER_DEG * SRC_PER_DEG) {
      const noaa = downsample(src, false).out;
      if (out) {
        const filled = fillFrom(out, noaa);
        if (filled > out.length / 2) { tag = "noaa-downsampled"; stats.noaaDown++; }
        else if (filled > 0) { tag = "mixed-emodnet-noaa"; stats.mixed++; }
        else stats.emodnet++;
      } else {
        out = noaa;
        tag = "noaa-downsampled";
        stats.noaaDown++;
      }
    }
  } else if (out) {
    stats.emodnet++;
  }

  if (!out) { stats.failed++; continue; }

  let nodata = 0;
  for (let i = 0; i < out.length; i++) if (out[i] === NODATA) nodata++;
  if (nodata > 0) holes.set(t.key, { ...t, nodata });

  writeFileSync(join(OUT, `${t.key}.bin`), Buffer.from(out.buffer));
  provenance.set(t.key, tag);
}
console.log(`  derived ${plan.derive.length.toLocaleString("en-US")} tiles ` +
  `(EMODnet ${stats.emodnet}, NOAA ${stats.noaaDown}, mixed ${stats.mixed})`);
console.log(`  EMODnet zero-fill cells discarded: ${stats.zerosDropped.toLocaleString("en-US")}`);
if (holes.size) {
  console.log(`  tiles still holding gaps after fallback: ${holes.size.toLocaleString("en-US")}` +
    ` -- queued for a NOAA native-${OUT_PER_DEG} fill`);
  for (const h of holes.values()) if (!h.hasN) plan.fetch.push({ ...h, fill: true });
}

// --- 2. Fetch what neither set has ------------------------------------------
// Same service, retry and bbox-drift checks as build-global-bathymetry.mjs.
// Georeferencing is verified rather than trusted: a silently shifted tile
// attributes terrain to the wrong stretch of ocean, which yields a confident
// wrong result instead of an error.
async function fetchTile(t) {
  const key = `${t.lat}_${t.lng}`;
  const bbox = `${t.lng},${t.lat},${t.lng + 1},${t.lat + 1}`;
  const url =
    `${SERVICE}?bbox=${bbox}&bboxSR=4326&size=${OUT_PER_DEG},${OUT_PER_DEG}&imageSR=4326` +
    `&format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image`;

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000) throw new Error(`error body: ${buf.toString().slice(0, 140)}`);

      const img = await (
        await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
      ).getImage();
      if (img.getWidth() !== OUT_PER_DEG || img.getHeight() !== OUT_PER_DEG) {
        throw new Error(`size ${img.getWidth()}x${img.getHeight()}`);
      }
      const bb = img.getBoundingBox();
      const off = Math.max(
        Math.abs(bb[0] - t.lng), Math.abs(bb[1] - t.lat),
        Math.abs(bb[2] - (t.lng + 1)), Math.abs(bb[3] - (t.lat + 1))
      );
      if (off > 1e-5) throw new Error(`bbox drift ${off.toExponential(2)}`);

      const raw = (await img.readRasters())[0];
      const out = new Int16Array(OUT_PER_DEG * OUT_PER_DEG);
      let nodata = 0, ocean = 0;
      for (let i = 0; i < raw.length; i++) {
        const v = raw[i];
        if (!Number.isFinite(v) || v < -12000 || v > 9500) { out[i] = NODATA; nodata++; continue; }
        out[i] = Math.round(v);
        if (out[i] < 0) ocean++;
      }
      // Fill mode: the tile already exists and only its gaps are wanted, so
      // the derived (higher-quality where present) cells are preserved and
      // NOAA supplies only what was missing.
      if (t.fill && existsSync(join(OUT, `${key}.bin`))) {
        const existing = readTile(OUT, key);
        if (existing.length === out.length) {
          const filled = fillFrom(existing, out);
          writeFileSync(join(OUT, `${key}.bin`), Buffer.from(existing.buffer));
          return { key, nodata, ocean, filled, mode: "fill" };
        }
      }
      writeFileSync(join(OUT, `${key}.bin`), Buffer.from(out.buffer));
      return { key, nodata, ocean, mode: "write" };
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
    }
  }
  return { key, failed: String(lastErr?.message ?? lastErr) };
}

const queue = plan.fetch.slice(0, LIMIT === Infinity ? plan.fetch.length : LIMIT);
if (queue.length) {
  console.log(`\nFetching ${queue.length.toLocaleString("en-US")} tiles from NOAA at ${OUT_PER_DEG}/deg...`);
  const total = queue.length;
  let done = 0;
  const started = Date.now();
  const failures = [];
  // One shared queue across workers. Giving each worker its own copy would
  // fetch every tile CONCURRENCY times for the same result.
  async function worker() {
    for (;;) {
      const t = queue.shift();
      if (!t) return;
      const r = await fetchTile(t);
      if (r.failed) { failures.push(r); stats.failed++; }
      else {
        // A filled tile is part derived, part NOAA -- label it as the mixture
        // it is rather than as whichever half was written last.
        provenance.set(r.key, r.mode === "fill" ? "mixed-emodnet-noaa" : "noaa-native60");
        stats.noaaFetch++;
      }
      done++;
      if (done % 25 === 0 || done === total) {
        const rate = done / ((Date.now() - started) / 1000);
        const eta = Math.round((total - done) / Math.max(rate, 0.01));
        console.log(`  ${done}/${total}  ${rate.toFixed(1)}/s  ETA ${Math.floor(eta / 60)}m${eta % 60}s`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (failures.length) {
    console.log(`  ${failures.length} failed:`);
    for (const f of failures.slice(0, 8)) console.log(`    ${f.key}: ${f.failed}`);
  }
}

// --- 3. Manifest ------------------------------------------------------------
// Per-tile provenance is the point: this grid is a composite of two different
// bathymetric products, and any result computed on it must be able to say
// which routes sat on which.
const bySource = {};
for (const v of provenance.values()) bySource[v] = (bySource[v] ?? 0) + 1;

writeFileSync(
  join(OUT, "manifest.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      purpose:
        "Uniform grid covering the A* search corridor of every corpus route >= " +
        `${MIN_KM} km, so the route-prediction experiment can run past its 500 km ceiling.`,
      cellsPerDegree: OUT_PER_DEG,
      approxCellMetres: Math.round(111320 / OUT_PER_DEG),
      corridorDegrees: CORRIDOR_DEG,
      minRouteKm: MIN_KM,
      encoding: {
        type: "Int16LE",
        units: "metres",
        convention: "elevation, negative below sea level",
        nodata: NODATA,
      },
      aggregation:
        "Exact 4x4 block mean over non-nodata cells of the 240/deg tiles, matching the reference " +
        "reduction in validate-scaling.mjs. Blocks with no valid cell remain nodata and are never filled.",
      caveat:
        "COMPOSITE OF TWO PRODUCTS. EMODnet Bathymetry DTM (regional) and the NOAA NCEI global DEM mosaic " +
        "(multi-source composite of differing native accuracies) are not equivalent instruments. Per-tile " +
        "provenance is recorded below so results can be stratified by product rather than averaged across both.",
      tileCount: provenance.size,
      bySource,
      tiles: Object.fromEntries([...provenance.entries()].sort()),
    },
    null,
    2
  )
);

console.log("");
console.log(`Built ${provenance.size.toLocaleString("en-US")} tiles at ${OUT_PER_DEG}/deg into ${OUT}`);
for (const [k, v] of Object.entries(bySource)) console.log(`  ${k.padEnd(22)} ${v.toLocaleString("en-US")}`);
if (stats.failed) console.log(`  FAILED                 ${stats.failed}`);
console.log(`Wrote ${join(OUT, "manifest.json")}`);
