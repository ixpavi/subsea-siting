// Real climate conditions at a proposed data-centre site, fetched at runtime
// from the Open-Meteo historical archive (ERA5 reanalysis).
//
// PROVENANCE -- this is DERIVED, not REAL. ERA5 is a reanalysis product: a
// physical model run that assimilates real observations onto a regular grid
// of roughly 9-31 km. The value returned for a coordinate is therefore a
// modelled estimate for the grid cell containing it, not a measurement taken
// at that point. That distinction matters here because a site 20 km inland
// and a site on the coast can share a cell while having materially different
// cooling conditions.
//
// WHY THIS IS FETCHED PER SITE RATHER THAN BUNDLED: unlike the routing
// grid, a siting query concerns exactly one coordinate the user chose, so
// one request answers it. The build-time bundle would have to cover every
// possible coordinate to do the same job.
//
// WHY HOURLY: cooling-plant selection turns on how many hours per year the
// outside air can actually do the work, and on the WET bulb (which governs
// evaporative and adiabatic systems) rather than the dry bulb alone. Daily
// aggregates cannot express either. A single site is small enough that the
// hourly series is affordable; the model-training pipeline, which needs
// thousands of cells, deliberately uses daily aggregates instead.

/** One full year of hourly data, requested as a single archive call. */
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";

export interface ClimateProfile {
  latitude: number;
  longitude: number;
  /** Year the statistics were computed over. */
  year: number;
  hoursSampled: number;
  meanDryBulbC: number;
  /** 99.6th-percentile dry bulb -- the conventional cooling design condition. */
  designDryBulbC: number;
  /** 99.6th-percentile wet bulb -- governs evaporative/adiabatic capability. */
  designWetBulbC: number;
  /** Share of the year (0..1) with dry bulb below the given supply-air threshold. */
  freeCoolingFractionAt18C: number;
  freeCoolingFractionAt24C: number;
  /** Share of the year (0..1) with wet bulb below 20C -- evaporative-favourable. */
  evaporativeFractionAt20C: number;
  source: string;
}

interface ArchiveResponse {
  latitude: number;
  longitude: number;
  hourly?: {
    time: string[];
    temperature_2m: (number | null)[];
    wet_bulb_temperature_2m: (number | null)[];
  };
}

function percentile(sortedAscending: number[], p: number): number {
  if (sortedAscending.length === 0) return NaN;
  const idx = Math.min(sortedAscending.length - 1, Math.floor((p / 100) * sortedAscending.length));
  return sortedAscending[idx];
}

/** In-memory cache: a planning session revisits the same site repeatedly (weight changes, step navigation) and must not re-request it. */
const cache = new Map<string, Promise<ClimateProfile>>();

function cacheKey(lat: number, lng: number, year: number): string {
  // ~1km rounding. Finer keys would miss cache hits for what is, at ERA5's
  // resolution, indistinguishably the same location.
  return `${lat.toFixed(2)},${lng.toFixed(2)},${year}`;
}

export function fetchClimateProfile(
  lat: number,
  lng: number,
  opts: { year?: number; signal?: AbortSignal } = {}
): Promise<ClimateProfile> {
  const year = opts.year ?? 2024;
  const key = cacheKey(lat, lng, year);
  const existing = cache.get(key);
  if (existing) return existing;

  const url =
    `${ARCHIVE_URL}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
    `&start_date=${year}-01-01&end_date=${year}-12-31` +
    `&hourly=temperature_2m,wet_bulb_temperature_2m&timezone=UTC`;

  const promise = (async () => {
    const res = await fetch(url, { signal: opts.signal });
    if (!res.ok) {
      throw new Error(
        res.status === 429
          ? "Climate data service is rate-limited right now. Try again shortly."
          : `Climate request failed (${res.status})`
      );
    }
    const json = (await res.json()) as ArchiveResponse;
    const dry = (json.hourly?.temperature_2m ?? []).filter((v): v is number => v != null);
    const wet = (json.hourly?.wet_bulb_temperature_2m ?? []).filter((v): v is number => v != null);
    if (dry.length < 2000 || wet.length < 2000) {
      throw new Error("Climate data for this location is incomplete for the requested year.");
    }

    const drySorted = [...dry].sort((a, b) => a - b);
    const wetSorted = [...wet].sort((a, b) => a - b);

    return {
      latitude: json.latitude,
      longitude: json.longitude,
      year,
      hoursSampled: dry.length,
      meanDryBulbC: dry.reduce((a, b) => a + b, 0) / dry.length,
      designDryBulbC: percentile(drySorted, 99.6),
      designWetBulbC: percentile(wetSorted, 99.6),
      freeCoolingFractionAt18C: dry.filter((t) => t < 18).length / dry.length,
      freeCoolingFractionAt24C: dry.filter((t) => t < 24).length / dry.length,
      evaporativeFractionAt20C: wet.filter((t) => t < 20).length / wet.length,
      source: `Open-Meteo historical archive (ERA5 reanalysis), calendar year ${year}, hourly`,
    } satisfies ClimateProfile;
  })();

  // A failed request must not poison the cache -- otherwise a transient rate
  // limit would permanently break this site for the rest of the session.
  promise.catch(() => cache.delete(key));
  cache.set(key, promise);
  return promise;
}
