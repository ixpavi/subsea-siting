// Builds public/data/maritime-activity.{json,bin}: how busy the sea is with
// fishing and with cargo and tanker traffic, on a 0.25 degree grid, for the
// routing engine's fault-exposure criterion.
//
// WHY THESE TWO. Fishing gear and ships' anchors cause most submarine cable
// faults (Carter et al., 2009), most of them in water shallower than 200 m.
// Seabed depth, which the router already scores, is not where cables actually
// break. Fishing effort is measured directly.
// Anchoring is not published as a layer anywhere, so cargo and tanker traffic
// density stands in for it: those are the ships whose anchors snag cables, and
// they gather where they anchor -- port approaches and anchorages. It is a
// proxy and is labelled as one.
//
// SOURCE. EMODnet Human Activities vessel density (Cogea, from AIS), annual
// average for 2024, in hours per square kilometre per month:
//   emodnet__vesseldensity_01avg  fishing
//   emodnet__vesseldensity_09avg  cargo
//   emodnet__vesseldensity_10avg  tanker
// EMODnet data are published under CC BY 4.0.
//
// COVERAGE IS EUROPEAN, AND IS RECORDED. The service's envelope is roughly
// 15-79N, 88W-98E, and within it real data exist mainly around Europe. A cell
// with no data is stored as NO DATA, never as quiet water: "nobody fishes here"
// and "nobody measured here" must not become the same answer. Callers report
// the criterion unavailable for a route that leaves the covered area.
//
// Run: node scripts/build-maritime-activity.mjs   (resumable; blocks cached)
import { fromArrayBuffer } from "geotiff";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public", "data");
const CACHE = join(__dirname, ".cache", "maritime");
if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });

const WCS = "https://ows.emodnet-humanactivities.eu/wcs";
const YEAR = "2024";
const LAYERS = {
  fishing: ["emodnet__vesseldensity_01avg"],
  shipping: ["emodnet__vesseldensity_09avg", "emodnet__vesseldensity_10avg"],
};

/** Output grid. 0.25 degrees (~28 km north-south) is finer than the 0.5 degree
 *  routing grid and coarse enough to ship: two bytes per cell. */
const RES = 0.25;
const EXTENT = { minLat: 15, maxLat: 79, minLng: -88, maxLng: 98 };
const ROWS = Math.round((EXTENT.maxLat - EXTENT.minLat) / RES);
const COLS = Math.round((EXTENT.maxLng - EXTENT.minLng) / RES);
const BLOCK = 10;
/** Pixels requested per block edge. The service pads a subset outward to whole
 *  source cells, so a 10 degree block comes back ~11.3 degrees wide; 520 pixels
 *  across that is ~46 per degree, finer than the ~2.7 km native cell, so the
 *  averaging below sees every source value once. */
const PIXELS = 520;
const CONCURRENCY = 3;

const blocks = [];
for (let lat = EXTENT.minLat; lat < EXTENT.maxLat; lat += BLOCK) {
  for (let lng = EXTENT.minLng; lng < EXTENT.maxLng; lng += BLOCK) {
    blocks.push({ lat, lng, lat2: Math.min(lat + BLOCK, EXTENT.maxLat), lng2: Math.min(lng + BLOCK, EXTENT.maxLng) });
  }
}

