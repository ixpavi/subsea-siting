// Corridor candidates from TeleGeography's 724 cable systems, instead of the
// 412-route EMODnet corpus.
//
// WHY. The long-haul prediction result rests on corridor distance measured
// against corpus routes only -- and the corpus is six European hydrographic
// offices. For a transatlantic route the non-same-agency candidates are a
// handful of cables, so the corridor term saturates over most of the ocean and
// the signal it does carry comes from a thin, geographically lopsided set.
// TeleGeography catalogues essentially every commercial system worldwide. If
// the effect survives a proper candidate set it is much harder to argue with.
//
// TWO PROBLEMS HAD TO BE SOLVED, and the second is the one that matters.
//
// 1. GEOMETRY IS COARSE. TeleGeography carries 7.3 vertices per 1,000 km, a
//    median segment of 69 km and a longest of 5,650 km. corridorIndex.mjs
//    measures distance to the nearest VERTEX, which on a 69 km segment can
//    read 34 km for a point sitting exactly on the line. So paths are
//    densified to ~2 km before indexing.
//
//    This does not recover the real route. A densified chord is still a
//    chord, and the study's own Section 1.1 is about exactly that: "a 5,650 km
//    straight line is not a route." Corridor distance computed here is
//    distance to TeleGeography's SCHEMATIC of a cable, not to the cable. The
//    error is unbiased in direction but real in magnitude, and it makes this a
//    NOISIER instrument than the corpus-based one, not a better one. It is
//    worth running because it is a far more REPRESENTATIVE one.
//
// 2. THE SUBJECT CABLE IS IN THE CANDIDATE SET. The corpus routes are real
//    cables; TeleGeography catalogues real cables; so the cable being
//    predicted is almost certainly present as a TeleGeography system. A router
//    that can see it traces it and scores perfectly, measuring nothing. The
//    corpus version handled this with a same-agency exclusion, which has no
//    analogue here -- TeleGeography is one global publisher with no agency
//    structure to exclude on.
//
//    So exclusion is GEOMETRIC: a system is dropped when it shadows the
//    subject, i.e. when more than `fraction` of the subject's sample points lie
//    within `radiusKm` of it. Name matching was rejected as the primary
//    instrument because corpus properties carry names for only some sources and
//    the two datasets do not share a naming convention -- an exclusion that
//    silently fails on unnamed routes is worse than none.
//
//    The radius is swept rather than chosen. A co-laid twin at 3 km and the
//    subject's own duplicate are indistinguishable by geometry alone, so a
//    larger radius discards genuine corridor-mates along with the leak. Watching
//    the effect across the sweep is what separates "corridor reuse" from "the
//    router found itself" -- the same logic as the trim sweep in
//    analyse-corridor-endpoint-control.mjs.
import { haversineKm, interpolateGreatCircle } from "./bathyGrid.mjs";

const BUCKET_DEG = 0.5;
/** Densification target. Comfortably below the 25 km corridor saturation
 *  scale, so quantisation cannot move a cell across the saturation boundary. */
const STEP_KM = 2;

/**
 * @param cables TeleGeography records: { id, name, paths: [[[lng,lat],...],...] }
 * @returns index with per-point system ids
 */
export function buildTgIndex(cables) {
  const buckets = new Map();
  const names = [];
  let points = 0;
  let rawVertices = 0;

  for (let si = 0; si < cables.length; si++) {
    const c = cables[si];
    names.push(c.name ?? c.id ?? `system-${si}`);
    for (const path of c.paths ?? []) {
      rawVertices += path.length;
      for (let i = 1; i < path.length; i++) {
        // public/data/cables.json stores [lat, lng] -- the opposite order to
        // the EMODnet corpus, which is [lng, lat]. Reading it as [lng, lat]
        // transposes every cable (a point off Brittany lands in the Sahara),
        // and the failure is silent: the index still builds, still answers
        // queries, and simply reports that no cable is anywhere near any
        // route. Confirmed from the data: dim0 spans -55..79, dim1 spans
        // -180..180.
        const [lat1, lng1] = path[i - 1];
        const [lat2, lng2] = path[i];
        const d = haversineKm(lat1, lng1, lat2, lng2);
        // Antimeridian segments are detected by the LONGITUDE JUMP, which is
        // their actual signature, not by great-circle length.
        //
        // The first version of this guard dropped any segment over 3,000 km.
        // TeleGeography's longest single segment is 5,650 km, so that silently
        // discarded exactly the trans-oceanic chords this index exists to
        // supply -- and the measurement that followed reported no TeleGeography
        // cable within 150 km of a transatlantic route, which was an artefact
        // of the guard rather than a fact about the data.
        if (!Number.isFinite(d) || d === 0) continue;
        if (Math.abs(lng2 - lng1) > 180) continue;
        const n = Math.max(1, Math.ceil(d / STEP_KM));
        for (let k = 0; k < n; k++) {
          const [lat, lng] = interpolateGreatCircle(lat1, lng1, lat2, lng2, k / n);
          const key = `${Math.floor(lat / BUCKET_DEG)}:${Math.floor(lng / BUCKET_DEG)}`;
          let b = buckets.get(key);
          if (!b) { b = []; buckets.set(key, b); }
          b.push(lat, lng, si);
          points++;
        }
      }
    }
  }
  return { buckets, names, systemCount: cables.length, points, rawVertices, stepKm: STEP_KM };
}

