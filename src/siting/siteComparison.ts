// Ranks several candidate data-centre sites against each other.
//
// WHY THIS EXISTS. Every other part of the siting tool evaluates ONE location
// and reports what it found. That is not the question a siting decision
// actually asks. The real question is "which of these?" -- and answering it by
// opening the single-site view five times and remembering the numbers is
// exactly the comparison a tool should be doing.
//
// SAME MCDA DISCIPLINE AS THE ROUTING ENGINE. Criteria are normalised, weighted
// and ranked deterministically, and a criterion on which every site scores
// identically is EXCLUDED rather than folded in: including it would change no
// ranking while diluting the weight of criteria that do discriminate, and would
// let every site claim to "win" it. Same reasoning as
// routing/hypotheticalRouting.ts, same failure it prevents.
//
// UNAVAILABLE IS NOT ZERO. Where a country is missing from the water-stress or
// grid-carbon source, that criterion is dropped for the whole comparison rather
// than scored as though the site had no water stress and no emissions. A site
// must never rank higher because less is known about it. That is the single
// most dangerous failure mode in a comparison tool, because the result still
// looks complete.
import type { ClimateProfile } from "./climateProfile";
import type { CountryFactors } from "./countryFactors";
import type { CoolingAdvice } from "./coolingAdvisor";

export type SiteCriterionId =
  | "freeCooling"
  | "adjustedPue"
  | "waterStress"
  | "gridCarbon"
  | "connectivity";

export interface SiteCriterionMeta {
  id: SiteCriterionId;
  label: string;
  /** Form used inside a sentence. Separate from `label` because lowercasing
   *  the display label to fit a sentence turns "PUE" into "pue". */
  sentenceLabel: string;
  /** True when a HIGHER raw value is a better site. */
  higherIsBetter: boolean;
  unit: string;
  /** Where the number comes from, in the project's provenance vocabulary. */
  provenance: "REAL" | "DERIVED" | "MODELED";
  source: string;
}

export const SITE_CRITERIA: Record<SiteCriterionId, SiteCriterionMeta> = {
  freeCooling: {
    id: "freeCooling",
    sentenceLabel: "free-cooling hours",
    label: "Free-cooling hours",
    higherIsBetter: true,
    unit: "% of year",
    provenance: "DERIVED",
    source: "Computed from ERA5 reanalysis hourly dry-bulb temperature (Open-Meteo archive).",
  },
  adjustedPue: {
    id: "adjustedPue",
    sentenceLabel: "climate-adjusted PUE",
    label: "Climate-adjusted PUE",
    higherIsBetter: false,
    unit: "PUE",
    provenance: "MODELED",
    source:
      "Baseline PUE adjusted by a temperature gradient fitted to 31 measured Google facility-years. " +
      "A modelled estimate, not a measurement of any real facility at this site.",
  },
  waterStress: {
    id: "waterStress",
    sentenceLabel: "water stress",
    label: "Water stress",
    higherIsBetter: false,
    unit: "0-5",
    provenance: "REAL",
    source: "WRI Aqueduct baseline water stress, industrial weighting where published.",
  },
  gridCarbon: {
    id: "gridCarbon",
    sentenceLabel: "grid carbon intensity",
    label: "Grid carbon intensity",
    higherIsBetter: false,
    unit: "gCO2e/kWh",
    provenance: "REAL",
    source: "Our World in Data national electricity carbon intensity.",
  },
  connectivity: {
    id: "connectivity",
    sentenceLabel: "nearby cable systems",
    label: "Cable systems nearby",
    higherIsBetter: true,
    unit: "systems",
    provenance: "REAL",
    source: "Distinct real submarine cable systems landing within the connectivity search radius (TeleGeography).",
  },
};

/** Everything gathered for one candidate site before ranking. */
export interface SiteEvaluation {
  id: string;
  label: string;
  lat: number;
  lng: number;
  countryCode: string | null;
  climate: ClimateProfile | null;
  countryFactors: CountryFactors | null;
  cooling: CoolingAdvice | null;
  /** Distinct real cable systems within the connectivity search radius. */
  cableSystemsNearby: number | null;
  /** Populated when the site could not be evaluated at all. */
  error: string | null;
}

export interface SiteCriterionOutcome {
  id: SiteCriterionId;
  meta: SiteCriterionMeta;
  weight: number;
  /** Raw value per site, index-aligned with the input array. null = unknown. */
  raw: (number | null)[];
  normalized: number[];
  /** False when the criterion is unavailable, unweighted, or flat across sites. */
  discriminates: boolean;
  /** Why it was excluded, when it was. Shown to the user rather than hidden. */
  excludedReason: string | null;
  /** Index of the single best site, or null when tied or non-discriminating. */
  uniqueWinner: number | null;
}

