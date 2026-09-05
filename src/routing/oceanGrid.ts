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

/**
 * Nearest ocean cell to (lat,lng), searched as expanding square rings in
 * grid-cell space (cheap, deterministic) up to maxRingSteps out, then
 * refined by real haversine distance among the ring's ocean hits. Returns
 * null if no ocean cell is found within that radius -- callers must treat
 * that as "unavailable", never invent a fallback point.
 */
export function findNearestOceanCell(
  grid: OceanGrid,
  lat: number,
  lng: number,
  maxRingSteps = 40 // 40 * 0.5deg = 20deg ~ 2200km search radius
): { lat: number; lng: number; band: number; distanceKm: number } | null {
  const centerRow = rowForLat(grid, lat);
  const centerCol = colForLng(grid, lng);

  if (bandAt(grid, lat, lng) > 0) {
    return { lat, lng, band: bandAt(grid, lat, lng), distanceKm: 0 };
  }

  for (let ring = 1; ring <= maxRingSteps; ring++) {
    let best: { lat: number; lng: number; band: number; distanceKm: number } | null = null;
    for (let dr = -ring; dr <= ring; dr++) {
      const row = centerRow + dr;
      if (row < 0 || row >= grid.rows) continue;
      const onEdgeRow = Math.abs(dr) === ring;
      const colStep = onEdgeRow ? 1 : ring * 2;
      for (let dc = -ring; dc <= ring; dc += colStep) {
        const col = ((centerCol + dc) % grid.cols + grid.cols) % grid.cols;
        const depth = grid.depthM[row * grid.cols + col];
        if (depth === 0) continue;
        const cellLat = latForRow(grid, row);
        const cellLng = lngForCol(grid, col);
        const d = haversineKm(lat, lng, cellLat, cellLng);
        if (!best || d < best.distanceKm)
          best = { lat: cellLat, lng: cellLng, band: bandForDepth(grid, depth), distanceKm: d };
      }
    }
    if (best) return best;
  }
  return null;
}
