// Rasterizes the real (Natural Earth, GEBCO-derived) land + bathymetry-contour
// polygons in scripts/raw/{land,bathymetry}/ into a compact global grid used
// by the hypothetical marine-routing engine (src/routing/*).
//
// WHY A GRID, NOT RUNTIME POINT-IN-POLYGON: the source polygons total
// several MB and thousands of rings -- testing every candidate route point
// against them live in the browser would be slow and would have to be
// redone on every render. Rasterizing once, at build time, into a flat
// byte-per-cell grid turns "is this point ocean, and how deep" into an O(1)
// array lookup at runtime, and keeps the shipped payload tiny (one byte per
// cell; see size note at the bottom of this file's output).
//
// GRID SEMANTICS:
//   - Resolution: 0.5 degrees latitude x 0.5 degrees longitude (RESOLUTION_DEG
//     below). This is a deliberate, disclosed approximation -- real GEBCO is
//     15 arc-second (~0.004 deg); a coarser grid keeps pathfinding fast and
//     the payload small, at the cost of route geometry that can't resolve
//     features finer than ~55km. This tradeoff, and the fact that it is NOT
//     full-resolution GEBCO, is surfaced to the user in the app UI, not just
//     buried in this comment (see src/routing/oceanGrid.ts).
//   - Cell value 0 = land (or otherwise outside every bathymetry contour --
//     treated as land-adjacent/unroutable, since a coastline-precision gap
//     is far more likely than genuine open ocean with no contour coverage).
//   - Cell value 1..12 = ocean, deepest CONTOUR BAND the cell falls inside
//     (see DEPTH_BANDS below). Bands are nested (falling inside "9000m+"
//     implies falling inside "0m+"), so each cell is rasterized in shallow
//     -> deep order and the deepest hit wins -- giving each ocean cell a
//     "this point is at least this deep" classification, not a precise
//     single-metre depth. Depth statistics computed from this grid should
//     always be reported as band-derived (e.g. "2,000-3,000 m") never as a
//     fabricated precise figure -- see src/routing/oceanGrid.ts.
//
// Point-in-polygon: standard even-odd ray casting, applied per GeoJSON
// Polygon/MultiPolygon feature with holes handled correctly (ring 0 =
// exterior must contain the point; the point must NOT be contained by any
// later ring in the same polygon). No dependency added for this -- same
// hand-rolled-geometry convention as cableNetwork.ts/connectivityAnalysis.ts.
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW = join(__dirname, "raw");
const OUT = join(__dirname, "..", "public", "data");

const readJSON = (p) => JSON.parse(readFileSync(p, "utf-8"));

const RESOLUTION_DEG = 0.5;
const ROWS = Math.round(180 / RESOLUTION_DEG); // latitude bins
const COLS = Math.round(360 / RESOLUTION_DEG); // longitude bins

// cell (row, col) center coordinates: row 0 = southernmost band, col 0 = -180
function cellCenterLat(row) {
  return -90 + (row + 0.5) * RESOLUTION_DEG;
}
function cellCenterLng(col) {
  return -180 + (col + 0.5) * RESOLUTION_DEG;
}
function latToRow(lat) {
  return Math.min(ROWS - 1, Math.max(0, Math.floor((lat + 90) / RESOLUTION_DEG)));
}
function lngToCol(lng) {
  const wrapped = ((lng + 180) % 360 + 360) % 360 - 180;
  return Math.min(COLS - 1, Math.max(0, Math.floor((wrapped + 180) / RESOLUTION_DEG)));
}

/** Even-odd ray-casting point-in-ring test. ring = [[lng,lat], ...]. */
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** polygonRings = array of rings (ring 0 = exterior, rest = holes). */
function pointInPolygon(lng, lat, polygonRings) {
  if (!pointInRing(lng, lat, polygonRings[0])) return false;
  for (let h = 1; h < polygonRings.length; h++) {
    if (pointInRing(lng, lat, polygonRings[h])) return false;
  }
  return true;
}

function ringBounds(ring) {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLng, maxLng, minLat, maxLat };
}

