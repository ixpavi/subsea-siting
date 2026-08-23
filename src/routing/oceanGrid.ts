// Loads and queries the rasterized land/depth-band grid built by
// scripts/build-ocean-grid.mjs from real Natural Earth (GEBCO/ETOPO-derived)
// bathymetry contours + land polygons. See that script's header for exactly
// how the grid was produced and what its resolution/depth semantics are.
//
// IMPORTANT: every depth value this module returns is a CONTOUR-BAND LOWER
// BOUND ("at least this deep"), not a precise sounding. A cell classified
// into the ">= 3000m" band could be 3,000m or 5,999m deep -- the source data
// simply doesn't distinguish within a band. Callers must present these as
// band-derived estimates, never as fabricated point-precise depths.
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
  data: Uint8Array; // row-major, row 0 = -90..-89.5 lat, col 0 = -180..-179.5 lng; 0 = land
}

interface OceanGridJson {
  resolutionDeg: number;
  rows: number;
  cols: number;
  depthBands: DepthBand[];
  provenance: string;
  data: number[];
}

let gridPromise: Promise<OceanGrid> | null = null;

export function loadOceanGrid(): Promise<OceanGrid> {
  if (!gridPromise) {
    gridPromise = fetch("/data/ocean-grid.json")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load ocean-grid.json: ${res.status}`);
        return res.json() as Promise<OceanGridJson>;
      })
      .then((json) => ({ ...json, data: new Uint8Array(json.data) }));
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

/** 0 = land/unclassified, 1..N = ocean depth-band index (deeper band = larger index). */
export function bandAt(grid: OceanGrid, lat: number, lng: number): number {
  const row = rowForLat(grid, lat);
  const col = colForLng(grid, lng);
  return grid.data[row * grid.cols + col];
}

export function isOcean(grid: OceanGrid, lat: number, lng: number): boolean {
  return bandAt(grid, lat, lng) > 0;
}

/** Band's documented lower-bound depth in metres -- the conservative depth estimate used throughout this engine. */
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
        const band = grid.data[row * grid.cols + col];
        if (band === 0) continue;
        const cellLat = latForRow(grid, row);
        const cellLng = lngForCol(grid, col);
        const d = haversineKm(lat, lng, cellLat, cellLng);
        if (!best || d < best.distanceKm) best = { lat: cellLat, lng: cellLng, band, distanceKm: d };
      }
    }
    if (best) return best;
  }
  return null;
}
