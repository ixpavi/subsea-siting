// Geocoding, isolated from the engineering/MCDA model. Resolves a free-text
// place name to a real geographic point via OpenStreetMap Nominatim (a
// public, no-API-key geocoding service). This module ONLY resolves
// coordinates for display and camera framing -- it makes no claim that the
// resolved point is a real data-centre site or that a cable route connects
// to it. Swap the implementation here later (cached backend, paid provider)
// without touching any caller.
export interface GeocodeResult {
  /** Human-readable "City, Region, Country" style name -- not the raw Nominatim display_name. */
  displayName: string;
  country?: string;
  /** ISO 3166-1 alpha-2, lowercase, as Nominatim returns it. Used to join national indicators (water stress, grid carbon) -- see siting/countryFactors.ts. */
  countryCode?: string;
  lat: number;
  lng: number;
}

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

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// In-memory cache so repeated lookups (e.g. re-opening the panel) don't
// re-hit the network, and so this module can later be swapped for a
// cached/proxied backend without changing callers.
const cache = new Map<string, GeocodeResult[]>();

function buildDisplayName(address: NominatimAddress | undefined, fallback: string): string {
  if (!address) return fallback;
  const place = address.city ?? address.town ?? address.village ?? address.county ?? address.state_district ?? fallback;
  const parts = [place];
  if (address.state && address.state !== place) parts.push(address.state);
  if (address.country) parts.push(address.country);
  return parts.join(", ");
}

export async function geocodeLocation(query: string, opts?: { signal?: AbortSignal }): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const cached = cache.get(trimmed);
  if (cached) return cached;

  const url = `${NOMINATIM_URL}?format=jsonv2&addressdetails=1&limit=5&q=${encodeURIComponent(trimmed)}`;
  const res = await fetch(url, {
    signal: opts?.signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Geocoding request failed (${res.status})`);

  const data = (await res.json()) as NominatimResult[];
  const seen = new Set<string>();
  const results: GeocodeResult[] = [];
  for (const d of data) {
    const lat = Number.parseFloat(d.lat);
    const lng = Number.parseFloat(d.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const displayName = buildDisplayName(d.address, d.name ?? trimmed);
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

  cache.set(trimmed, results);
  return results;
}
