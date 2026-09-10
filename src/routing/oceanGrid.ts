// Loads and queries the global seabed depth grid built by
// scripts/build-ocean-depth-grid.mjs. See that script's header for how it is
// produced and why it draws on two sources.
//
// WHAT CHANGED, AND WHY IT MATTERS. This module used to return CONTOUR-BAND
// LOWER BOUNDS: a cell in the ">= 3000m" band reported 3,000m whether it was
// 3,000m or 5,999m, because the contour polygons could not tell you which.
// Every depth the app showed, and every cost derived from one, inherited that.
// It now returns a modelled depth in metres from NOAA NCEI's global DEM
// mosaic, and derives the band from that depth rather than the reverse.
//
// STILL NOT A SOUNDING. A 0.5 degree cell is about 56 km across, so a value is
// the interpolated depth of a 56 km square, not of any surveyed position in it.
// Callers must present these as modelled depths, never as measured ones.
//
// WHERE THE WATER IS, IS STILL NATURAL EARTH'S. Only the depth comes from the
// elevation model. Substituting its land/water decision as well was measured
// to seal Bab-el-Mandeb and strand 138 of 1,920 landing points; the mask that
// governs connectivity, and the strait corrections below, are unchanged.
//
// KNOWN LIMITATION -- NO CANALS: the underlying land/ocean polygons don't
// represent artificial waterways (Suez, Panama) as navigable water, since
// they aren't natural coastline. A route whose shortest real-world path
// goes through one of those canals will instead be routed the long way
// around the connecting continent by this engine (e.g. Mumbai -> London
// comes out routed around Africa, not through Suez) -- this can
// substantially overstate marine distance and cost for such city pairs.
// This is a disclosed modeling limitation, not a bug; a real canal-aware
// routing engine would need explicit canal waypoints injected into the
// graph, which is out of scope here.
//
// NARROW NATURAL STRAITS ARE CORRECTED AT BUILD TIME. A 0.5 deg cell is
// 56 km across, so a strait narrower than that can rasterize to solid land.
// The Strait of Gibraltar is 14 km wide and did exactly that, sealing the
// Mediterranean into an isolated basin: routes between it and any other
// ocean returned "no marine path could be found", and 282 of 1,920 real
// landing points (14.7%) were unreachable. build-ocean-grid.mjs now forces
// a small, enumerated set of named natural straits to water, which brings
// that to 4 -- the two Suez-side points and the two Caspian points, both
// correctly isolated. The corrections are listed in the shipped grid's
// `straitCorrections` field and are natural straits ONLY; artificial canals
// stay closed, which is what makes the "around Africa" behaviour above
// genuinely true rather than a route that simply fails.

import { assetUrl } from "../assetUrl";

export interface DepthBand {
  index: number;
  minDepthM: number;
}

export interface OceanGrid {
  resolutionDeg: number;
  rows: number;
  cols: number;
  depthBands: DepthBand[];
  provenance: string;
  /**
   * Row-major depth in METRES below sea level; row 0 = -90..-89.5 lat, col 0 =
   * -180..-179.5 lng. 0 = land.
   *
   * These are modelled depths from NOAA's global DEM mosaic, not the contour
   * BAND LOWER BOUNDS this grid used to carry -- a cell that reported "3000 m"
   * because it sat in the ">=3000 m" band now reports what the model actually
   * says there. Still not a sounding: a 0.5 degree cell is about 56 km across,
   * so the value is the interpolated depth of a 56 km square.
   */
  depthM: Int16Array;
}

interface OceanDepthJson {
  resolutionDeg: number;
  rows: number;
  cols: number;
  depthBands: DepthBand[];
  provenance: string;
  binary: string;
}

let gridPromise: Promise<OceanGrid> | null = null;

