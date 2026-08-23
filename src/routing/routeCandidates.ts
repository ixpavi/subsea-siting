// Deterministic A* shortest-path search over the real (rasterized) ocean
// grid, producing multiple materially different candidate marine routes by
// varying the edge-cost profile -- not by perturbing one path cosmetically.
//
// Why A*, not Dijkstra: the grid is a regular lat/lng lattice with a
// well-defined, always-admissible heuristic (great-circle distance to the
// goal -- every edge-cost multiplier in marineCostSurface.ts is >= 1.0, so
// straight-line distance never overestimates true remaining cost). That
// makes A* strictly better than plain Dijkstra here: same guaranteed-optimal
// result for whichever cost profile is active, far fewer nodes expanded.
import type { OceanGrid } from "./oceanGrid";
import { bandAt, colForLng, findNearestOceanCell, latForRow, lngForCol, rowForLat } from "./oceanGrid";
import { depthDifficultyMultiplier } from "./marineCostSurface";
import { buildCableProximityIndex, nearestCableDistanceKm, type CableProximityIndex } from "./cableProximityIndex";
import type { CableFeature } from "../types";
import type { RoutingProfileId } from "./routingTypes";

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const NEIGHBOR_OFFSETS: [number, number][] = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

/** Small binary min-heap keyed by fScore. */
class MinHeap<T> {
  private items: { key: number; value: T }[] = [];
  push(key: number, value: T) {
    this.items.push({ key, value });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].key <= this.items[i].key) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }
  pop(): T | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let smallest = i;
        if (l < this.items.length && this.items[l].key < this.items[smallest].key) smallest = l;
        if (r < this.items.length && this.items[r].key < this.items[smallest].key) smallest = r;
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
        i = smallest;
      }
    }
    return top.value;
  }
  get size() {
    return this.items.length;
  }
}

export interface RoutingProfile {
  id: RoutingProfileId;
  label: string;
  /** Compact all-caps display name for tight UI spaces (candidate rows, globe labels) -- e.g. "SHORTEST", "DEPTH-FAVORING". */
  shortName: string;
  description: string;
  edgeCost: (
    grid: OceanGrid,
    cableIndex: CableProximityIndex,
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number,
    toBand: number
  ) => number;
}

// --- Corridor-diversity weighting (MODELED) ---
//
// A previous version expressed this as
//   `Math.min(1.2, Math.max(0.7, 1.15 - nearestCableKm / 1700))`
// with a comment claiming "30% discount beyond 500km, 20% penalty within
// 50km". Neither figure matched the arithmetic (500km actually gave ~14%,
// 50km ~12%), and the 1.2 upper clamp was unreachable dead code since the
// expression's maximum is 1.15. The constants below reproduce the ORIGINAL
// behaviour exactly -- a linear ramp from 1.15 at zero separation down to
// 0.70 at 765km, flat thereafter -- restated as named values so the code is
// self-describing. No new coefficient has been introduced, because there is
// no evidence base that would justify choosing a different one.
/** Cost multiplier applied at zero separation from an existing cable: shadowing an existing corridor is discouraged. */
const CORRIDOR_SHADOW_FACTOR = 1.15;
/** Cost multiplier applied at or beyond DIVERSITY_SATURATION_KM: full diversity reward. */
const DIVERSITY_REWARD_FACTOR = 0.7;
/** Separation at which the diversity reward saturates. */
const DIVERSITY_SATURATION_KM = 765;

/** Linear ramp CORRIDOR_SHADOW_FACTOR -> DIVERSITY_REWARD_FACTOR over 0..DIVERSITY_SATURATION_KM, constant outside that range. */
export function corridorDiversityFactor(nearestCableKm: number): number {
  const t = Math.min(1, Math.max(0, nearestCableKm / DIVERSITY_SATURATION_KM));
  return CORRIDOR_SHADOW_FACTOR + t * (DIVERSITY_REWARD_FACTOR - CORRIDOR_SHADOW_FACTOR);
}