export interface RankedSite {
  evaluation: SiteEvaluation;
  /** 0..1 weighted score across discriminating criteria only. */
  score: number;
  rank: number;
  /** Criteria this site is uniquely best on. */
  winsOn: SiteCriterionId[];
  /** Criteria this site is uniquely worst on. */
  losesOn: SiteCriterionId[];
  whyText: string;
}

export interface SiteComparisonResult {
  ranked: RankedSite[];
  criteria: SiteCriterionOutcome[];
  /** Sites that could not be evaluated, kept visible rather than dropped. */
  failed: SiteEvaluation[];
  /** True when nothing discriminates and the order is arbitrary. */
  indeterminate: boolean;
  notes: string[];
}

export type SiteWeights = Record<SiteCriterionId, number>;

export const DEFAULT_SITE_WEIGHTS: SiteWeights = {
  freeCooling: 1,
  adjustedPue: 1,
  waterStress: 1,
  gridCarbon: 1,
  connectivity: 1,
};

/** Raw value for one criterion at one site, or null when not known. */
export function rawValue(ev: SiteEvaluation, id: SiteCriterionId): number | null {
  switch (id) {
    case "freeCooling":
      return ev.climate ? ev.climate.freeCoolingFractionAt24C * 100 : null;
    case "adjustedPue": {
      const rec = ev.cooling?.recommended;
      return rec ? rec.adjustedPue : null;
    }
    case "waterStress":
      return ev.countryFactors?.waterStressScore ?? null;
    case "gridCarbon":
      return ev.countryFactors?.carbonIntensityGco2PerKwh ?? null;
    case "connectivity":
      return ev.cableSystemsNearby;
  }
}

function normalize(values: number[], higherIsBetter: boolean): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 1);
  return values.map((v) => (higherIsBetter ? (v - min) / (max - min) : (max - v) / (max - min)));
}

function buildSiteCriterion(
  id: SiteCriterionId,
  sites: SiteEvaluation[],
  weight: number
): SiteCriterionOutcome {
  const meta = SITE_CRITERIA[id];
  const raw = sites.map((s) => rawValue(s, id));
  const known = raw.filter((v): v is number => v !== null);

  let excludedReason: string | null = null;
  if (known.length !== raw.length) {
    // Partial data is the dangerous case. Scoring only the sites that have a
    // value would rank a site well precisely because its data is missing, and
    // the output would still look complete.
    const missing = raw.filter((v) => v === null).length;
    excludedReason = `Not available for ${missing} of ${raw.length} sites, so it is excluded from scoring for all of them. Comparing on it would reward the sites with missing data.`;
  } else if (weight <= 0) {
    excludedReason = "Weighted to zero by the user.";
  } else if (known.length > 0 && Math.max(...known) === Math.min(...known)) {
    excludedReason = "Every site scores identically, so it cannot separate them.";
  }

  const discriminates = excludedReason === null && known.length === raw.length && known.length > 1;
  const normalized = discriminates ? normalize(known, meta.higherIsBetter) : raw.map(() => 0);

  let uniqueWinner: number | null = null;
  if (discriminates) {
    const best = meta.higherIsBetter ? Math.max(...known) : Math.min(...known);
    const winners = raw.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0);
    uniqueWinner = winners.length === 1 ? winners[0] : null;
  }

  return { id, meta, weight, raw, normalized, discriminates, excludedReason, uniqueWinner };
}

function buildWhy(
  rank: number,
  label: string,
  winsOn: SiteCriterionId[],
  losesOn: SiteCriterionId[],
  topLabel: string,
  anyDiscriminates: boolean
): string {
  if (!anyDiscriminates) {
    return `${label}: no criterion separates the candidate sites on the available data, so this ordering is arbitrary and should not be read as a preference.`;
  }
  // "a, b and c" rather than "a and b and c".
  const names = (ids: SiteCriterionId[]) => {
    const parts = ids.map((i) => SITE_CRITERIA[i].sentenceLabel);
    if (parts.length <= 1) return parts.join("");
    return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  };
  const wins = names(winsOn);
  const loses = names(losesOn);

  if (rank === 1) {
    if (!wins) {
      return `${label} ranks first on the weighted combination without being best on any single criterion -- it is the most balanced candidate rather than the strongest on any one measure.`;
    }
    const tail = loses ? ` It is weakest on ${loses}, which is the trade being made.` : "";
    return `${label} ranks first, best on ${wins}.${tail}`;
  }
  const strength = wins ? ` It is still the best candidate on ${wins}.` : "";
  const weakness = loses ? ` It ranks last on ${loses}.` : "";
  return `${label} ranks ${ordinal(rank)}, behind ${topLabel}.${strength}${weakness}`;
}

