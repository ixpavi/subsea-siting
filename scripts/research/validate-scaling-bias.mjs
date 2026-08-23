// Follow-up to validate-scaling.mjs, which measured only ABSOLUTE error.
//
// Absolute error is the wrong statistic on its own. Unbiased noise around the
// true block mean averages out along a route and costs the study almost
// nothing. A systematic offset does not: if the server's reduction is a point
// sample that consistently favours, say, the block's shallowest corner, every
// steep cell in the grid is biased in the same direction, and a cost model
// fitted on it learns a distorted relationship between depth and route choice.
// Same RMS, completely different consequence.
//
// So: is the error centred on zero? And is the server averaging at all, or
// picking one of the 16 native cells?
import { fromArrayBuffer } from "geotiff";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, ".cache", "scaling-check");
const NATIVE = 960, SCALED = 240, FACTOR = 4;

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

async function load(lat, lng, size) {
  const b = readFileSync(join(CACHE, `${lat}_${lng}_${size}.tif`));
  const img = await (await fromArrayBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))).getImage();
  return (await img.readRasters())[0];
}

console.log("Is the reduction error biased, and is the server averaging?\n");
console.log(
  "  " + "tile".padEnd(30) + "mean err m".padStart(12) + "median err".padStart(12) +
  "% == a native cell".padStart(20) + "% in block range".padStart(18)
);

let gSum = 0, gN = 0, gExact = 0, gInRange = 0;

for (const s of SAMPLE) {
  const nat = await load(s.lat, s.lng, NATIVE);
  const scl = await load(s.lat, s.lng, SCALED);
  const signed = [];
  let exact = 0, inRange = 0;

  for (let y = 0; y < SCALED; y++) {
    for (let x = 0; x < SCALED; x++) {
      const block = [];
      for (let dy = 0; dy < FACTOR; dy++)
        for (let dx = 0; dx < FACTOR; dx++)
          block.push(nat[(y * FACTOR + dy) * NATIVE + (x * FACTOR + dx)]);

      const mean = block.reduce((a, v) => a + v, 0) / block.length;
      const v = scl[y * SCALED + x];
      // Positive error = server reports SHALLOWER than the true block mean
      // (elevation convention: less negative is shallower).
      signed.push(v - mean);
      // Float equality is the right test here: a point sample reproduces the
      // source value bit for bit, an average almost never does.
      if (block.some((b) => b === v)) exact++;
      if (v >= Math.min(...block) && v <= Math.max(...block)) inRange++;
    }
  }

  const n = signed.length;
  const mean = signed.reduce((a, v) => a + v, 0) / n;
  const med = signed.slice().sort((a, b) => a - b)[Math.floor(n / 2)];
  gSum += signed.reduce((a, v) => a + v, 0);
  gN += n;
  gExact += exact;
  gInRange += inRange;

  console.log(
    "  " + s.what.padEnd(30) + mean.toFixed(3).padStart(12) + med.toFixed(3).padStart(12) +
      ((100 * exact) / n).toFixed(1).padStart(20) + ((100 * inRange) / n).toFixed(1).padStart(18)
  );
}

console.log(`\n  global mean signed error : ${(gSum / gN).toFixed(4)} m  (0 = unbiased)`);
console.log(`  cells equal to a native value : ${((100 * gExact) / gN).toFixed(1)}%  (high = point sampling)`);
console.log(`  cells within block min..max   : ${((100 * gInRange) / gN).toFixed(1)}%  (100% = no overshoot)`);
