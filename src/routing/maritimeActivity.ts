// Fault exposure: how much of a route runs through water where fishing gear
// and ships' anchors break cables.
//
// WHY. Fishing and anchoring cause most submarine cable faults (Carter et al.,
// 2009), most of them in water shallower than 200 m. The router already
// scores seabed depth, but depth is not where cables actually break. This
// measures the thing that does.
//
// THE DATA (scripts/build-maritime-activity.mjs). EMODnet vessel density from
// AIS, 2024: fishing vessels, and cargo plus tanker traffic as a proxy for
// anchoring -- no dataset publishes anchoring itself. Classed per 0.25 degree
// cell as low, busy (top 25% of covered water) or very busy (top 10%).
//
// DEPTH DECIDES WHETHER BUSY WATER IS A HAZARD. Busy water over the abyssal
// plain is no threat to a cable on the seabed: bottom trawls work the shelf and
// upper slope, and anchors only reach bottom in shallow water. So busy fishing
// counts where the modelled depth is at most 1,000 m, and busy shipping where
// it is at most 200 m -- both disclosed, both taken from the same 0.5 degree
// depth grid the router uses.
//
// COVERAGE IS EUROPEAN. Same rule as protected areas: a route that leaves the
// covered water is reported unavailable, never scored as quiet.
import { assetUrl } from "../assetUrl";
import { depthAt, type OceanGrid } from "./oceanGrid";
import { interpolateLatLng } from "./geo";
import type { FaultExposureAssessment } from "./routingTypes";

export interface MaritimeActivityGrid {
  resolutionDeg: number;
  rows: number;
  cols: number;
  extent: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  /** Class per cell: 0 no data, 1 low, 2 busy, 3 very busy. */
  fishing: Uint8Array;
  shipping: Uint8Array;
  year: number;
}

interface MaritimeActivityFile {
  binary: string;
  resolutionDeg: number;
  rows: number;
  cols: number;
  extent: MaritimeActivityGrid["extent"];
  source: { year: number };
}

/** Deepest water in which busy fishing counts: bottom trawling works the shelf and upper slope. */
export const FISHING_HAZARD_MAX_DEPTH_M = 1000;
/** Deepest water in which busy shipping counts: anchors only reach bottom in shallow water. */
export const ANCHORING_HAZARD_MAX_DEPTH_M = 200;
/** "Busy" or "very busy" -- the top quarter of covered water. */
const BUSY = 2;

let gridPromise: Promise<MaritimeActivityGrid> | null = null;

export function loadMaritimeActivity(): Promise<MaritimeActivityGrid> {
  if (!gridPromise) {
    gridPromise = fetch(assetUrl("data/maritime-activity.json"))
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load maritime-activity.json: ${res.status}`);
        return res.json() as Promise<MaritimeActivityFile>;
      })
      .then(async (meta) => {
        const res = await fetch(assetUrl(`data/${meta.binary}`));
        if (!res.ok) throw new Error(`Failed to load ${meta.binary}: ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const n = meta.rows * meta.cols;
        if (bytes.length !== n * 2) throw new Error(`${meta.binary} is ${bytes.length} bytes, expected ${n * 2}`);
        return {
          resolutionDeg: meta.resolutionDeg,
          rows: meta.rows,
          cols: meta.cols,
          extent: meta.extent,
          fishing: bytes.subarray(0, n),
          shipping: bytes.subarray(n),
          year: meta.source.year,
        };
      });
    gridPromise.catch(() => {
      gridPromise = null;
    });
  }
  return gridPromise;
}

/** Cell index for a point, or -1 outside the stored extent. */
function cellIndex(grid: MaritimeActivityGrid, lat: number, lng: number): number {
  const e = grid.extent;
  if (lat < e.minLat || lat >= e.maxLat || lng < e.minLng || lng >= e.maxLng) return -1;
  const row = Math.floor((lat - e.minLat) / grid.resolutionDeg);
  const col = Math.floor((lng - e.minLng) / grid.resolutionDeg);
  return row * grid.cols + col;
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
 * Fault exposure for a route's marine stretches (see landCrossings.marineParts:
 * an overland crossing is not at sea and is not measured here).
 */