/** 2 -> "2nd", 3 -> "3rd", 11 -> "11th". */
function ordinal(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/**
 * Deterministic: identical inputs always produce identical ordering, including
 * ties, which are broken by label so the table never reshuffles between runs.
 */
export function compareSites(
  sites: SiteEvaluation[],
  weights: SiteWeights = DEFAULT_SITE_WEIGHTS
): SiteComparisonResult {
  const failed = sites.filter((s) => s.error !== null);
  const usable = sites.filter((s) => s.error === null);

  const notes: string[] = [];
  if (failed.length) {
    notes.push(
      `${failed.length} site${failed.length === 1 ? "" : "s"} could not be evaluated and ${failed.length === 1 ? "is" : "are"} listed separately rather than ranked.`
    );
  }

  if (usable.length === 0) {
    return { ranked: [], criteria: [], failed, indeterminate: true, notes };
  }

  const ids = Object.keys(SITE_CRITERIA) as SiteCriterionId[];
  const criteria = ids.map((id) => buildSiteCriterion(id, usable, weights[id] ?? 0));
  const active = criteria.filter((c) => c.discriminates);
  const totalWeight = active.reduce((a, c) => a + c.weight, 0);

  for (const c of criteria) {
    if (c.excludedReason) notes.push(`${c.meta.label}: ${c.excludedReason}`);
  }

  const scores = usable.map((_, i) =>
    totalWeight > 0
      ? active.reduce((sum, c) => sum + c.weight * c.normalized[i], 0) / totalWeight
      : 0
  );

  const order = usable
    .map((_, i) => i)
    .sort((a, b) => scores[b] - scores[a] || usable[a].label.localeCompare(usable[b].label));

  const anyDiscriminates = active.length > 0;
  const topLabel = usable[order[0]]?.label ?? "";

  const ranked: RankedSite[] = order.map((idx, position) => {
    const winsOn = active.filter((c) => c.uniqueWinner === idx).map((c) => c.id);
    const losesOn = active
      .filter((c) => {
        const known = c.raw.filter((v): v is number => v !== null);
        const worst = c.meta.higherIsBetter ? Math.min(...known) : Math.max(...known);
        const losers = c.raw.map((v, i) => (v === worst ? i : -1)).filter((i) => i >= 0);
        return losers.length === 1 && losers[0] === idx;
      })
      .map((c) => c.id);

    return {
      evaluation: usable[idx],
      score: scores[idx],
      rank: position + 1,
      winsOn,
      losesOn,
      whyText: buildWhy(position + 1, usable[idx].label, winsOn, losesOn, topLabel, anyDiscriminates),
    };
  });

  return { ranked, criteria, failed, indeterminate: !anyDiscriminates, notes };
}

// --- Gathering the data for one site ---------------------------------------

import { fetchClimateProfile } from "./climateProfile";
import { getCountryFactors } from "./countryFactors";
import { assessCooling } from "./coolingAdvisor";
import { loadPueModel } from "./pueAdjustment";
import type { CoolingConfig } from "../calculator/types";
import { analyzeConnectivity } from "../design/connectivityAnalysis";
import type { CableFeature, LandingPoint } from "../types";

export interface EvaluateSiteInput {
  id: string;
  label: string;
  lat: number;
  lng: number;
  countryCode?: string | null;
  coolingOptions: CoolingConfig[];
  cables: CableFeature[];
  landingPoints: LandingPoint[];
  signal?: AbortSignal;
}

/**
 * Gathers the real inputs for one candidate site.
 *
 * Failures are captured on the returned object rather than thrown. One site
 * whose climate request times out must not discard the comparison the user
 * asked for -- it is reported as unevaluated and shown separately, which is
 * both more useful and more honest than a comparison silently missing a row.
 */
export async function evaluateSite(input: EvaluateSiteInput): Promise<SiteEvaluation> {
  const base: SiteEvaluation = {
    id: input.id,
    label: input.label,
    lat: input.lat,
    lng: input.lng,
    countryCode: input.countryCode ?? null,
    climate: null,
    countryFactors: null,
    cooling: null,
    cableSystemsNearby: null,
    error: null,
  };

  // Connectivity is local and synchronous, so it survives a network failure
  // above it. Computed first for that reason.
  try {
    const conn = analyzeConnectivity(
      { lat: input.lat, lng: input.lng },
      null,
      input.cables,
      input.landingPoints
    );
    base.cableSystemsNearby = conn.cableSystemDiversity;
  } catch {
    base.cableSystemsNearby = null;
  }

  try {
    const [climate, factorsResult, pueModel] = await Promise.all([
      fetchClimateProfile(input.lat, input.lng, { signal: input.signal }),
      getCountryFactors(input.countryCode),
      loadPueModel(),
    ]);
    base.climate = climate;
    base.countryFactors = factorsResult.factors;
    base.cooling = assessCooling(input.coolingOptions, climate, factorsResult.factors, pueModel);
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e);
  }

  return base;
}

/** Evaluates several sites concurrently, preserving input order. */
export async function evaluateSites(inputs: EvaluateSiteInput[]): Promise<SiteEvaluation[]> {
  return Promise.all(inputs.map(evaluateSite));
}
