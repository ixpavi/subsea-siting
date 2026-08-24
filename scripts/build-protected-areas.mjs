// Builds public/data/protected-areas.json: marine protected area coverage,
// rasterised to the same grid the routing engine already uses.
//
// WHY RASTERISE. The source is 826 MultiPolygons averaging ~2,500 vertices.
// Testing a route against those polygons at runtime would mean hundreds of
// thousands of point-in-polygon tests per candidate, in the browser, on every
// weight change. Rasterising once at build time turns "is this point inside a
// protected area" into an array lookup, exactly as scripts/build-ocean-grid.mjs
// does for land and depth.
//
// COVERAGE IS EUROPEAN, AND THAT IS RECORDED. EMODnet serves the European
// extract of the World Database on Protected Areas, not the global database:
// all 826 features fall in 28 countries, led by the UK (389), Denmark (109)
// and France (45). A grid that simply stored 0 outside Europe would be
// indistinguishable from "no protected areas here", which is false and is
// exactly the misreading this project refuses elsewhere. So the output records
// the DATA EXTENT separately from the coverage mask, and callers must report
// the criterion unavailable outside it.
//
// BINARY, NOT GRADED. The records carry an IUCN category, but 720 of 826 have
// it as "Not applicable", blank, or "Not assigned". Weighting a route by
// protection strength on that basis would be inventing precision the source
// does not have. The mask is "inside a designated MPA or not"; the category is
// carried per area for display only.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public", "data");
const CACHE = join(__dirname, "research", ".cache");
if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });

const WFS = "https://ows.emodnet-humanactivities.eu/wfs";
const LAYER = "emodnet:marineprotectedareas";
const PAGE = 100;

/** FINER than the ocean grid, deliberately, and stored separately.
 *
 *  A first version reused the routing grid's 0.5 degree cells. At ~56 km that
 *  is far coarser than the features: 8,037 of 8,254 polygons (97%) were smaller
 *  than a single cell, so nearly every protected area either vanished or was
 *  inflated to 56 km across. A layer that misrepresents 97% of its own source
 *  is not worth shipping.
 *
 *  At 0.1 degree (~11 km) most areas resolve to several cells. The remaining
 *  under-cell polygons are still reported below rather than hidden. */
const RESOLUTION_DEG = 0.1;
const ROWS = Math.round(180 / RESOLUTION_DEG);
const COLS = Math.round(360 / RESOLUTION_DEG);

const cellCenterLat = (row) => -90 + (row + 0.5) * RESOLUTION_DEG;
const cellCenterLng = (col) => -180 + (col + 0.5) * RESOLUTION_DEG;

async function fetchAll() {
  const cachePath = join(CACHE, "mpa-features.json");
  if (existsSync(cachePath)) {
    console.log("Using cached MPA features.");
    return JSON.parse(readFileSync(cachePath, "utf-8"));
  }
  const features = [];
  for (let start = 0; ; start += PAGE) {
    const url =
      `${WFS}?service=WFS&version=2.0.0&request=GetFeature&typeName=${LAYER}` +
      `&outputFormat=application/json&count=${PAGE}&startIndex=${start}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} at offset ${start}`);
    const page = await res.json();
    const got = page.features ?? [];
    features.push(...got);
    console.log(`  fetched ${features.length}`);
    if (got.length < PAGE) break;
  }
  writeFileSync(cachePath, JSON.stringify({ features }));
  return { features };
}

console.log("Fetching marine protected areas (EMODnet / WDPA European extract)...");
const { features } = await fetchAll();
console.log(`Total features: ${features.length}\n`);

// --- Point-in-polygon, same convention as build-ocean-grid.mjs -------------
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function pointInPolygon(lng, lat, rings) {
  if (!pointInRing(lng, lat, rings[0])) return false;
  for (let h = 1; h < rings.length; h++) if (pointInRing(lng, lat, rings[h])) return false;
  return true;
}

/** Flat list of polygons, plus the overall data extent. */
const polys = [];
let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
const areas = [];

