// Geocoding, isolated from the engineering/MCDA model. Resolves a free-text
// place name to a real geographic point. This module ONLY resolves
// coordinates for display and camera framing -- it makes no claim that the
// resolved point is a real data-centre site or that a cable route connects
// to it. Callers depend only on geocodeLocation() and GeocodeResult, so the
// provider can change here without touching any of them.
//
// WHY PHOTON FIRST, NOT NOMINATIM. The search boxes query on every pause in
// typing, so what matters is how a PARTIAL name resolves. Nominatim is a
// full-text geocoder, not an autocomplete, and measured on partial input it
// was useless until the whole word was typed:
//
//   typed      Nominatim's first result        Photon, ranked as below
//   Bangalo    Bangalo, Liberia                Bengaluru, India
//   Mumb       Mumbach, Germany                Mumbai, India
//   New Y      New Orleans Lakefront Airport   New York, United States
//   Chenn      Chaine, France                  Chennai, India
//   Singa      Singa, Estonia                  Singapore
//
// Nominatim's public usage policy also rules out autocomplete-style use.
// Photon (komoot) serves the same OpenStreetMap data and is built for
// search-as-you-type. Nominatim stays as the fallback when Photon is
// unreachable or finds nothing, so a full name still resolves either way.
//
// Both return OpenStreetMap data, (c) OpenStreetMap contributors, ODbL.
export interface GeocodeResult {
  /** Human-readable "City, Region, Country" style name -- not a provider's raw label. */
  displayName: string;
  country?: string;
  /** ISO 3166-1 alpha-2, lowercase. Used to join national indicators (water stress, grid carbon) -- see siting/countryFactors.ts. */
  countryCode?: string;
  lat: number;
  lng: number;
}

const PHOTON_URL = "https://photon.komoot.io/api/";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

/** How many suggestions a search box shows. */
const MAX_RESULTS = 5;
/**
 * How many candidates to ask Photon for before ranking. More than we show,
 * because Photon can let a closer text match beat a much larger place, so the
 * city a user means is not always its first hit -- "Mumb" returns Mumbue,
 * Angola ahead of Mumbai.
 */
const PHOTON_CANDIDATES = 12;

// In-memory cache so repeated lookups (e.g. re-opening the panel) don't
// re-hit the network.
const cache = new Map<string, GeocodeResult[]>();

// --- Photon ------------------------------------------------------------------

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    osm_key?: string;
    osm_value?: string;
  };
}

/**
 * Lower sorts first; within a tier, Photon's own order is kept.
 *
 * Photon already weighs importance -- it puts Tokyo first for "Toky" -- but it
 * also lets a small place whose name is a closer text match jump ahead of a big
 * one: "Mumb" returns Mumbue, Angola above Mumbai. So small settlements are
 * moved DOWN, and major places are left in the order Photon chose.
 *
 * Major places deliberately share one tier rather than ranking city above
 * province above country. OpenStreetMap tags several of the world's largest
 * cities as the province or region they coincide with -- Tokyo is
 * place=province -- and ranking cities first demoted Tokyo below Toki, a town of
 * 57,000 in Gifu, which is worse than Photon's own order. Measured, not
 * assumed: that was this function's first version.
 *
 * Nothing is filtered out; everything is only reordered, so a village is still
 * found when it is the only match.
 */
export function settlementRank(osmKey: string | undefined, osmValue: string | undefined): number {
  if (osmKey === "place") {
    if (
      osmValue === "city" ||
      osmValue === "province" ||
      osmValue === "state" ||
      osmValue === "region" ||
      osmValue === "country"
    ) {
      return 0;
    }
    if (osmValue === "town" || osmValue === "municipality") return 1;
    if (osmValue === "village" || osmValue === "suburb" || osmValue === "borough" || osmValue === "quarter") return 2;
    return 3;
  }
  // Administrative boundaries that come back for partial names are mostly
  // wards and districts ("Mumbuni North ward"); a genuinely large region is
  // returned as place=state or place=province and is already in tier 0.
  if (osmKey === "boundary") return 2;
  return 3;
}

/**
 * Turns a Photon response into ranked, de-duplicated results. Exported so the
 * ranking can be tested against recorded responses without the network.
 */