export const ROUTING_PROFILES: RoutingProfile[] = [
  {
    id: "shortest",
    label: "Shortest Marine Path",
    shortName: "SHORTEST",
    description: "Minimizes raw marine distance only; depth and existing-cable corridors are not factored in.",
    edgeCost: (_grid, _idx, flat, flng, tlat, tlng) => haversineKm(flat, flng, tlat, tlng),
  },
  {
    id: "shallow-favoring",
    label: "Depth-Favorable Path",
    shortName: "DEPTH-FAVORING",
    description:
      "Minimizes marine distance weighted by a modeled seabed-difficulty penalty (see marineCostSurface.ts) -- prefers continental-shelf/slope depths over deep trenches where a detour is small.",
    edgeCost: (_grid, _idx, flat, flng, tlat, tlng, toBand) =>
      haversineKm(flat, flng, tlat, tlng) * depthDifficultyMultiplier(toBand),
  },
  {
    id: "diverse-corridor",
    label: "Diverse-Corridor Path",
    shortName: "DIVERSITY-SEEKING",
    description:
      "Minimizes marine distance weighted by depth difficulty AND a modeled bonus for staying away from existing real cable corridors (physical route diversity) -- see cableProximityIndex.ts.",
    edgeCost: (_grid, idx, flat, flng, tlat, tlng, toBand) => {
      const base = haversineKm(flat, flng, tlat, tlng) * depthDifficultyMultiplier(toBand);
      // 4 rings at the index's 2-degree buckets covers ~890km, past
      // DIVERSITY_SATURATION_KM -- beyond saturation every distance yields the
      // same factor, so searching farther cannot change the edge cost.
      const nearestCableKm = nearestCableDistanceKm(idx, tlat, tlng, 4);
      return base * corridorDiversityFactor(nearestCableKm);
    },
  },
];

interface AStarResult {
  cells: { row: number; col: number }[];
  found: boolean;
}

const MAX_VISITED_NODES = 220000;

function runAStar(
  grid: OceanGrid,
  cableIndex: CableProximityIndex,
  profile: RoutingProfile,
  start: { lat: number; lng: number },
  goal: { lat: number; lng: number }
): AStarResult {
  // A resolved marine endpoint (especially a real landing point, which sits
  // exactly on the coast) very often falls inside a "land" grid cell at this
  // engine's 0.5° resolution -- neighbor expansion below never allows a land
  // cell into the graph, so searching from/to the literal requested cell
  // would make the goal permanently unreachable. Snap the INTERNAL search
  // endpoints to the nearest real ocean cell; the exact requested coordinate
  // is still what's stitched onto the start/end of the final path (see
  // generateRouteCandidates below), so this only affects pathfinding, not
  // the reported endpoint location.
  const snappedStart = bandAt(grid, start.lat, start.lng) > 0 ? start : findNearestOceanCell(grid, start.lat, start.lng) ?? start;
  const snappedGoal = bandAt(grid, goal.lat, goal.lng) > 0 ? goal : findNearestOceanCell(grid, goal.lat, goal.lng) ?? goal;

  const startRow = rowForLat(grid, snappedStart.lat);
  const startCol = colForLng(grid, snappedStart.lng);
  const goalRow = rowForLat(grid, snappedGoal.lat);
  const goalCol = colForLng(grid, snappedGoal.lng);
  const goalLat = latForRow(grid, goalRow);
  const goalLng = lngForCol(grid, goalCol);

  const startKey = startRow * grid.cols + startCol;
  const goalKey = goalRow * grid.cols + goalCol;

  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  gScore.set(startKey, 0);

  const heap = new MinHeap<number>();
  heap.push(0, startKey);
  const closed = new Set<number>();
  let visited = 0;

  while (heap.size > 0) {
    const currentKey = heap.pop()!;
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);
    visited++;
    if (currentKey === goalKey) break;
    if (visited > MAX_VISITED_NODES) break;

    const row = Math.floor(currentKey / grid.cols);
    const col = currentKey % grid.cols;
    const lat = latForRow(grid, row);
    const lng = lngForCol(grid, col);
    const currentG = gScore.get(currentKey)!;

    for (const [dr, dc] of NEIGHBOR_OFFSETS) {
      const nRow = row + dr;
      if (nRow < 0 || nRow >= grid.rows) continue;
      const nCol = ((col + dc) % grid.cols + grid.cols) % grid.cols;
      const nBand = bandAt(grid, latForRow(grid, nRow), lngForCol(grid, nCol));
      if (nBand === 0) continue; // land -- never routed through
      const nKey = nRow * grid.cols + nCol;
      if (closed.has(nKey)) continue;

      const nLat = latForRow(grid, nRow);
      const nLng = lngForCol(grid, nCol);
      const cost = profile.edgeCost(grid, cableIndex, lat, lng, nLat, nLng, nBand);
      const tentativeG = currentG + cost;
      const existing = gScore.get(nKey);
      if (existing === undefined || tentativeG < existing) {
        gScore.set(nKey, tentativeG);
        cameFrom.set(nKey, currentKey);
        const h = haversineKm(nLat, nLng, goalLat, goalLng);
        heap.push(tentativeG + h, nKey);
      }
    }
  }

  if (!gScore.has(goalKey) || !closed.has(goalKey)) {
    return { cells: [], found: false };
  }

  const cells: { row: number; col: number }[] = [];
  let cur: number | undefined = goalKey;
  while (cur !== undefined) {
    cells.unshift({ row: Math.floor(cur / grid.cols), col: cur % grid.cols });
    if (cur === startKey) break;
    cur = cameFrom.get(cur);
  }
  return { cells, found: true };
}