/** True if consecutive ring vertices ever jump more than 180° in longitude -- the actual signature of an edge that crosses the antimeridian (as opposed to a polygon that merely happens to have a wide bounding box, like a polar-cap polygon whose vertices sweep gradually through every longitude without ever taking that shortcut). */
function ringHasAntimeridianEdge(ring) {
  for (let i = 1; i < ring.length; i++) {
    if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) return true;
  }
  return false;
}

/**
 * Azimuthal (polar) projection: (lat,lng) -> (x,y) with the given pole at
 * the origin and every meridian a straight ray from it. `pole` is +1 for
 * the north pole (radius = 90-lat) or -1 for the south pole (radius =
 * 90+lat). Longitude becomes an ordinary angle in this Cartesian plane, so
 * there is no seam/discontinuity anywhere -- crossing the antimeridian is
 * just crossing the positive x-axis, nothing special. This is what makes it
 * possible to run standard planar point-in-polygon on a polygon that
 * genuinely encircles a pole (see the doc on POLE-ADJACENT handling below),
 * where plain lat/lng ray-casting breaks down no matter how the ring's
 * longitude values are unwrapped -- the pole itself has no well-defined
 * longitude, so "crossing the antimeridian" isn't the actual problem there.
 */
function toAzimuthal(lat, lng, pole) {
  const r = pole > 0 ? 90 - lat : 90 + lat;
  const theta = (lng * Math.PI) / 180;
  return [r * Math.cos(theta), r * Math.sin(theta)];
}

/**
 * Extracts a flat list of { rings, bounds, wide } polygons from a
 * Feature/FeatureCollection (Polygon or MultiPolygon geometries only, which
 * is all these datasets contain).
 *
 * ANTIMERIDIAN HANDLING: a ring that actually crosses +/-180 deg longitude
 * (e.g. Russia/Chukotka, Fiji) has an edge that jumps from near +180 to near
 * -180 between two adjacent vertices that are geographically close together
 * -- detected precisely via ringHasAntimeridianEdge, NOT via a merely-wide
 * bounding box (a first version of this used bbox width as the signal,
 * which also fires for polar-cap polygons like Antarctica that legitimately
 * sweep through every longitude without any such jump; "unwrapping" those
 * by shifting negative longitudes +360 mangles their ring into nonsense and
 * corrupts point-in-polygon results across huge, unrelated parts of the
 * globe -- caught by Bay of Bengal and mid-Atlantic points coming back
 * "land" after that first attempted fix). A genuine crossing is corrected
 * by unwrapping: every negative longitude in the ring is shifted +360 so it
 * becomes numerically contiguous (e.g. 170..190 instead of jumping
 * 179 -> -179). `wide` marks these polygons so rasterize() below knows to
 * test the wrapped coordinate (lng+360) as well as the raw one.
 *
 * Getting this wrong doesn't just mis-render one country -- it corrupts
 * pointInPolygon's ray-casting for unrelated points near the broken bbox,
 * which is what originally rasterized a false "land" wall most of the way
 * across the Pacific (caught by A* pathfinding failing on every
 * trans-Pacific route, e.g. Los Angeles -> Tokyo, until this was found).
 *
 * POLE-ADJACENT HANDLING: a ring that actually ENCIRCLES a pole (this
 * dataset has both a high-Arctic deep-ocean contour and, in the land
 * dataset, Antarctica) also trips the antimeridian-edge test, but simple
 * planar unwrapping doesn't produce a valid polygon for something that
 * contains a pole rather than merely crossing the seam at one place -- the
 * pole itself has no well-defined longitude, so there is no consistent
 * "shift negative values +360" that makes the ring simple (confirmed by
 * tracing a false "ocean" hit onto Siberia at 65N/100E back to exactly this
 * kind of polygon, and by Antarctica vanishing from the land mask entirely
 * when such polygons were instead just skipped). These are reprojected with
 * toAzimuthal() instead, centered on whichever pole the polygon's bounds
 * are closest to -- in that space the polygon is an ordinary simple ring
 * with no seam at all, and standard planar point-in-polygon applies exactly
 * as it does everywhere else in this file.
 */
