// Locates the false land barriers that cut the ocean grid into pieces.
//
// analyse-grid-connectivity.mjs established that 282 landing points (14.7%)
// cannot reach the main ocean, because straits narrower than the 56 km cell
// size rasterize to land. Gibraltar is 14 km wide and comes out solid, which
// seals the Mediterranean.
//
// Before carving anything, the gaps have to be FOUND rather than guessed. For
// every isolated water body that has real landing points in it, this reports
// the narrowest crossing to the main ocean and where it is. Each one is then a
// checkable geographic claim -- "there are N cells of grid land between these
// two coordinates" -- that can be verified against what is actually there
// before any cell is changed.
//
// The distinction that matters when reading the output: a gap at a NATURAL
// strait is a rasterization error, because that water genuinely exists and the
// grid is simply wrong about it. A gap at an ARTIFICIAL canal is not an error;
// the polygons never claimed to contain canals. Those are different decisions
// and must not be carved by the same blanket rule.
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "public", "data");

const grid = JSON.parse(readFileSync(join(DATA, "ocean-grid.json"), "utf-8"));
const landingPoints = JSON.parse(readFileSync(join(DATA, "landing-points.json"), "utf-8"));
const { rows, cols, resolutionDeg } = grid;
const data = Uint8Array.from(grid.data);
const idx = (r, c) => r * cols + c;

const rowToLat = (r) => -90 + (r + 0.5) * resolutionDeg;
const colToLng = (c) => -180 + (c + 0.5) * resolutionDeg;

// --- Components (same 8-connected + wrap rule as the router) ---------------
const label = new Int32Array(rows * cols).fill(-1);
const sizes = [];
for (let r0 = 0; r0 < rows; r0++) {
  for (let c0 = 0; c0 < cols; c0++) {
    if (data[idx(r0, c0)] === 0 || label[idx(r0, c0)] !== -1) continue;
    const id = sizes.length;
    let count = 0;
    const stack = [idx(r0, c0)];
    label[idx(r0, c0)] = id;
    while (stack.length) {
      const cur = stack.pop();
      count++;
      const r = (cur / cols) | 0, c = cur % cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nr = r + dr;
          if (nr < 0 || nr >= rows) continue;
          const nc = (c + dc + cols) % cols;
          const n = idx(nr, nc);
          if (data[n] === 0 || label[n] !== -1) continue;
          label[n] = id;
          stack.push(n);
        }
      }
    }
    sizes.push(count);
  }
}
const main = sizes.map((n, i) => ({ n, i })).sort((a, b) => b.n - a.n)[0].i;

// --- Which components hold landing points? ---------------------------------
const latToRow = (lat) => Math.min(rows - 1, Math.max(0, Math.floor((lat + 90) / resolutionDeg)));
const lngToCol = (lng) => ((Math.floor((lng + 180) / resolutionDeg) % cols) + cols) % cols;
function nearestOceanComponent(lat, lng, maxRing = 8) {
  const r0 = latToRow(lat), c0 = lngToCol(lng);
  for (let ring = 0; ring <= maxRing; ring++)
    for (let dr = -ring; dr <= ring; dr++)
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const r = r0 + dr;
        if (r < 0 || r >= rows) continue;
        const c = (c0 + dc + cols) % cols;
        if (data[idx(r, c)] > 0) return label[idx(r, c)];
      }
  return null;
}

const lpByComp = new Map();
for (const lp of landingPoints) {
  const comp = nearestOceanComponent(lp.lat, lp.lng);
  if (comp === null || comp === main) continue;
  if (!lpByComp.has(comp)) lpByComp.set(comp, []);
  lpByComp.get(comp).push(lp);
}

// --- Narrowest land crossing from each stranded body to the main ocean ------
// Multi-source BFS over LAND cells outward from the main ocean, giving each
// land cell its distance in cells from open main-ocean water. The minimum of
// that over a stranded body's land neighbours is the narrowest barrier.
const distFromMain = new Int32Array(rows * cols).fill(-1);
let queue = [];
for (let r = 0; r < rows; r++)
  for (let c = 0; c < cols; c++)
    if (data[idx(r, c)] > 0 && label[idx(r, c)] === main) {
      distFromMain[idx(r, c)] = 0;
      queue.push(idx(r, c));
    }
let d = 0;
while (queue.length) {
  const next = [];
  d++;
  for (const cur of queue) {
    const r = (cur / cols) | 0, c = cur % cols;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = r + dr;
        if (nr < 0 || nr >= rows) continue;
        const nc = (c + dc + cols) % cols;
        const n = idx(nr, nc);
        // Spread only through land; water of another component is a target,
        // not a path.
        if (distFromMain[n] !== -1) continue;
        if (data[n] > 0 && label[n] !== main) { distFromMain[n] = d; continue; }
        if (data[n] !== 0) continue;
        distFromMain[n] = d;
        next.push(n);
      }
  }
  queue = next;
  if (d > 40) break;
}

console.log("=== FALSE BARRIERS: stranded water bodies with real landing points ===");
console.log("  Land cells between each body and the main ocean, at 56 km per cell.\n");
console.log("  " + "body".padEnd(7) + "landing pts".padStart(12) + "gap cells".padStart(11) +
  "approx km".padStart(11) + "  narrowest crossing near");

const report = [];
const bodies = [...lpByComp.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [comp, lps] of bodies) {
  let best = null;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (data[idx(r, c)] === 0 || label[idx(r, c)] !== comp) continue;
      // Look outward from this body's water for the shortest land path.
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nr = r + dr;
          if (nr < 0 || nr >= rows) continue;
          const nc = (c + dc + cols) % cols;
          const dm = distFromMain[idx(nr, nc)];
          if (dm > 0 && (best === null || dm < best.gap)) {
            best = { gap: dm, lat: rowToLat(r), lng: colToLng(c) };
          }
        }
    }
  if (!best) continue;
  const km = best.gap * resolutionDeg * 111.32;
  report.push({ component: comp, landingPoints: lps.length, gapCells: best.gap, approxKm: km,
    nearLat: best.lat, nearLng: best.lng, examples: lps.slice(0, 3).map((l) => l.name) });
  console.log("  " + `#${comp}`.padEnd(7) + String(lps.length).padStart(12) +
    String(best.gap).padStart(11) + Math.round(km).toLocaleString().padStart(11) +
    `  ${best.lat.toFixed(2)}, ${best.lng.toFixed(2)}  (${lps[0].name})`);
}

console.log("\n  A gap of 1 cell means the two water bodies are neighbours separated by a");
console.log("  single false land cell -- almost certainly a strait too narrow to raster.");
console.log("  Larger gaps are real land and must NOT be carved.");

writeFileSync(join(__dirname, "grid-barriers.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  cellKm: resolutionDeg * 111.32,
  barriers: report,
}, null, 2));
console.log("\nwrote scripts/grid-barriers.json");