/** Min distance from one point to each system within the searched rings.
 *  Returns a Map systemIndex -> km. */
function perSystemDistances(index, lat, lng, rings = 3) {
  const out = new Map();
  const r0 = Math.floor(lat / BUCKET_DEG);
  const c0 = Math.floor(lng / BUCKET_DEG);
  for (let ring = 0; ring <= rings; ring++) {
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const b = index.buckets.get(`${r0 + dr}:${c0 + dc}`);
        if (!b) continue;
        for (let i = 0; i < b.length; i += 3) {
          const d = haversineKm(lat, lng, b[i], b[i + 1]);
          const si = b[i + 2];
          const prev = out.get(si);
          if (prev === undefined || d < prev) out.set(si, d);
        }
      }
    }
  }
  return out;
}

/**
 * Systems that shadow this route closely enough to be it, or a twin of it.
 *
 * @param sampleCoords subject route as [lat, lng] pairs, already thinned.
 * @param radiusKm     how near counts as shadowing.
 * @param fraction     share of the subject's samples that must be shadowed.
 */
export function shadowingSystems(index, sampleCoords, radiusKm, fraction = 0.5) {
  const hits = new Map();
  for (const [lat, lng] of sampleCoords) {
    const per = perSystemDistances(index, lat, lng, 2);
    for (const [si, d] of per) {
      if (d <= radiusKm) hits.set(si, (hits.get(si) ?? 0) + 1);
    }
  }
  const need = sampleCoords.length * fraction;
  const excluded = new Set();
  for (const [si, n] of hits) if (n >= need) excluded.add(si);
  return excluded;
}

/**
 * The k systems that track this route most closely, by median distance along
 * it. This is the exclusion instrument that actually works on this data.
 *
 * A fixed radius cannot do the job: measured across the corpus, the
 * best-matching TeleGeography system sits at a median of 12.3 km from a
 * 40-500 km subject and 44.3 km at 2,000+ km, and no subject anywhere has a
 * system within 5 km. A radius small enough to mean "this is the same cable"
 * therefore excludes nothing, and one large enough to fire discards half the
 * ocean's genuine corridor-mates with it.
 *
 * Ranking by how closely a system shadows the subject and dropping the top k
 * targets the leak directly: whatever TeleGeography's entry for the subject
 * cable is, it is the thing most likely to sit at rank 1.
 *
 * @param minCoverage a system must be seen near at least this share of the
 *        subject's samples to be ranked at all -- otherwise a cable that
 *        crosses the route once, perpendicular, can win on a single sample.
 */
export function bestMatchingSystems(index, sampleCoords, k, minCoverage = 0.6) {
  const per = new Map();
  for (const [lat, lng] of sampleCoords) {
    for (const [si, d] of perSystemDistances(index, lat, lng, 2)) {
      let arr = per.get(si);
      if (!arr) { arr = []; per.set(si, arr); }
      arr.push(d);
    }
  }
  const need = sampleCoords.length * minCoverage;
  const ranked = [];
  for (const [si, arr] of per) {
    if (arr.length < need) continue;
    const s = arr.slice().sort((a, b) => a - b);
    ranked.push({ si, medianKm: s[s.length >> 1] });
  }
  ranked.sort((a, b) => a.medianKm - b.medianKm);
  return {
    excluded: new Set(ranked.slice(0, k).map((r) => r.si)),
    ranked: ranked.slice(0, Math.max(k, 5)),
  };
}

/**
 * Corridor distance function over TeleGeography, excluding a given set of
 * systems. Memoised per quantised point, as A* revisits cells constantly.
 */
export function tgCorridorDistanceFor(index, excludedSystems) {
  const memo = new Map();
  /** Quantised to ~2 km. The corridor term saturates at 25 km and the
   *  underlying TeleGeography geometry is itself schematic at the scale of
   *  tens of km, so finer memo keys buy no accuracy and cost a great deal:
   *  this function is called once per A* neighbour expansion, and a 6,400 km
   *  route expands over two million cells. */
  const qk = (lat, lng) => `${Math.round(lat * 50)}:${Math.round(lng * 50)}`;

  return (lat, lng) => {
    const key = qk(lat, lng);
    const hit = memo.get(key);
    if (hit !== undefined) return hit;

    let best = Infinity;
    const r0 = Math.floor(lat / BUCKET_DEG);
    const c0 = Math.floor(lng / BUCKET_DEG);
    for (let ring = 0; ring <= 3; ring++) {
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          const b = index.buckets.get(`${r0 + dr}:${c0 + dc}`);
          if (!b) continue;
          for (let i = 0; i < b.length; i += 3) {
            if (excludedSystems.has(b[i + 2])) continue;
            const d = haversineKm(lat, lng, b[i], b[i + 1]);
            if (d < best) best = d;
          }
        }
      }
      if (best < (ring - 1) * BUCKET_DEG * 111) break;
    }
    const out = Number.isFinite(best) ? best : 999;
    memo.set(key, out);
    return out;
  };
}
