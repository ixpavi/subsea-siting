// Who is already active where a new cable would land: the companies that own
// the existing cables near each end, the companies that built them, and the
// data-centre operators near the site.
//
// WHY. Nobody lays a long-haul cable alone. It is financed and owned by a
// consortium of carriers and cloud companies, built by one of a handful of
// manufacturer-installers, and lands at stations those carriers already run.
// So the useful question for a planner is not only "where would the cable go"
// but "who is already here" -- the likely partners at each end, and in
// particular anyone present at BOTH ends, who already has a reason to want the
// link.
//
// WHAT THIS IS NOT. Owning a cable near a city is not an offer to build a new
// one. These are the companies active in the area, taken from each nearby
// cable's own record; the UI says so, and never ranks or recommends them.
//
// SOURCES. Owners, suppliers and ready-for-service years: TeleGeography
// Submarine Cable Map, one record per cable (scripts/fetch-cable-details.mjs),
// CC BY-NC-SA 3.0. Data-centre operators: PeeringDB facilities, already shipped.
import { assetUrl } from "../assetUrl";
import type { CableFeature, LandDC, LandingPoint } from "../types";
import { analyzeConnectivity, type ConnectivityAnalysis, type RelevantLandingPoint } from "./connectivityAnalysis";

export interface CableDetail {
  owners: string[];
  /** The manufacturer-installers that built the system. */
  suppliers: string[];
  rfsYear: number | null;
  planned: boolean;
  lengthKm: number | null;
  url: string | null;
}

export interface CableDetailsFile {
  fetchedAt: string;
  source: string;
  licence: string;
  cables: Record<string, CableDetail>;
}

let detailsPromise: Promise<CableDetailsFile> | null = null;

export function loadCableDetails(): Promise<CableDetailsFile> {
  if (!detailsPromise) {
    detailsPromise = fetch(assetUrl("data/cable-details.json")).then((res) => {
      if (!res.ok) throw new Error(`Failed to load cable-details.json: ${res.status}`);
      return res.json() as Promise<CableDetailsFile>;
    });
    detailsPromise.catch(() => {
      detailsPromise = null;
    });
  }
  return detailsPromise;
}

export interface ProviderEntry {
  name: string;
  /** The nearby cables this company owns or built, by name. */
  cables: { name: string; planned: boolean }[];
}

export interface OperatorEntry {
  name: string;
  facilities: number;
}

export interface ProviderSummary {
  /** Owners with a cable near the site AND a cable near the destination. */
  bothEnds: ProviderEntry[];
  /** Owners with a cable near the site (excluding bothEnds). */
  nearSite: ProviderEntry[];
  /** Owners with a cable near the destination (excluding bothEnds). */
  nearDestination: ProviderEntry[];
  /** Companies that built the nearby cables. */
  builders: ProviderEntry[];
  dcOperatorsNearSite: OperatorEntry[];
  dcOperatorsNearDestination: OperatorEntry[];
  /** Nearby cables with no detail record, so their owners are unknown. */
  cablesWithoutRecord: number;
  /** False when the owner data could not be loaded at all. */
  ownersAvailable: boolean;
  /** Radius used for data-centre operators. */
  dcRadiusKm: number;
  /**
   * When no cable lands within the search radius of an end, its owners are
   * read at that end's nearest landing point instead, and this names it --
   * the station a new cable from an inland site would actually reach.
   */
  siteAnchor: { name: string; distanceKm: number } | null;
  destinationAnchor: { name: string; distanceKm: number } | null;
}

/** Data centres within this distance count as "near". About a metro area. */
export const DC_OPERATOR_RADIUS_KM = 50;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Most cables first, then alphabetical. */
function sortEntries(entries: Map<string, ProviderEntry>): ProviderEntry[] {
  return [...entries.values()].sort((a, b) => b.cables.length - a.cables.length || a.name.localeCompare(b.name));
}

function operatorsNear(landDCs: LandDC[], point: { lat: number; lng: number } | null): OperatorEntry[] {
  if (!point) return [];
  const counts = new Map<string, number>();
  for (const dc of landDCs) {
    if (!dc.org || haversineKm(point.lat, point.lng, dc.lat, dc.lng) > DC_OPERATOR_RADIUS_KM) continue;
    counts.set(dc.org, (counts.get(dc.org) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, facilities]) => ({ name, facilities }))
    .sort((a, b) => b.facilities - a.facilities || a.name.localeCompare(b.name));
}

/**
 * @param analysis where the cables are read from.
 * @param places where data-centre operators are looked for, when different
 *   from the analysis points (see providersForPlan).
 */