for (const f of features) {
  const g = f.geometry;
  if (!g) continue;
  const groups = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  let aMinLat = 90, aMaxLat = -90, aMinLng = 180, aMaxLng = -180;
  for (const rings of groups) {
    if (!rings?.[0]?.length) continue;
    let pMinLat = 90, pMaxLat = -90, pMinLng = 180, pMaxLng = -180;
    for (const [lng, lat] of rings[0]) {
      if (lat < pMinLat) pMinLat = lat;
      if (lat > pMaxLat) pMaxLat = lat;
      if (lng < pMinLng) pMinLng = lng;
      if (lng > pMaxLng) pMaxLng = lng;
    }
    polys.push({ rings, pMinLat, pMaxLat, pMinLng, pMaxLng });
    aMinLat = Math.min(aMinLat, pMinLat); aMaxLat = Math.max(aMaxLat, pMaxLat);
    aMinLng = Math.min(aMinLng, pMinLng); aMaxLng = Math.max(aMaxLng, pMaxLng);
  }
  if (aMaxLat < aMinLat) continue;
  minLat = Math.min(minLat, aMinLat); maxLat = Math.max(maxLat, aMaxLat);
  minLng = Math.min(minLng, aMinLng); maxLng = Math.max(maxLng, aMaxLng);
  const p = f.properties ?? {};
  areas.push({
    name: p.name ?? p.orig_name ?? null,
    country: (p.country ?? "").trim() || null,
    designation: (p.designatio ?? "").trim() || null,
    iucnCategory: (p.iucn_cat ?? "").trim() || null,
  });
}

console.log(`Polygons: ${polys.length}`);
console.log(`Data extent: lat ${minLat.toFixed(2)}..${maxLat.toFixed(2)}, lng ${minLng.toFixed(2)}..${maxLng.toFixed(2)}\n`);

// --- Rasterise -------------------------------------------------------------
const grid = new Uint8Array(ROWS * COLS);
let marked = 0;

for (const poly of polys) {
  // Bounded scan over the polygon's own bbox rather than the whole globe.
  const rowLo = Math.max(0, Math.floor((poly.pMinLat + 90) / RESOLUTION_DEG) - 1);
  const rowHi = Math.min(ROWS - 1, Math.ceil((poly.pMaxLat + 90) / RESOLUTION_DEG) + 1);
  const colLo = Math.max(0, Math.floor((poly.pMinLng + 180) / RESOLUTION_DEG) - 1);
  const colHi = Math.min(COLS - 1, Math.ceil((poly.pMaxLng + 180) / RESOLUTION_DEG) + 1);
  for (let r = rowLo; r <= rowHi; r++) {
    const lat = cellCenterLat(r);
    for (let c = colLo; c <= colHi; c++) {
      const idx = r * COLS + c;
      if (grid[idx]) continue;
      if (pointInPolygon(cellCenterLng(c), lat, poly.rings)) {
        grid[idx] = 1;
        marked++;
      }
    }
  }
}

console.log(`Cells inside a protected area: ${marked.toLocaleString()} of ${(ROWS * COLS).toLocaleString()}`);

// --- Honest note on resolution --------------------------------------------
// A 0.1 degree cell is ~11 km. An area smaller than that is either missed (no
// cell centre falls inside it) or inflated to a whole cell. Both directions are
// wrong and the magnitude is reported rather than hidden.
//
// Counting POLYGON PARTS overstates the problem: 826 protected areas are
// published as 8,254 polygons, most of them small fragments of multi-part
// areas. What matters is how many distinct AREAS end up represented at all.
const smallAreas = polys.filter(
  (p) => (p.pMaxLat - p.pMinLat) < RESOLUTION_DEG && (p.pMaxLng - p.pMinLng) < RESOLUTION_DEG
).length;