/** Per-cell sum and count of valid pixels for one coverage, from one block. */
async function fetchBlock(coverage, b) {
  const cachePath = join(CACHE, `${coverage}_${YEAR}_${b.lat}_${b.lng}.json`);
  if (existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, "utf-8"));

  const enc = encodeURIComponent;
  const url =
    `${WCS}?service=WCS&version=2.0.1&request=GetCoverage&coverageId=${coverage}&format=image/tiff` +
    `&subsettingCrs=${enc("http://www.opengis.net/def/crs/EPSG/0/4326")}` +
    `&subset=${enc(`Lat(${b.lat},${b.lat2})`)}&subset=${enc(`Long(${b.lng},${b.lng2})`)}` +
    `&subset=${enc(`time("${YEAR}-01-01T00:00:00.000Z")`)}` +
    `&outputCrs=${enc("http://www.opengis.net/def/crs/EPSG/0/4326")}` +
    `&scalesize=${enc(`i(${PIXELS}),j(${PIXELS})`)}`;

  let result = null;
  for (let attempt = 0; attempt < 3 && !result; attempt++) {
    try {
      const res = await fetch(url);
      // The service answers 500 where no granule exists: a definitive "no data
      // here", not a transient fault.
      if (res.status === 500) {
        result = { cells: {} };
        break;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf[0] !== 0x49 && buf[0] !== 0x4d) throw new Error("not a TIFF");
      const img = await (await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))).getImage();
      const W = img.getWidth();
      const H = img.getHeight();
      const [minLng, minLat, maxLng, maxLat] = img.getBoundingBox();
      const nodata = img.getGDALNoData();
      const raster = (await img.readRasters())[0];
      const cells = {};
      for (let y = 0; y < H; y++) {
        // The returned box is padded; its georeference is the authority. Only
        // pixels centred inside the REQUESTED block count, so padding shared
        // with a neighbouring block is never counted twice.
        const lat = maxLat - ((y + 0.5) * (maxLat - minLat)) / H;
        if (lat < b.lat || lat >= b.lat2) continue;
        const row = Math.floor((lat - EXTENT.minLat) / RES);
        for (let x = 0; x < W; x++) {
          const lng = minLng + ((x + 0.5) * (maxLng - minLng)) / W;
          if (lng < b.lng || lng >= b.lng2) continue;
          const v = raster[y * W + x];
          if (!Number.isFinite(v) || v === nodata || v < 0) continue;
          const col = Math.floor((lng - EXTENT.minLng) / RES);
          const key = row * COLS + col;
          const c = cells[key] ?? (cells[key] = [0, 0]);
          c[0] += v;
          c[1] += 1;
        }
      }
      result = { cells };
    } catch (err) {
      if (attempt === 2) throw new Error(`${coverage} ${b.lat},${b.lng}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  writeFileSync(cachePath, JSON.stringify(result));
  return result;
}

/** Mean value per cell for a layer (summed over its coverages), NaN = no data. */
async function buildLayer(name, coverages) {
  const sum = new Float64Array(ROWS * COLS);
  const count = new Uint32Array(ROWS * COLS);
  for (const coverage of coverages) {
    // Per coverage, not pooled: cargo and tanker densities ADD (both are ships
    // in the same water), so each is averaged over its own pixels first.
    const cSum = new Float64Array(ROWS * COLS);
    const cCount = new Uint32Array(ROWS * COLS);
    let done = 0;
    let next = 0;
    const work = async () => {
      while (next < blocks.length) {
        const b = blocks[next++];
        const { cells } = await fetchBlock(coverage, b);
        for (const [k, [s, n]] of Object.entries(cells)) {
          cSum[k] += s;
          cCount[k] += n;
        }
        if (++done % 20 === 0) console.log(`  ${coverage}: ${done}/${blocks.length} blocks`);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, work));
    for (let i = 0; i < sum.length; i++) {
      if (cCount[i] === 0) continue;
      sum[i] += cSum[i] / cCount[i];
      count[i] += 1;
    }
  }
  const mean = new Float64Array(ROWS * COLS).fill(NaN);
  // A cell counts as covered only when EVERY coverage of the layer has data
  // there: cargo without tanker would understate the traffic.
  for (let i = 0; i < mean.length; i++) if (count[i] === coverages.length) mean[i] = sum[i];
  const covered = mean.filter((v) => !Number.isNaN(v)).length;
  console.log(`${name}: ${covered.toLocaleString("en-US")} covered cells`);
  return mean;
}

/** Threshold at a quantile of the covered cells' values. */
function quantile(values, q) {
  const v = values.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.floor(q * v.length))];
}

/**
 * Classes: 0 no data, 1 low, 2 busy, 3 very busy. The cut-offs are the 75th and
 * 90th percentiles of covered sea cells -- relative to European waters, and
 * stated in the metadata, because no published threshold says how much fishing
 * or traffic "endangers" a cable.
 */
function classify(mean) {
  const busy = quantile(mean, 0.75);
  const veryBusy = quantile(mean, 0.9);
  const out = new Uint8Array(mean.length);
  for (let i = 0; i < mean.length; i++) {
    const v = mean[i];
    out[i] = Number.isNaN(v) ? 0 : v >= veryBusy ? 3 : v >= busy ? 2 : 1;
  }
  return { classes: out, busy, veryBusy };
}

const fishing = classify(await buildLayer("fishing", LAYERS.fishing));
const shipping = classify(await buildLayer("shipping", LAYERS.shipping));

const bin = new Uint8Array(ROWS * COLS * 2);
bin.set(fishing.classes, 0);
bin.set(shipping.classes, ROWS * COLS);
writeFileSync(join(OUT, "maritime-activity.bin"), bin);

const round = (x) => Math.round(x * 1000) / 1000;
writeFileSync(
  join(OUT, "maritime-activity.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      binary: "maritime-activity.bin",
      resolutionDeg: RES,
      rows: ROWS,
      cols: COLS,
      extent: EXTENT,
      layers: ["fishing", "shipping"],
      classes: { 0: "no data", 1: "low", 2: "busy", 3: "very busy" },
      thresholdsHoursPerKm2PerMonth: {
        fishing: { busy: round(fishing.busy), veryBusy: round(fishing.veryBusy) },
        shipping: { busy: round(shipping.busy), veryBusy: round(shipping.veryBusy) },
      },
      source: {
        name: "EMODnet Human Activities, vessel density annual averages (Cogea, AIS)",
        url: "https://emodnet.ec.europa.eu/en/human-activities",
        year: Number(YEAR),
        coverages: LAYERS,
        licence: "CC BY 4.0",
      },
      provenance:
        "Fishing-vessel density, and cargo plus tanker density as a proxy for anchoring, from EMODnet Human " +
        `Activities (AIS, ${YEAR} annual average), averaged into 0.25 degree cells. "Busy" and "very busy" are the ` +
        "75th and 90th percentiles of covered sea cells. European waters only: a cell with no data is stored as no " +
        "data, never as quiet water.",
    },
    null,
    1
  )
);
console.log("maritime-activity.{json,bin} written");
