import { assetUrl } from "../assetUrl";
// National indicators for a site's country: grid carbon intensity and
// baseline water stress. Built at build time by scripts/build-siting-data.mjs
// from real published datasets (Our World in Data / Ember, and WRI Aqueduct
// via the World Bank Data360 API).
//
// RESOLUTION CAVEAT, which callers must surface rather than smooth over:
// these are NATIONAL aggregates. Water stress especially varies enormously
// within large countries -- a site in Kerala and a site in Rajasthan share an
// ISO code and essentially no hydrology. Treated as an indicator of the
// regulatory and resource environment, not as a measurement at the site.

export interface CountryFactors {
  name: string | null;
  carbonIntensityGco2PerKwh: number | null;
  carbonIntensityYear: number | null;
  lowCarbonSharePct: number | null;
  renewablesSharePct: number | null;
  /** WRI Aqueduct baseline water stress, 0-5. Higher is more stressed. */
  waterStressScore: number | null;
  /** Aqueduct's own category label, e.g. "Extremely High (>80%)". */
  waterStressCategory: string | null;
  /** "industrial" where Aqueduct publishes an industry-weighted score (the right lens for a data centre), otherwise "total". */
  waterStressWeighting: string | null;
}

interface SitingCountryFile {
  generatedAt: string;
  provenance: string;
  sources: Record<string, { name: string; url: string; licence?: string; note?: string; indicator?: string }>;
  iso2ToIso3: Record<string, string>;
  countries: Record<string, CountryFactors>;
}

let filePromise: Promise<SitingCountryFile> | null = null;

export function loadCountryFactorsFile(): Promise<SitingCountryFile> {
  if (!filePromise) {
    filePromise = fetch(assetUrl("data/siting-country.json")).then((res) => {
      if (!res.ok) throw new Error(`Failed to load siting-country.json: ${res.status}`);
      return res.json() as Promise<SitingCountryFile>;
    });
    filePromise.catch(() => {
      filePromise = null;
    });
  }
  return filePromise;
}

export interface CountryFactorsResult {
  iso2: string | null;
  iso3: string | null;
  factors: CountryFactors | null;
  provenance: string;
}

/** Resolves a lowercase ISO 3166-1 alpha-2 code to national indicators. Returns nulls rather than guessing when the country is absent from the source datasets. */
export async function getCountryFactors(iso2: string | undefined | null): Promise<CountryFactorsResult> {
  const file = await loadCountryFactorsFile();
  const code = (iso2 ?? "").toLowerCase();
  const iso3 = code ? (file.iso2ToIso3[code] ?? null) : null;
  return {
    iso2: code || null,
    iso3,
    factors: iso3 ? (file.countries[iso3] ?? null) : null,
    provenance: file.provenance,
  };
}