/** Perpendicular-distance path simplification (Douglas-Peucker) in plain lat/lng space -- fine at the scale of a routing-grid path (no antimeridian-sensitive precision needed here, unlike cableHitTest.ts's pixel-level work). */
function simplifyPath(points: [number, number][], toleranceDeg: number): [number, number][] {
  if (points.length <= 2) return points;

  function perpendicularDistance(p: [number, number], a: [number, number], b: [number, number]): number {
    const [px, py] = [p[1], p[0]];
    const [ax, ay] = [a[1], a[0]];
    const [bx, by] = [b[1], b[0]];
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function rdp(pts: [number, number][]): [number, number][] {
    if (pts.length <= 2) return pts;
    let maxDist = -1;
    let index = -1;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = perpendicularDistance(pts[i], pts[0], pts[pts.length - 1]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > toleranceDeg) {
      const left = rdp(pts.slice(0, index + 1));
      const right = rdp(pts.slice(index));
      return [...left.slice(0, -1), ...right];
    }
    return [pts[0], pts[pts.length - 1]];
  }

  return rdp(points);
}

export interface CandidateGeometry {
  profile: RoutingProfile;
  path: [number, number][]; // simplified, includes exact marine start/end
  found: boolean;
}

let cachedCableIndex: { cables: CableFeature[]; index: CableProximityIndex } | null = null;
/**
 * Shared, memoized cable-proximity index. Exported because the resilience
 * pass needs the SAME instance the A* search used: building it is the single
 * most expensive step in a routing run, and sharing it also shares its query
 * cache between pathfinding and scoring.
 */
export function getCableProximityIndex(cables: CableFeature[]): CableProximityIndex {
  if (cachedCableIndex?.cables === cables) return cachedCableIndex.index;
  const index = buildCableProximityIndex(cables);
  cachedCableIndex = { cables, index };
  return index;
}

/** Runs all three routing profiles between two marine endpoints and returns their (simplified, deterministic) geometries. */
export function generateRouteCandidates(
  grid: OceanGrid,
  cables: CableFeature[],
  marineStart: { lat: number; lng: number },
  marineEnd: { lat: number; lng: number }
): CandidateGeometry[] {
  const cableIndex = getCableProximityIndex(cables);
  return ROUTING_PROFILES.map((profile) => {
    const result = runAStar(grid, cableIndex, profile, marineStart, marineEnd);
    if (!result.found) return { profile, path: [], found: false };
    const gridPoints: [number, number][] = result.cells.map((c) => [latForRow(grid, c.row), lngForCol(grid, c.col)]);
    // Snap the endpoints to the exact requested marine coordinates rather than the grid cell center, so the route visibly starts/ends at the resolved endpoint.
    const full: [number, number][] = [[marineStart.lat, marineStart.lng], ...gridPoints.slice(1, -1), [marineEnd.lat, marineEnd.lng]];
    const simplified = simplifyPath(full, grid.resolutionDeg * 0.4);
    return { profile, path: simplified, found: true };
  });
}
