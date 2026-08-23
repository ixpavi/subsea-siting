// Grid clustering for the bulk facility layers.
//
// TWO PROBLEMS, ONE FIX. The dataset is 5,260 land facilities. Zoomed out they
// are geometry the GPU builds and the user cannot read -- Northern Virginia,
// London and Frankfurt are each a solid blob where individual points stopped
// being distinguishable long before they stopped being drawn. Horizon culling
// already removed the ones behind the planet; this removes the ones that are
// visible but indistinguishable.
//
// WHAT A CLUSTER MAY AND MAY NOT CLAIM. A cluster is drawn at the MEAN position
// of its members and labelled with its count. It is not a facility and must
// never be presented as one: at low zoom "37 facilities in this area" is both
// true and useful, while a single marker standing in for 37 would be a
// fabricated location. The count is what makes the abstraction honest.
//
// CLUSTERING SWITCHES OFF AS YOU APPROACH. The cell size shrinks with camera
// altitude, so zooming in progressively breaks clusters apart until every
// facility is its own marker again. A user who zooms to a city sees the real
// individual sites, which is the only level at which a specific position means
// anything.

export interface Clusterable {
  lat: number;
  lng: number;
}

export interface Cluster<T extends Clusterable> {
  lat: number;
  lng: number;
  /** The facilities this marker stands for. Length 1 means it IS the facility. */
  members: T[];
  /** Stable across renders for the same cell, so React keys do not thrash. */
  key: string;
}

/**
 * Cell size in degrees for a given camera altitude.
 *
 * Tuned so that clusters cover roughly a constant amount of SCREEN space: at
 * the default altitude a cell is a few degrees, and by the time the camera is
 * close it is small enough that distinct facilities in the same city separate.
 * Returns 0 to mean "do not cluster at all".
 */
export function clusterCellDeg(altitude: number): number {
  if (altitude <= 0.35) return 0; // close in: show every facility individually
  if (altitude <= 0.7) return 0.25;
  if (altitude <= 1.2) return 0.6;
  if (altitude <= 1.8) return 1.2;
  return 2.5;
}

/**
 * Groups points into a longitude/latitude grid.
 *
 * Grid clustering rather than distance-based (k-means, DBSCAN) because it is
 * O(n), deterministic, and stable under camera movement: the same facility
 * always lands in the same cell for a given zoom, so markers do not reshuffle
 * as the user rotates. A distance-based method would look slightly better and
 * would make markers jump around, which on a globe is worse.
 *
 * KNOWN LIMITATION -- CELL BOUNDARIES. Two facilities a few km apart land in
 * different clusters if a cell edge runs between them. London is a real
 * example: at a 2.5 degree cell size the boundary falls on the prime meridian,
 * so sites at -0.1 and +0.0 degrees do not merge. This is inherent to grid
 * clustering, not a defect to be tuned away, and it is harmless here because
 * the counts stay correct and the split disappears as the user zooms in.
 * Removing it would mean a distance-based method and the marker instability
 * that comes with it.
 */
export function clusterPoints<T extends Clusterable>(
  points: readonly T[],
  cellDeg: number
): Cluster<T>[] {
  if (cellDeg <= 0) {
    return points.map((p, i) => ({ lat: p.lat, lng: p.lng, members: [p], key: `p${i}` }));
  }

  const cells = new Map<string, T[]>();
  for (const p of points) {
    // Longitude wraps, so the cell index must too, or the antimeridian gets a
    // seam of half-width cells that never merge with their neighbours.
    const row = Math.floor((p.lat + 90) / cellDeg);
    const wrappedLng = ((p.lng + 180) % 360 + 360) % 360;
    const col = Math.floor(wrappedLng / cellDeg);
    const key = `${row}:${col}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(p);
    else cells.set(key, [p]);
  }

  const out: Cluster<T>[] = [];
  for (const [key, members] of cells) {
    if (members.length === 1) {
      // A lone facility keeps its exact position. Snapping it to a cell mean
      // would move a real, known location for no benefit at all.
      out.push({ lat: members[0].lat, lng: members[0].lng, members, key });
      continue;
    }
    // Mean position via unit vectors, for the same reason the camera framing
    // uses them: a cell straddling the antimeridian would otherwise average to
    // the opposite side of the planet.
    let x = 0, y = 0, z = 0;
    for (const p of members) {
      const latR = (p.lat * Math.PI) / 180;
      const lngR = (p.lng * Math.PI) / 180;
      const cosLat = Math.cos(latR);
      x += cosLat * Math.cos(lngR);
      y += cosLat * Math.sin(lngR);
      z += Math.sin(latR);
    }
    const n = members.length;
    x /= n; y /= n; z /= n;
    const hyp = Math.hypot(x, y);
    const lat = (Math.atan2(z, hyp) * 180) / Math.PI;
    const lng = (Math.atan2(y, x) * 180) / Math.PI;
    out.push({ lat, lng, members, key });
  }

  // Deterministic order so React reconciliation and any downstream indexing
  // stay stable between renders.
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

/** Marker radius multiplier for a cluster. Grows with the log of the count so
 *  a 500-member cluster is visibly larger than a 5-member one without being a
 *  hundred times the size. */
export function clusterRadiusScale(count: number): number {
  if (count <= 1) return 1;
  return 1 + Math.min(1.6, Math.log10(count) * 0.9);
}