function extractPolygons(geojson) {
  const polys = [];
  for (const feature of geojson.features) {
    const geom = feature.geometry;
    if (!geom) continue;
    const multiPolys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
    for (const rings of multiPolys) {
      const rawBounds = ringBounds(rings[0]);
      if (rawBounds.maxLat >= 89 || rawBounds.minLat <= -89) {
        const pole = rawBounds.maxLat >= 89 ? 1 : -1;
        const projectedRings = rings.map((ring) => ring.map(([lng, lat]) => toAzimuthal(lat, lng, pole)));
        polys.push({ rings: projectedRings, bounds: rawBounds, mode: "polar", pole });
        continue;
      }
      if (!ringHasAntimeridianEdge(rings[0])) {
        polys.push({ rings, bounds: rawBounds, mode: "normal" });
        continue;
      }
      const unwrappedRings = rings.map((ring) => ring.map(([lng, lat]) => [lng < 0 ? lng + 360 : lng, lat]));
      polys.push({ rings: unwrappedRings, bounds: ringBounds(unwrappedRings[0]), mode: "wide" });
    }
  }
  return polys;
}

/** Rasterizes one polygon set onto `mark(row, col)` for every grid cell whose center falls inside any polygon, restricted to each polygon's bbox for speed. */
function rasterize(polys, mark) {
  for (const { rings, bounds, mode, pole } of polys) {
    const rowStart = latToRow(bounds.minLat);
    const rowEnd = latToRow(bounds.maxLat);
    // A `wide` (antimeridian-unwrapped) or `polar` (azimuthal-projected)
    // polygon's bounds/rings are no longer in plain lat/lng space, so a
    // bbox-restricted column range doesn't mean anything for them -- scan
    // every column and let the per-cell test below do the real work.
    //
    // For `normal` polygons, bounds.maxLng === 180 needs its own case:
    // lngToCol() normalizes +180 and -180 to the SAME meridian (correct for
    // a query point, since they really are the same meridian) but that
    // collapses a bbox's upper edge down to column 0 instead of the last
    // column -- silently emptying the whole column range (colStart > 0 >
    // colEnd) for any polygon whose bbox happens to end exactly at the
    // seam. That's not a rare edge case here: the source ocean/bathymetry
    // data is pre-tiled at the antimeridian (see the L_0 feature dump in
    // git history), so a large fraction of ocean polygons have exactly this
    // bbox shape -- this one bug alone was enough to silently drop most of
    // the Pacific side of the ocean grid near 170-180°E before it was found
    // (confirmed by point-in-polygon returning true for a test point that
    // the full rasterize() pass still left unclassified).
    const colStart = mode === "normal" ? lngToCol(bounds.minLng) : 0;
    const colEnd = mode === "normal" ? (bounds.maxLng >= 180 ? COLS - 1 : lngToCol(bounds.maxLng)) : COLS - 1;
    for (let row = rowStart; row <= rowEnd; row++) {
      const lat = cellCenterLat(row);
      for (let col = colStart; col <= colEnd; col++) {
        const lng = cellCenterLng(col);
        let hit;
        if (mode === "polar") {
          const [x, y] = toAzimuthal(lat, lng, pole);
          hit = pointInPolygon(x, y, rings);
        } else if (mode === "wide") {
          hit = pointInPolygon(lng, lat, rings) || pointInPolygon(lng + 360, lat, rings);
        } else {
          hit = pointInPolygon(lng, lat, rings);
        }
        if (hit) mark(row, col);
      }
    }
  }
}

console.log(`Rasterizing ${ROWS}x${COLS} grid (${RESOLUTION_DEG}° resolution)...`);

const grid = new Uint8Array(ROWS * COLS); // 0 = land/unclassified, 1..12 = ocean depth band (deepest matched)

// Depth bands, shallow -> deep. `minDepthM` is the contour's documented
// lower bound ("this polygon = ocean this deep or deeper"); band index in
// the grid is 1-based position in this array.
const DEPTH_BANDS = [
  { file: "L_0.geojson", minDepthM: 0 },
  { file: "K_200.geojson", minDepthM: 200 },
  { file: "J_1000.geojson", minDepthM: 1000 },
  { file: "I_2000.geojson", minDepthM: 2000 },
  { file: "H_3000.geojson", minDepthM: 3000 },
  { file: "G_4000.geojson", minDepthM: 4000 },
  { file: "F_5000.geojson", minDepthM: 5000 },
  { file: "E_6000.geojson", minDepthM: 6000 },
  { file: "D_7000.geojson", minDepthM: 7000 },
  { file: "C_8000.geojson", minDepthM: 8000 },
  { file: "B_9000.geojson", minDepthM: 9000 },
  { file: "A_10000.geojson", minDepthM: 10000 },
];