// How many of the 826 real areas produced at least one marked cell?
let representedAreas = 0;
for (const f of features) {
  const g = f.geometry;
  if (!g) continue;
  const groups = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  let hit = false;
  for (const rings of groups) {
    if (hit || !rings?.[0]?.length) break;
    let aLo = 90, aHi = -90, oLo = 180, oHi = -180;
    for (const [lng, lat] of rings[0]) {
      if (lat < aLo) aLo = lat; if (lat > aHi) aHi = lat;
      if (lng < oLo) oLo = lng; if (lng > oHi) oHi = lng;
    }
    const rLo = Math.max(0, Math.floor((aLo + 90) / RESOLUTION_DEG));
    const rHi = Math.min(ROWS - 1, Math.ceil((aHi + 90) / RESOLUTION_DEG));
    const cLo = Math.max(0, Math.floor((oLo + 180) / RESOLUTION_DEG));
    const cHi = Math.min(COLS - 1, Math.ceil((oHi + 180) / RESOLUTION_DEG));
    for (let r = rLo; r <= rHi && !hit; r++)
      for (let c = cLo; c <= cHi; c++) if (grid[r * COLS + c]) { hit = true; break; }
  }
  if (hit) representedAreas++;
}
console.log(`Protected AREAS with at least one cell: ${representedAreas} of ${features.length} ` +
  `(${((100 * representedAreas) / features.length).toFixed(0)}%)`);
console.log(`Polygon PARTS smaller than one grid cell: ${smallAreas} of ${polys.length} ` +
  `(${((100 * smallAreas) / polys.length).toFixed(0)}%) -- these resolve to at most one cell each`);

const extentRows = [
  Math.max(0, Math.floor((minLat + 90) / RESOLUTION_DEG)),
  Math.min(ROWS - 1, Math.ceil((maxLat + 90) / RESOLUTION_DEG)),
];
const extentCols = [
  Math.max(0, Math.floor((minLng + 180) / RESOLUTION_DEG)),
  Math.min(COLS - 1, Math.ceil((maxLng + 180) / RESOLUTION_DEG)),
];

writeFileSync(join(OUT, "protected-areas.json"), JSON.stringify({
  resolutionDeg: RESOLUTION_DEG,
  rows: ROWS,
  cols: COLS,
  provenance:
    "Marine protected areas from EMODnet Human Activities, which republishes the EUROPEAN EXTRACT of the " +
    "World Database on Protected Areas (WDPA). Rasterised to a 0.5 degree grid at build time by " +
    "scripts/build-protected-areas.mjs. This is NOT global WDPA: all features fall within the dataExtent " +
    "below, and outside that extent the absence of a marked cell means NO DATA, never 'no protected areas'.",
  source: { service: WFS, layer: LAYER, features: features.length, polygons: polys.length },
  /** Outside this box the grid carries no information at all. */
  dataExtent: { minLat, maxLat, minLng, maxLng, rows: extentRows, cols: extentCols },
  countries: [...new Set(areas.map((a) => a.country).filter(Boolean))].sort(),
  resolutionCaveat:
    `A ${RESOLUTION_DEG} degree cell is about 11 km. ${representedAreas} of ${features.length} protected ` +
    `areas produce at least one cell; ${smallAreas} of ${polys.length} individual polygon parts are smaller ` +
    "than one cell and resolve to at most a single cell. Extent is approximate at this resolution and must " +
    "never be presented as a legal boundary -- it answers 'is this route near protected water', not 'is this " +
    "point inside a protected area'.",
  representedAreas,
  markedCells: marked,
  // SPARSE: the sorted indices of marked cells, not a full array.
  //
  // The mask is 99.8% zeros -- 991 marked cells out of 259,200 at the original
  // resolution -- and serialising every zero produced a 1.7 MB payload of
  // almost no information. Storing only the marked indices carries exactly the
  // same data at a fraction of the size, and the runtime rebuilds a lookup set
  // once on load.
  markedIndices: (() => {
    const out = [];
    for (let i = 0; i < grid.length; i++) if (grid[i]) out.push(i);
    return out;
  })(),
}));

const bytes = readFileSync(join(OUT, "protected-areas.json")).length;
console.log(`\nWrote public/data/protected-areas.json (${(bytes / 1024).toFixed(0)} KB)`);
console.log(`Countries represented: ${[...new Set(areas.map((a) => a.country).filter(Boolean))].length}`);
