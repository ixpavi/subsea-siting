// Marine protected area lookup for the routing engine.
//
// Loads the grid built by scripts/build-protected-areas.mjs from the European
// extract of the World Database on Protected Areas, republished by EMODnet.
//
// THE COVERAGE RULE, which is the whole reason this module is careful. The
// dataset is European, not global. A cell outside its extent is NOT "no
// protected areas here" -- it is "nothing is known here", and those two must
// never collapse into the same answer. So every query returns one of three
// outcomes, not two:
//
//   inside the extent, marked      -> the route crosses protected water
//   inside the extent, unmarked    -> it does not
//   outside the extent             -> UNKNOWN, and the criterion is unavailable
//
// Reporting the third case as "no constraints found" would turn absence of data
// into evidence of environmental safety, which is the single most damaging
// thing this layer could do.
import type { EnvironmentalAssessment } from "./routingTypes";
import { assetUrl } from "../assetUrl";

interface ProtectedAreasFile {
  resolutionDeg: number;
  rows: number;
  cols: number;
  provenance: string;
  source: { service: string; layer: string; features: number; polygons: number };
  dataExtent: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  countries: string[];
  resolutionCaveat: string;
  representedAreas: number;
  markedCells: number;
  /** Sorted indices of marked cells. Sparse because the mask is 99.6% empty. */
  markedIndices: number[];
}

export interface ProtectedAreaGrid {
  resolutionDeg: number;
  rows: number;
  cols: number;
  marked: Set<number>;
  extent: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  provenance: string;
  resolutionCaveat: string;
  countries: string[];
  representedAreas: number;
}

let gridPromise: Promise<ProtectedAreaGrid> | null = null;

export function loadProtectedAreas(): Promise<ProtectedAreaGrid> {
  if (!gridPromise) {
    gridPromise = fetch(assetUrl("data/protected-areas.json"))
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load protected-areas.json: ${res.status}`);
        return res.json() as Promise<ProtectedAreasFile>;
      })
      .then((file) => ({
        resolutionDeg: file.resolutionDeg,
        rows: file.rows,
        cols: file.cols,
        marked: new Set(file.markedIndices),
        extent: file.dataExtent,
        provenance: file.provenance,
        resolutionCaveat: file.resolutionCaveat,
        countries: file.countries,
        representedAreas: file.representedAreas,
      }));
    gridPromise.catch(() => {
      gridPromise = null;
    });
  }
  return gridPromise;
}

function inExtent(grid: ProtectedAreaGrid, lat: number, lng: number): boolean {
  const e = grid.extent;
  return lat >= e.minLat && lat <= e.maxLat && lng >= e.minLng && lng <= e.maxLng;
}

function isProtected(grid: ProtectedAreaGrid, lat: number, lng: number): boolean {
  const row = Math.floor((lat + 90) / grid.resolutionDeg);
  const col = Math.floor((lng + 180) / grid.resolutionDeg);
  if (row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) return false;
  return grid.marked.has(row * grid.cols + col);
}

/** Distance in km between two points; local helper so this module has no
 *  dependency on the rest of the engine. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Environmental exposure for one candidate route.
 *
 * @param marinePath the route's own geometry, [lat, lng] pairs.
 *
 * Availability is decided by the ROUTE'S location, not per sample. A route
 * partly outside the data extent cannot be scored honestly -- the unknown
 * portion could contain anything -- so the whole assessment is reported
 * unavailable rather than scored on the half that happens to be covered.
 */
export function assessEnvironmentalWithGrid(
  marinePath: [number, number][],
  grid: ProtectedAreaGrid
): EnvironmentalAssessment {
  if (marinePath.length < 2) {
    return {
      available: false,
      reason: "Route geometry too short to assess environmental exposure.",
    };
  }

  const outside = marinePath.filter(([lat, lng]) => !inExtent(grid, lat, lng)).length;
  const outsideFraction = outside / marinePath.length;

  // Any meaningful excursion beyond the data extent makes the whole answer
  // unreliable, so the threshold is deliberately strict.
  if (outsideFraction > 0.02) {
    return {
      available: false,
      reason:
        `${(outsideFraction * 100).toFixed(0)}% of this route lies outside the protected-area dataset's ` +
        `coverage (${grid.extent.minLat.toFixed(0)}..${grid.extent.maxLat.toFixed(0)}N, ` +
        `${grid.extent.minLng.toFixed(0)}..${grid.extent.maxLng.toFixed(0)}E -- the European extract of the ` +
        "World Database on Protected Areas, not the global database). Environmental exposure is reported as " +
        "UNAVAILABLE rather than scored on the covered portion: the uncovered part could contain protected " +
        "water and scoring it as clear would misrepresent missing data as environmental safety.",
    };
  }

  // Walk the route, accumulating length inside protected cells and counting
  // distinct entries (a run of protected samples is one crossing, not many).
  let constrainedKm = 0;
  let crossings = 0;
  let wasInside = false;
  let totalKm = 0;

  for (let i = 0; i < marinePath.length - 1; i++) {
    const [lat1, lng1] = marinePath[i];
    const [lat2, lng2] = marinePath[i + 1];
    const segKm = haversineKm(lat1, lng1, lat2, lng2);
    totalKm += segKm;
    // Attribute a segment by its midpoint: at 11 km cells a segment rarely
    // spans more than one cell, and midpoint sampling avoids double-counting
    // the shared vertex between consecutive segments.
    const midLat = (lat1 + lat2) / 2;
    const midLng = (lng1 + lng2) / 2;
    const inside = isProtected(grid, midLat, midLng);
    if (inside) {
      constrainedKm += segKm;
      if (!wasInside) crossings++;
    }
    wasInside = inside;
  }

  // 0 = no protected water crossed, 1 = entirely inside. A share rather than an
  // absolute distance, so long and short routes are comparable -- which is what
  // the MCDA normalisation needs.
  const penaltyScore = totalKm > 0 ? constrainedKm / totalKm : 0;

  return {
    available: true,
    reason:
      `${constrainedKm.toFixed(0)} km of this route (${(penaltyScore * 100).toFixed(1)}%) crosses ` +
      `${crossings} designated marine protected area${crossings === 1 ? "" : "s"}. ` +
      "Source: World Database on Protected Areas, European extract via EMODnet Human Activities, " +
      "rasterised to ~11 km cells. This indicates PROXIMITY to protected water, not a legal boundary, " +
      "and is not a substitute for consent-stage environmental assessment.",
    constrainedDistanceKm: constrainedKm,
    affectedZoneCount: crossings,
    penaltyScore,
  };
}