DEPTH_BANDS.forEach((band, i) => {
  const geojson = readJSON(join(RAW, "bathymetry", band.file));
  const polys = extractPolygons(geojson);
  const bandIndex = i + 1;
  rasterize(polys, (row, col) => {
    grid[row * COLS + col] = bandIndex; // deeper bands processed later overwrite shallower -- deepest hit wins
  });
  console.log(`  ${band.file}: ${polys.length} polygons -> band ${bandIndex} (>= ${band.minDepthM}m)`);
});

// Land mask: zero out any cell inside a land polygon, regardless of what a
// (necessarily imprecise, simplified) bathymetry contour said -- land always
// wins, since routing across land is the one thing that must never happen.
const landGeo = readJSON(join(RAW, "land", "ne_land.geojson"));
const landPolys = extractPolygons(landGeo);
let landCells = 0;
rasterize(landPolys, (row, col) => {
  if (grid[row * COLS + col] !== 0) landCells++;
  grid[row * COLS + col] = 0;
});
console.log(`  land mask: ${landPolys.length} polygons, cleared ${landCells} previously-classified cells`);

// --- Narrow straits that the raster cannot represent -----------------------
//
// A 0.5 degree cell is 56 km across. Any strait narrower than that can close
// completely during rasterization, and the consequences are not cosmetic: the
// Strait of Gibraltar is 14 km wide, came out solid land, and sealed the
// Mediterranean into an isolated basin. 189 real cable landing points --
// Marseille, Barcelona, Genoa among them -- became unreachable from every
// other ocean, and routes to them returned no path at all rather than a long
// one. Measured across the whole grid, 282 of 1,920 landing points (14.7%)
// were stranded this way. See scripts/analyse-grid-connectivity.mjs and
// scripts/find-grid-barriers.mjs, which located these by searching for
// one-cell gaps between water bodies rather than by guesswork.
//
// WHAT THIS LIST IS AND IS NOT. Every entry is a real, named, navigable
// natural strait that genuinely connects two bodies of open ocean. Forcing
// these cells to water corrects a known rasterization error; it does not
// invent geography. Two categories are deliberately EXCLUDED:
//
//   - Artificial canals (Suez, Panama). These are man-made, the source
//     polygons never claimed to contain them, and whether a new cable could
//     transit one is a permitting question rather than a geographic fact.
//     Leaving them closed keeps the engine's documented behaviour honest:
//     routes between Europe and Asia come out around Africa, which is what
//     the disclosure has always said and -- once Gibraltar is open -- is now
//     actually what happens instead of failing outright.
//
//   - Genuinely landlocked water. The Caspian Sea sits 13 cells from open
//     ocean and stays isolated, because it IS isolated. A rule that simply
//     connected every stranded basin would have carved a 724 km channel
//     through Iran.
//
// Depth is set to the shallowest band. These are all shallow sills (Gibraltar
// about 300 m, Juan de Fuca about 100-200 m), so the shallowest band is the
// honest classification and it correctly makes the router treat them as
// nearshore rather than easy deep water.
const NAVIGABLE_STRAITS = [
  { name: "Strait of Gibraltar", lat: 35.95, lng: -5.6, connects: "Mediterranean <-> Atlantic" },
  { name: "Strait of Juan de Fuca", lat: 48.35, lng: -124.2, connects: "Salish Sea <-> Pacific" },
  { name: "Queen Charlotte Strait", lat: 50.85, lng: -127.6, connects: "Inside Passage <-> Pacific" },
  { name: "Strait of Tiran", lat: 28.75, lng: 34.75, radius: 1, connects: "Gulf of Aqaba <-> Red Sea" },
  { name: "Sumner Strait", lat: 56.15, lng: -133.3, connects: "SE Alaska Inside Passage <-> Pacific" },
  { name: "Cook Inlet", lat: 60.15, lng: -152.2, connects: "Cook Inlet <-> Gulf of Alaska" },
  { name: "Strait of Magellan (west)", lat: -52.55, lng: -74.9, connects: "Magellan <-> Pacific" },
  { name: "Tablazo Strait", lat: 10.9, lng: -71.55, connects: "Lake Maracaibo <-> Gulf of Venezuela" },
  { name: "Strait of Malacca", lat: 2.4, lng: 101.2, connects: "Andaman Sea <-> Strait of Singapore" },
  { name: "Bosphorus", lat: 41.15, lng: 29.1, radius: 1, connects: "Black Sea <-> Sea of Marmara" },
  { name: "Dardanelles", lat: 40.25, lng: 26.75, radius: 1, connects: "Sea of Marmara <-> Aegean" },
  { name: "Kerch Strait", lat: 45.3, lng: 36.6, connects: "Sea of Azov <-> Black Sea" },
  { name: "Cook Inlet (upper)", lat: 61.25, lng: -150.75, radius: 1, connects: "Upper Cook Inlet <-> Gulf of Alaska" },
  { name: "Strait of Magellan (eastern narrows)", lat: -53.75, lng: -70.75, radius: 1, connects: "Magellan <-> Atlantic" },
];