export function loadOceanGrid(): Promise<OceanGrid> {
  if (!gridPromise) {
    // Metadata and payload are separate files because the payload is a raw
    // Int16 buffer. It costs 286 KB gzipped against the band grid's 35 KB --
    // real depths are high-entropy where a 13-value band array was almost pure
    // redundancy. Paid lazily, on the first route request only.
    gridPromise = fetch(assetUrl("data/ocean-depth.json"))
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load ocean-depth.json: ${res.status}`);
        return res.json() as Promise<OceanDepthJson>;
      })
      .then(async (meta) => {
        const res = await fetch(assetUrl(`data/${meta.binary}`));
        if (!res.ok) throw new Error(`Failed to load ${meta.binary}: ${res.status}`);
        const bytes = await res.arrayBuffer();
        const expected = meta.rows * meta.cols * 2;
        if (bytes.byteLength !== expected) {
          throw new Error(
            `${meta.binary} is ${bytes.byteLength} bytes, expected ${expected} for ` +
              `${meta.rows}x${meta.cols} Int16 -- metadata and payload are out of step.`,
          );
        }
        return { ...meta, depthM: new Int16Array(bytes) };
      });
    // A failed download must not be cached: the worker lives for the whole
    // session, so one dropped request would otherwise break routing until the
    // page was reloaded.
    gridPromise.catch(() => {
      gridPromise = null;
    });
  }
  return gridPromise;
}

export function rowForLat(grid: OceanGrid, lat: number): number {
  return Math.min(grid.rows - 1, Math.max(0, Math.floor((lat + 90) / grid.resolutionDeg)));
}

export function colForLng(grid: OceanGrid, lng: number): number {
  const wrapped = (((lng + 180) % 360) + 360) % 360 - 180;
  return Math.min(grid.cols - 1, Math.max(0, Math.floor((wrapped + 180) / grid.resolutionDeg)));
}

export function latForRow(grid: OceanGrid, row: number): number {
  return -90 + (row + 0.5) * grid.resolutionDeg;
}

export function lngForCol(grid: OceanGrid, col: number): number {
  return -180 + (col + 0.5) * grid.resolutionDeg;
}

/**
 * Modelled seabed depth in METRES at (lat,lng); 0 means land.
 *
 * Prefer this over bandAt/bandDepthM for anything a user sees or a cost model
 * consumes -- it is the real reason this grid changed.
 */
export function depthAt(grid: OceanGrid, lat: number, lng: number): number {
  const row = rowForLat(grid, lat);
  const col = colForLng(grid, lng);
  return grid.depthM[row * grid.cols + col];
}

/**
 * 0 = land, 1..N = depth-band index (deeper band = larger index).
 *
 * Derived from the real depth rather than stored, so the band thresholds stay
 * the single source of truth and callers that only need a coarse class -- the
 * difficulty multiplier, the dominant-band summary -- keep working unchanged.
 */
export function bandAt(grid: OceanGrid, lat: number, lng: number): number {
  return bandForDepth(grid, depthAt(grid, lat, lng));
}

/** The band a given depth falls in. 0 for land (depth 0). */
export function bandForDepth(grid: OceanGrid, depthMetres: number): number {
  if (depthMetres <= 0) return 0;
  let best = 0;
  for (const b of grid.depthBands) {
    if (b.index === 0) continue;
    if (depthMetres >= b.minDepthM && b.index > best) best = b.index;
  }
  // Shallower than the shallowest band's floor is still water, so it belongs
  // in the shallowest band rather than reading as land.
  return best === 0 ? 1 : best;
}

export function isOcean(grid: OceanGrid, lat: number, lng: number): boolean {
  return depthAt(grid, lat, lng) > 0;
}

/** Band's documented lower-bound depth in metres. Retained for the band-level summaries; use depthAt for a real depth. */
export function bandDepthM(grid: OceanGrid, bandIndex: number): number {
  const band = grid.depthBands.find((b) => b.index === bandIndex);
  return band ? band.minDepthM : 0;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface OceanCell {
  lat: number;
  lng: number;
  band: number;
  distanceKm: number;
}

/**
 * Marks the cells of the world ocean: the largest body of water, found by
 * flooding it with exactly the moves the A* search makes (8 neighbours,
 * columns wrapping at the antimeridian, rows not). Everything else -- the
 * Caspian, lakes the coastline data keeps as water, a gulf sealed off at this
 * resolution -- is water a route can start in but never leave.
 *
 * Computed once per grid. About 260,000 cells, a few milliseconds.
 */
const worldOceanCache = new WeakMap<OceanGrid, Uint8Array>();

function worldOceanMask(grid: OceanGrid): Uint8Array {
  const cached = worldOceanCache.get(grid);
  if (cached) return cached;

  const n = grid.rows * grid.cols;
  const component = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let largest = -1;
  let largestSize = 0;
  let next = 0;

  for (let start = 0; start < n; start++) {
    if (grid.depthM[start] === 0 || component[start] !== -1) continue;
    const id = next++;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    component[start] = id;
    while (head < tail) {
      const cell = queue[head++];
      const row = Math.floor(cell / grid.cols);
      const col = cell % grid.cols;
      for (let dr = -1; dr <= 1; dr++) {
        const r = row + dr;
        if (r < 0 || r >= grid.rows) continue;
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const c = (col + dc + grid.cols) % grid.cols;
          const i = r * grid.cols + c;
          if (grid.depthM[i] === 0 || component[i] !== -1) continue;
          component[i] = id;
          queue[tail++] = i;
        }
      }
    }
    if (tail > largestSize) {
      largestSize = tail;
      largest = id;
    }
  }

  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (component[i] === largest) mask[i] = 1;
  worldOceanCache.set(grid, mask);
  return mask;
}

/**
 * Nearest ocean cell to (lat,lng), by real great-circle distance. Returns null
 * if none lies within `maxRingSteps` grid cells -- callers must treat that as
 * "unavailable", never invent a fallback point.
 *
 * @param opts.routableOnly accept only cells of the world ocean (see
 *   worldOceanMask). A MODELLED access point needs this: a point in the
 *   Caspian is the nearest water to Almaty, and no route can leave it. Snapping
 *   an existing coordinate onto the grid does not -- a landing point on the
 *   Caspian should snap into the Caspian and fail honestly, not be moved
 *   hundreds of kilometres to a sea it is not on.
 *
 * TWO PASSES, BECAUSE A GRID RING IS NOT A CIRCLE. The first pass walks
 * expanding square rings of cells until one holds any acceptable cell. That
 * alone used to be the answer, and it was measurably wrong: a column of cells
 * is 55 km wide at the equator but 24 km at Moscow's latitude, so a ring
 * reaches much further north-south than east-west, and a cell in a LATER ring
 * can be far closer. Moscow resolved to the White Sea at 945 km while the Gulf
 * of Finland is 711 km away; Madrid, Nairobi, Johannesburg, Chengdu and
 * Frankfurt were each off by 16-208 km. The first hit is now only an upper
 * bound, and the second pass searches every cell that could beat it.
 */
export function findNearestOceanCell(
  grid: OceanGrid,
  lat: number,
  lng: number,
  opts: { routableOnly?: boolean; maxRingSteps?: number } = {}
): OceanCell | null {
  // 40 * 0.5deg = 20deg, about 2,200 km north-south.
  const maxRingSteps = opts.maxRingSteps ?? 40;
  const worldOcean = opts.routableOnly ? worldOceanMask(grid) : null;
  const acceptable = (i: number) => (worldOcean ? worldOcean[i] === 1 : grid.depthM[i] !== 0);

  const centerRow = rowForLat(grid, lat);
  const centerCol = colForLng(grid, lng);
  if (acceptable(centerRow * grid.cols + centerCol)) {
    return { lat, lng, band: bandAt(grid, lat, lng), distanceKm: 0 };
  }

  /** `current`, or the cell at (row, col) if that is acceptable and closer. */
  const closer = (row: number, col: number, current: OceanCell | null): OceanCell | null => {
    const i = row * grid.cols + col;
    if (!acceptable(i)) return current;
    const cellLat = latForRow(grid, row);
    const cellLng = lngForCol(grid, col);
    const d = haversineKm(lat, lng, cellLat, cellLng);
    if (current && current.distanceKm <= d) return current;
    return { lat: cellLat, lng: cellLng, band: bandForDepth(grid, grid.depthM[i]), distanceKm: d };
  };
  const wrapCol = (col: number) => ((col % grid.cols) + grid.cols) % grid.cols;

  // Pass 1: the first ring holding any acceptable cell gives an upper bound.
  let best: OceanCell | null = null;
  for (let ring = 1; ring <= maxRingSteps && !best; ring++) {
    for (let dr = -ring; dr <= ring; dr++) {
      const row = centerRow + dr;
      if (row < 0 || row >= grid.rows) continue;
      const colStep = Math.abs(dr) === ring ? 1 : ring * 2;
      for (let dc = -ring; dc <= ring; dc += colStep) best = closer(row, wrapCol(centerCol + dc), best);
    }
  }
  if (!best) return null;

  // Pass 2: every cell that could be closer than that bound. A cell more than
  // the bound away in latitude alone is farther than it, which fixes the rows.
  // For columns, two points no further than maxAbsLat from the equator and
  // dLng apart are at least (2/pi) * R * cos(maxAbsLat) * dLng apart, so the
  // pi/2 factor keeps the window conservative -- it may search a few cells too
  // many, never one too few.
  const dLatDeg = best.distanceKm / 111.32;
  const rowMin = rowForLat(grid, lat - dLatDeg);
  const rowMax = rowForLat(grid, lat + dLatDeg);
  const cosMaxLat = Math.cos((Math.min(90, Math.abs(lat) + dLatDeg) * Math.PI) / 180);
  const dLngDeg = cosMaxLat > 1e-9 ? ((Math.PI / 2) * best.distanceKm) / (111.32 * cosMaxLat) : 360;
  const colSpan = Math.ceil(dLngDeg / grid.resolutionDeg) + 1;
  const wholeRow = colSpan * 2 + 1 >= grid.cols;
  for (let row = rowMin; row <= rowMax; row++) {
    if (wholeRow) {
      for (let col = 0; col < grid.cols; col++) best = closer(row, col, best);
    } else {
      for (let dc = -colSpan; dc <= colSpan; dc++) best = closer(row, wrapCol(centerCol + dc), best);
    }
  }
  return best;
}
