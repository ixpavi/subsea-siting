// Overland crossings: the two places real cables leave the sea, cross land,
// and carry on in another sea.
//
// WHY THEY ARE NEEDED. The ocean grid treats canals as land, correctly -- a
// cable cannot be laid along a working shipping canal. But real systems do not
// sail round Africa or South America either. Between the Red Sea and the
// Mediterranean they come ashore and cross Egypt by land: SeaMeWe-5 lands at
// Zafarana on the Gulf of Suez and at Abu Talat on the Mediterranean, and
// AAE-1, 2Africa and others cross the same way. Across the Isthmus of Panama,
// systems such as ARCOS-1 and PAN-AM land on both coasts and join by land.
// Without these links a Chennai -> New York route was drawn round the Cape of
// Good Hope, thousands of kilometres longer than any real cable would run.
//
// HOW THEY ARE MODELLED. Each crossing is a single link between two ocean cells
// of the routing grid, one on each coast, that the A* search may use like any
// other step. Its length is the straight-line distance between those cells;
// it is reported as an OVERLAND crossing -- counted in the total connection
// distance, like terrestrial access, but never as marine route, never costed
// as marine cable, and never sampled for seabed depth. The two ends are grid
// cells, not surveyed landing sites.
import type { OceanGrid } from "./oceanGrid";
import { colForLng, latForRow, lngForCol, rowForLat } from "./oceanGrid";

export interface LandCrossing {
  id: "egypt" | "panama";
  name: string;
  /** Ocean-cell centres at each end. Both must be water connected to the open ocean. */
  a: { lat: number; lng: number };
  b: { lat: number; lng: number };
  /** Real systems that make this crossing -- what the model is standing in for. */
  basis: string;
}

export const LAND_CROSSINGS: LandCrossing[] = [
  {
    id: "egypt",
    name: "Egypt overland (Gulf of Suez to Port Said)",
    // The upper Gulf of Suez is sealed off at this grid's 0.5 degree resolution,
    // so the southern end is the northernmost Gulf cell that is open water.
    a: { lat: 28.25, lng: 33.25 },
    b: { lat: 31.25, lng: 32.25 },
    basis:
      "Red Sea to Mediterranean systems cross Egypt by land -- SeaMeWe-5 lands at Zafarana and Abu Talat, and " +
      "AAE-1 and 2Africa cross the same way.",
  },
  {
    id: "panama",
    name: "Panama overland (Caribbean to Gulf of Panama)",
    a: { lat: 9.75, lng: -79.75 },
    b: { lat: 8.75, lng: -79.25 },
    basis: "Caribbean to Pacific systems cross the isthmus by land, as ARCOS-1 and PAN-AM do.",
  },
];

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** One direction of a crossing, as the search sees it. */
export interface CrossingLink {
  toKey: number;
  km: number;
  crossing: LandCrossing;
}

const linkCache = new WeakMap<OceanGrid, Map<number, CrossingLink[]>>();

/**
 * Crossing links by grid-cell key, in both directions.
 *
 * A crossing whose ends are not both water in this grid is left out rather
 * than linked into land, so a regenerated grid can never gain a link that
 * starts or ends on land.
 */
export function crossingLinks(grid: OceanGrid): Map<number, CrossingLink[]> {
  const cached = linkCache.get(grid);
  if (cached) return cached;
  const links = new Map<number, CrossingLink[]>();
  const keyOf = (p: { lat: number; lng: number }) => rowForLat(grid, p.lat) * grid.cols + colForLng(grid, p.lng);
  const add = (from: number, link: CrossingLink) => {
    const list = links.get(from);
    if (list) list.push(link);
    else links.set(from, [link]);
  };
  for (const crossing of LAND_CROSSINGS) {
    const ka = keyOf(crossing.a);
    const kb = keyOf(crossing.b);
    if (grid.depthM[ka] === 0 || grid.depthM[kb] === 0) continue;
    const rowA = Math.floor(ka / grid.cols);
    const rowB = Math.floor(kb / grid.cols);
    const km = haversineKm(
      latForRow(grid, rowA),
      lngForCol(grid, ka % grid.cols),
      latForRow(grid, rowB),
      lngForCol(grid, kb % grid.cols)
    );
    add(ka, { toKey: kb, km, crossing });
    add(kb, { toKey: ka, km, crossing });
  }
  linkCache.set(grid, links);
  return links;
}

/** A crossing a route actually uses: the segment path[fromIndex] -> path[fromIndex + 1]. */
export interface RouteCrossing {
  id: LandCrossing["id"];
  name: string;
  km: number;
  fromIndex: number;
}

/**
 * The route's marine stretches: its path with every overland crossing cut out.
 * Everything that measures the SEA -- depth, cable proximity, protected areas,
 * fishing and shipping -- reads these, never the crossing itself.
 *
 * One stretch per gap between crossings, in path order, so stretch i is
 * followed by crossing i. A stretch can be a single point, when a route starts
 * or ends right at a crossing; callers that need segments skip those.
 */
export function marineParts(path: [number, number][], crossings: RouteCrossing[] = []): [number, number][][] {
  if (crossings.length === 0) return [path];
  const parts: [number, number][][] = [];
  let start = 0;
  for (const c of [...crossings].sort((x, y) => x.fromIndex - y.fromIndex)) {
    parts.push(path.slice(start, c.fromIndex + 1));
    start = c.fromIndex + 1;
  }
  parts.push(path.slice(start));
  return parts;
}