export function summarizeProviders(
  analysis: ConnectivityAnalysis,
  details: CableDetailsFile | null,
  landDCs: LandDC[],
  places: {
    site?: { lat: number; lng: number };
    destination?: { lat: number; lng: number } | null;
    siteAnchor?: ProviderSummary["siteAnchor"];
    destinationAnchor?: ProviderSummary["destinationAnchor"];
  } = {}
): ProviderSummary {
  const siteOwners = new Map<string, ProviderEntry>();
  const destOwners = new Map<string, ProviderEntry>();
  const builders = new Map<string, ProviderEntry>();
  let cablesWithoutRecord = 0;

  const add = (map: Map<string, ProviderEntry>, name: string, cable: { name: string; planned: boolean }) => {
    const entry = map.get(name) ?? { name, cables: [] };
    if (!entry.cables.some((c) => c.name === cable.name)) entry.cables.push(cable);
    map.set(name, entry);
  };

  for (const cable of analysis.relevantCables) {
    const record = details?.cables[cable.id];
    if (!record) {
      cablesWithoutRecord++;
      continue;
    }
    const ref = { name: cable.name, planned: record.planned };
    for (const owner of record.owners) {
      if (cable.sourceLandingPoints.length > 0) add(siteOwners, owner, ref);
      if (cable.destinationLandingPoints.length > 0) add(destOwners, owner, ref);
    }
    for (const supplier of record.suppliers) add(builders, supplier, ref);
  }

  const bothEnds = new Map<string, ProviderEntry>();
  for (const [name, site] of siteOwners) {
    const dest = destOwners.get(name);
    if (!dest) continue;
    const merged: ProviderEntry = { name, cables: [...site.cables] };
    for (const c of dest.cables) if (!merged.cables.some((x) => x.name === c.name)) merged.cables.push(c);
    bothEnds.set(name, merged);
  }
  for (const name of bothEnds.keys()) {
    siteOwners.delete(name);
    destOwners.delete(name);
  }

  return {
    bothEnds: sortEntries(bothEnds),
    nearSite: sortEntries(siteOwners),
    nearDestination: sortEntries(destOwners),
    builders: sortEntries(builders),
    dcOperatorsNearSite: operatorsNear(landDCs, places.site ?? analysis.source),
    dcOperatorsNearDestination: operatorsNear(
      landDCs,
      places.destination !== undefined ? places.destination : analysis.destination
    ),
    cablesWithoutRecord,
    ownersAvailable: details != null,
    dcRadiusKm: DC_OPERATOR_RADIUS_KM,
    siteAnchor: places.siteAnchor ?? null,
    destinationAnchor: places.destinationAnchor ?? null,
  };
}

/**
 * Providers for a planning session.
 *
 * An inland site has no cable within the search radius -- Bengaluru's nearest
 * landing point is Chennai, 288 km away -- so reading owners at the site itself
 * would list nobody, when the companies that matter are the ones at the coast
 * the site would connect through. For such an end the cables are read at its
 * nearest landing point instead, and the summary says which one. Data-centre
 * operators are still looked for around the real site.
 */
export function providersForPlan(
  connectivity: ConnectivityAnalysis,
  cables: CableFeature[],
  landingPoints: LandingPoint[],
  details: CableDetailsFile | null,
  landDCs: LandDC[]
): ProviderSummary {
  const anchorOf = (end: { landingPoints: RelevantLandingPoint[]; nearestLandingPoints: RelevantLandingPoint[] }) =>
    end.landingPoints.length > 0 ? null : (end.nearestLandingPoints[0] ?? null);
  const site = { lat: connectivity.source.lat, lng: connectivity.source.lng };
  const destination = connectivity.destination
    ? { lat: connectivity.destination.lat, lng: connectivity.destination.lng }
    : null;
  const siteAnchor = anchorOf(connectivity.source);
  const destinationAnchor = connectivity.destination ? anchorOf(connectivity.destination) : null;

  const analysis =
    siteAnchor || destinationAnchor
      ? analyzeConnectivity(
          siteAnchor ?? site,
          destination ? (destinationAnchor ?? destination) : null,
          cables,
          landingPoints
        )
      : connectivity;
  const named = (a: RelevantLandingPoint | null) => (a ? { name: a.name, distanceKm: a.distanceFromQueryKm } : null);
  return summarizeProviders(analysis, details, landDCs, {
    site,
    destination,
    siteAnchor: named(siteAnchor),
    destinationAnchor: named(destinationAnchor),
  });
}
