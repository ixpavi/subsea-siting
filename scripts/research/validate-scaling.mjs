// Checks whether EMODnet's server-side downsampling is safe to rely on.
//
// THE RISK. The tile downloader wants ~460 m cells, but the source is 115 m.
// Asking the WCS for a 240x240 tile makes the SERVER do that 4:1 reduction, by
// an interpolation method we do not control and cannot cite. If that reduction
// is a point sample rather than an average, it aliases: a narrow canyon or a
// steep escarpment can vanish between samples. Those are precisely the features
// a cable route bends around, so an aliased grid would quietly destroy the
// signal this study is trying to recover -- and would do it invisibly, because
// the resulting grid still looks like plausible bathymetry.
//
// THE TEST. For a sample of tiles spanning shelf, margin and deep basin, fetch
// BOTH the native 960x960 and the server-scaled 240x240. Reduce the native tile
// ourselves by exact 4x4 block mean -- the aggregation we would choose if we
// controlled it -- and compare. Report the error where it matters: overall, and
// separately on the steepest cells, since that is where aliasing shows up.
import { fromArrayBuffer } from "geotiff";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, ".cache", "scaling-check");
if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });

const WCS = "https://ows.emodnet-bathymetry.eu/wcs";
const NATIVE = 960;
const SCALED = 240;
const FACTOR = NATIVE / SCALED;

/** Tiles chosen to span terrain types, not to flatter the result: shelf,
 *  steep continental margin, trench, island slope, deep basin. */
const SAMPLE = [
  { lat: 51, lng: 2, what: "southern North Sea shelf" },
  { lat: 49, lng: -5, what: "Celtic shelf edge" },
  { lat: 43, lng: 7, what: "Ligurian margin (steep)" },
  { lat: 36, lng: -6, what: "Gulf of Cadiz / Gibraltar" },
  { lat: 60, lng: 4, what: "Norwegian Trench" },
  { lat: 38, lng: 15, what: "Tyrrhenian deep + seamounts" },
  { lat: 41, lng: 2, what: "Catalan margin" },
  { lat: 17, lng: -62, what: "Lesser Antilles island slope" },
];

async function grab(lat, lng, size) {
  const file = join(CACHE, `${lat}_${lng}_${size}.tif`);
  if (!existsSync(file)) {
    const scale = size === NATIVE ? "" : `&scalesize=i(${size}),j(${size})`;
    const url =
      `${WCS}?service=WCS&version=2.0.1&request=GetCoverage&coverageId=emodnet__mean` +
      `&format=image/tiff&subset=Lat(${lat},${lat + 1})&subset=Long(${lng},${lng + 1})${scale}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${lat},${lng}@${size}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2000) throw new Error(`error body for ${lat},${lng}@${size}: ${buf.toString().slice(0, 200)}`);
    writeFileSync(file, buf);
  }
  const bytes = readFileSync(file);
  const img = await (
    await fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  ).getImage();
  if (img.getWidth() !== size) throw new Error(`expected ${size}, got ${img.getWidth()}`);
  return (await img.readRasters())[0];
}

console.log("Comparing server-scaled 240x240 against locally block-averaged native 960x960.\n");
console.log(
  "  " + "tile".padEnd(30) + "depth range m".padStart(16) +
  "RMS m".padStart(9) + "p99 m".padStart(9) + "RMS steep".padStart(11) + "max m".padStart(9)
);

const allErr = [];
const allSteepErr = [];

for (const s of SAMPLE) {
  const [nat, scl] = await Promise.all([grab(s.lat, s.lng, NATIVE), grab(s.lat, s.lng, SCALED)]);

  const mine = new Float64Array(SCALED * SCALED);
  const slope = new Float64Array(SCALED * SCALED);
  for (let y = 0; y < SCALED; y++) {
    for (let x = 0; x < SCALED; x++) {
      let sum = 0, lo = Infinity, hi = -Infinity;
      for (let dy = 0; dy < FACTOR; dy++) {
        for (let dx = 0; dx < FACTOR; dx++) {
          const v = nat[(y * FACTOR + dy) * NATIVE + (x * FACTOR + dx)];
          sum += v;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      mine[y * SCALED + x] = sum / (FACTOR * FACTOR);
      // Relief inside the block: how much detail the reduction had to discard.
      slope[y * SCALED + x] = hi - lo;
    }
  }

  const errs = [];
  const steepErrs = [];
  // "Steep" = top decile of within-block relief, computed per tile so the
  // threshold adapts to terrain rather than being an invented constant.
  const reliefSorted = Array.from(slope).sort((a, b) => a - b);
  const steepCut = reliefSorted[Math.floor(reliefSorted.length * 0.9)];

  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < mine.length; i++) {
    const e = Math.abs(scl[i] - mine[i]);
    errs.push(e);
    if (slope[i] >= steepCut) steepErrs.push(e);
    if (mine[i] < mn) mn = mine[i];
    if (mine[i] > mx) mx = mine[i];
  }
  allErr.push(...errs);
  allSteepErr.push(...steepErrs);

  const rms = (a) => Math.sqrt(a.reduce((s, e) => s + e * e, 0) / a.length);
  const sorted = errs.slice().sort((a, b) => a - b);
  console.log(
    "  " + s.what.padEnd(30) +
      `${mn.toFixed(0)}..${mx.toFixed(0)}`.padStart(16) +
      rms(errs).toFixed(2).padStart(9) +
      sorted[Math.floor(sorted.length * 0.99)].toFixed(2).padStart(9) +
      rms(steepErrs).toFixed(2).padStart(11) +
      sorted[sorted.length - 1].toFixed(2).padStart(9)
  );
}

const rmsAll = Math.sqrt(allErr.reduce((s, e) => s + e * e, 0) / allErr.length);
const rmsSteep = Math.sqrt(allSteepErr.reduce((s, e) => s + e * e, 0) / allSteepErr.length);
console.log(`\n  overall RMS ${rmsAll.toFixed(2)} m over ${allErr.length.toLocaleString()} cells`);
console.log(`  steepest-decile RMS ${rmsSteep.toFixed(2)} m`);
console.log(
  "\n  VERDICT GUIDE: server scaling is acceptable if the steep-cell RMS is\n" +
    "  small against the depth variation the cost model must resolve. If it is\n" +
    "  not, fetch native and reduce locally -- 8x the bytes, but our aggregation."
);