export function assessFaultExposure(
  parts: [number, number][][],
  activity: MaritimeActivityGrid | null,
  ocean: OceanGrid
): FaultExposureAssessment {
  if (!activity) {
    return {
      available: false,
      reason:
        "The fishing and shipping dataset could not be loaded, so fault exposure cannot be assessed for this " +
        "route. Reported as unavailable, not as quiet water.",
    };
  }

  // Walked in short steps -- a quarter of a cell -- so no cell a segment
  // crosses is skipped; each step is attributed to the cell at its midpoint.
  const stepKm = (activity.resolutionDeg * 111.32) / 4;
  let totalKm = 0;
  let uncoveredKm = 0;
  let fishingKm = 0;
  let anchoringKm = 0;
  let exposedKm = 0;

  for (const part of parts) {
    for (let i = 0; i < part.length - 1; i++) {
      const [lat1, lng1] = part[i];
      const [lat2, lng2] = part[i + 1];
      const segKm = haversineKm(lat1, lng1, lat2, lng2);
      const steps = Math.max(1, Math.ceil(segKm / stepKm));
      for (let k = 0; k < steps; k++) {
        const [lat, lng] = interpolateLatLng(lat1, lng1, lat2, lng2, (k + 0.5) / steps);
        const km = segKm / steps;
        totalKm += km;
        const idx = cellIndex(activity, lat, lng);
        if (idx < 0 || activity.fishing[idx] === 0 || activity.shipping[idx] === 0) {
          uncoveredKm += km;
          continue;
        }
        // 0 means a land cell at 0.5 degrees: the coast, which is shallow.
        const depth = depthAt(ocean, lat, lng);
        const fishing = activity.fishing[idx] >= BUSY && depth <= FISHING_HAZARD_MAX_DEPTH_M;
        const anchoring = activity.shipping[idx] >= BUSY && depth <= ANCHORING_HAZARD_MAX_DEPTH_M;
        if (fishing) fishingKm += km;
        if (anchoring) anchoringKm += km;
        if (fishing || anchoring) exposedKm += km;
      }
    }
  }

  if (totalKm === 0) {
    return { available: false, reason: "Route geometry too short to assess fault exposure." };
  }
  const uncoveredShare = uncoveredKm / totalKm;
  // Strict, as for protected areas: a stretch nobody measured could be the
  // busiest water on the route.
  if (uncoveredShare > 0.02) {
    return {
      available: false,
      reason:
        `${Math.round(uncoveredShare * 100)}% of this route lies outside the fishing and shipping data, which ` +
        "covers European waters only (EMODnet). Fault exposure is reported as UNAVAILABLE rather than scored on " +
        "the covered part: the unmeasured water could be the busiest on the route.",
    };
  }

  const share = exposedKm / totalKm;
  return {
    available: true,
    reason:
      `${Math.round(exposedKm)} km of this route (${(share * 100).toFixed(1)}%) runs through water where cables ` +
      `are most often broken: ${Math.round(fishingKm)} km of busy fishing grounds shallower than ` +
      `${FISHING_HAZARD_MAX_DEPTH_M.toLocaleString()} m, and ${Math.round(anchoringKm)} km of busy cargo and tanker ` +
      `traffic shallower than ${ANCHORING_HAZARD_MAX_DEPTH_M} m, where anchors reach the seabed. Source: EMODnet ` +
      `vessel density (AIS, ${activity.year}), 0.25 degree cells; "busy" is the top quarter of covered water. ` +
      "Shipping traffic stands in for anchoring, which no dataset publishes.",
    fishingKm,
    anchoringKm,
    exposedKm,
    share,
  };
}