// Carve radius in cells. 0 means the single cell containing the coordinate,
// which is normally enough: the router is 8-connected, so one opened cell
// bridges the water either side of it. Radius is only raised where the
// connectivity check proves one cell does not join the two bodies, because
// every extra cell is real land being called water. A blanket 3x3 would carve
// roughly 50 km through the Gallipoli peninsula to open the Dardanelles, which
// is a far larger claim than the correction needs to make.
const SHALLOWEST_BAND = 1;
let straitCells = 0;
for (const s of NAVIGABLE_STRAITS) {
  const row = latToRow(s.lat);
  const col = lngToCol(s.lng);
  const radius = s.radius ?? 0;
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      const r = row + dr;
      if (r < 0 || r >= ROWS) continue;
      const c = ((col + dc) % COLS + COLS) % COLS;
      if (grid[r * COLS + c] === 0) {
        grid[r * COLS + c] = SHALLOWEST_BAND;
        straitCells++;
      }
    }
  }
}
console.log(`  strait corrections: ${NAVIGABLE_STRAITS.length} named straits, opened ${straitCells} cells`);

let oceanCells = 0, landOrUnknown = 0;
for (let i = 0; i < grid.length; i++) {
  if (grid[i] > 0) oceanCells++;
  else landOrUnknown++;
}
console.log(`Grid complete: ${oceanCells} ocean cells, ${landOrUnknown} land/unclassified cells`);

const output = {
  resolutionDeg: RESOLUTION_DEG,
  rows: ROWS,
  cols: COLS,
  depthBands: DEPTH_BANDS.map((b, i) => ({ index: i + 1, minDepthM: b.minDepthM })),
  provenance:
    "Land + bathymetry-contour polygons from Natural Earth v5.1.1 (bathymetry contours derived from GEBCO/ETOPO per Natural Earth's documentation), simplified and rasterized to a 0.5° grid at build time. Depth values are contour-band lower bounds, not point-precise soundings. Cells at the named natural straits listed in straitCorrections were forced to the shallowest depth band, because straits narrower than the 56 km cell size rasterize to land and would otherwise disconnect real oceans (Gibraltar, 14 km wide, sealed the Mediterranean). Artificial canals (Suez, Panama) are deliberately NOT opened. See scripts/raw/{bathymetry,land}/SOURCE.md.",
  // Named, real, navigable natural straits whose cells were forced to water.
  // Listed explicitly so this correction is auditable rather than an
  // unexplained difference between the source polygons and the shipped grid.
  straitCorrections: NAVIGABLE_STRAITS,
  // flat row-major array, row 0 = -90..-89.5 lat, col 0 = -180..-179.5 lng
  data: Array.from(grid),
};

writeFileSync(join(OUT, "ocean-grid.json"), JSON.stringify(output));
const bytes = readFileSync(join(OUT, "ocean-grid.json")).length;
console.log(`Wrote public/data/ocean-grid.json (${(bytes / 1024).toFixed(0)} KB)`);