export function rankPhotonFeatures(features: PhotonFeature[], fallbackName: string): GeocodeResult[] {
  const ordered = features
    .map((feature, index) => ({
      feature,
      index,
      rank: settlementRank(feature.properties?.osm_key, feature.properties?.osm_value),
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index);

  const byName = new Map<string, { result: GeocodeResult; isCity: boolean }>();
  const results: GeocodeResult[] = [];
  for (const { feature } of ordered) {
    const [lng, lat] = feature.geometry?.coordinates ?? [NaN, NaN];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const p = feature.properties ?? {};
    const name = p.name ?? fallbackName;
    const parts = [name];
    if (p.state && p.state !== name) parts.push(p.state);
    if (p.country) parts.push(p.country);
    const displayName = parts.join(", ");
    const isCity = p.osm_key === "place" && p.osm_value === "city";

    // A city and the region or country it shares a name with collapse to one
    // human-readable label ("Moscow, Russia", "Singapore, Singapore"). Keep one
    // entry, in the position the first of them earned, but point it at the
    // CITY: a region's centroid is not where anyone means when they type a
    // city's name.
    const existing = byName.get(displayName);
    if (existing) {
      if (isCity && !existing.isCity) {
        existing.result.lat = lat;
        existing.result.lng = lng;
        existing.isCity = true;
      }
      continue;
    }
    if (results.length === MAX_RESULTS) continue;
    const result: GeocodeResult = {
      displayName,
      country: p.country,
      countryCode: p.countrycode?.toLowerCase(),
      lat,
      lng,
    };
    byName.set(displayName, { result, isCity });
    results.push(result);
  }
  return results;
}

async function searchPhoton(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const url =
    `${PHOTON_URL}?q=${encodeURIComponent(query)}&limit=${PHOTON_CANDIDATES}&lang=en` +
    `&layer=city&layer=state&layer=country`;
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Place search failed (${res.status})`);
  const data = (await res.json()) as { features?: PhotonFeature[] };
  return rankPhotonFeatures(data.features ?? [], query);
}

// --- Nominatim (fallback) ------------------------------------------------------

interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  county?: string;
  state?: string;
  state_district?: string;
  country?: string;
  country_code?: string;
}

interface NominatimResult {
  lat: string;
  lon: string;
  name?: string;
  address?: NominatimAddress;
}

function buildDisplayName(address: NominatimAddress | undefined, fallback: string): string {
  if (!address) return fallback;
  const place = address.city ?? address.town ?? address.village ?? address.county ?? address.state_district ?? fallback;
  const parts = [place];
  if (address.state && address.state !== place) parts.push(address.state);
  if (address.country) parts.push(address.country);
  return parts.join(", ");
}

async function searchNominatim(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const url = `${NOMINATIM_URL}?format=jsonv2&addressdetails=1&limit=${MAX_RESULTS}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Geocoding request failed (${res.status})`);

  const data = (await res.json()) as NominatimResult[];
  const seen = new Set<string>();
  const results: GeocodeResult[] = [];
  for (const d of data) {
    const lat = Number.parseFloat(d.lat);
    const lng = Number.parseFloat(d.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const displayName = buildDisplayName(d.address, d.name ?? query);
    // Nominatim can return multiple records (e.g. city + district boundary)
    // that resolve to the same human-readable name -- keep the first.
    if (seen.has(displayName)) continue;
    seen.add(displayName);
    results.push({
      displayName,
      country: d.address?.country,
      countryCode: d.address?.country_code?.toLowerCase(),
      lat,
      lng,
    });
  }
  return results;
}

// --- Public entry point ----------------------------------------------------------

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (err instanceof DOMException && err.name === "AbortError");
}

export async function geocodeLocation(query: string, opts?: { signal?: AbortSignal }): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const cached = cache.get(trimmed);
  if (cached) return cached;

  let results: GeocodeResult[] = [];
  let photonFailed = false;
  try {
    results = await searchPhoton(trimmed, opts?.signal);
  } catch (err) {
    // A caller cancelling because the user kept typing is not a failure.
    if (isAbort(err, opts?.signal)) throw err;
    photonFailed = true;
  }

  // Fall back when Photon is unreachable, or finds nothing for a query long
  // enough to be a real name. Short prefixes are not sent to Nominatim: that
  // is exactly the autocomplete use its public policy asks clients not to make.
  if (photonFailed || (results.length === 0 && trimmed.length >= 4)) {
    results = await searchNominatim(trimmed, opts?.signal);
  }

  cache.set(trimmed, results);
  return results;
}
