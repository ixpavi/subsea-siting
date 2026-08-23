// Recommends a cooling technology for a proposed site from that site's REAL
// measured conditions, with every input traceable and every threshold
// disclosed. No LLM, no black box: the ranking is a weighted sum of three
// normalised criteria and each candidate reports its own component scores.
//
// WHAT IS REAL vs CHOSEN HERE -- the distinction the whole project turns on:
//
//   REAL / DERIVED (measured, not invented)
//     - hours per year below a given dry bulb        ERA5 hourly, per site
//     - hours per year below a given wet bulb        ERA5 hourly, per site
//     - baseline water stress                        WRI Aqueduct, national
//     - grid carbon intensity                        OWID/Ember, national
//     - PUE shift per degree of annual mean temp     fitted to 31 real facilities
//
//   MODELED / USER ASSUMPTION (chosen by this project, shown to the user)
//     - each cooling type's baseline PUE and WUE     calculator/facilityCalculator.ts
//     - the supply-air temperature used to count     ECONOMISER_SUPPLY_AIR_C
//       economiser-favourable hours
//     - the wet-bulb limit for evaporative operation EVAPORATIVE_WET_BULB_C
//     - the three criterion weights                  CRITERION_WEIGHTS
//
// The two temperature limits are the only genuinely judgement-based numbers,
// and they are deliberately expressed as "hours below X" rather than as a
// pass/fail verdict, so the user sees the measured quantity and can disagree
// with the threshold without discarding the evidence.
//
// WHY VIABILITY IS A FRACTION, NOT A VERDICT. An economiser is not "possible"
// or "impossible" -- it carries the load for some share of the year and
// mechanical cooling covers the rest. Reporting that share (Chennai 0%,
// Dublin 95%) is a measurement. Converting it into "free-air: NO" would be an
// opinion dressed as one.
import type { CoolingConfig } from "../calculator/types";
import { COOLING_SPECS } from "../calculator/facilityCalculator";
import type { ClimateProfile } from "./climateProfile";
import type { CountryFactors } from "./countryFactors";
import { adjustPueForClimate } from "./pueAdjustment";
import type { PueModel } from "./pueAdjustment";

/** Supply-air temperature assumed when counting economiser-favourable hours. Warmer halls economise for more of the year; this is a disclosed design choice, not a standard. */
export const ECONOMISER_SUPPLY_AIR_C = 24;
/** Wet-bulb limit below which evaporative/adiabatic assist is treated as effective. Disclosed modelling assumption. */
export const EVAPORATIVE_WET_BULB_C = 20;
/** Equal weighting across the three criteria, stated rather than tuned to produce a preferred answer. */
export const CRITERION_WEIGHTS = { climate: 1, water: 1, efficiency: 1 };

export interface CoolingCriterion {
  /** 0..1, higher is better. */
  score: number;
  basis: string;
}

export interface CoolingAssessment {
  cooling: CoolingConfig;
  label: string;
  baselinePue: number;
  adjustedPue: number;
  wue: number;
  climate: CoolingCriterion;
  water: CoolingCriterion;
  efficiency: CoolingCriterion;
  /** Weighted combination of the three criteria above, 0..1. */
  suitability: number;
  /** Operational carbon per IT kWh, kg CO2e. null when the country's grid intensity is unavailable. */
  operationalCarbonKgPerKwh: number | null;
  /** Points the user should weigh, phrased from measured values. */
  notes: string[];
  /** Conditions that materially undermine this option at this site. */
  warnings: string[];
}

export interface CoolingAdvice {
  assessments: CoolingAssessment[];
  recommended: CoolingAssessment | null;
  climate: ClimateProfile;
  countryFactors: CountryFactors | null;
  /** True when no country match was found, so water and carbon could not be considered. */
  nationalDataUnavailable: boolean;
}

/** How much of the year outside air alone can carry the load, measured. */
function climateCriterion(cooling: CoolingConfig, climate: ClimateProfile): CoolingCriterion {
  const freeHours = climate.freeCoolingFractionAt24C;
  const evapHours = climate.evaporativeFractionAt20C;

  if (cooling === "free-air") {
    // Outside air below supply temperature, plus evaporative assist extending
    // the range when the wet bulb allows it. Capped at 1: the two windows
    // overlap heavily and must not sum past a full year.
    const combined = Math.min(1, freeHours + evapHours * (1 - freeHours));
    return {
      score: combined,
      basis:
        `Outside air is below ${ECONOMISER_SUPPLY_AIR_C}°C for ${(freeHours * 100).toFixed(0)}% of the year and ` +
        `wet bulb is below ${EVAPORATIVE_WET_BULB_C}°C for ${(evapHours * 100).toFixed(0)}%, so an economiser with ` +
        `evaporative assist could carry roughly ${(combined * 100).toFixed(0)}% of annual hours here.`,
    };
  }

  // Mechanical systems run in any climate; their climate sensitivity shows up
  // in PUE (the efficiency criterion) rather than in whether they work.
  return {
    score: 1,
    basis: "Mechanically cooled, so operable in any climate; this site's climate affects its efficiency, not its feasibility.",
  };
}

/** Penalises water-hungry designs in proportion to how water-stressed the country is. */
function waterCriterion(cooling: CoolingConfig, factors: CountryFactors | null): CoolingCriterion {
  const wue = COOLING_SPECS[cooling].wue;
  const stress = factors?.waterStressScore ?? null;
  if (stress == null) {
    return {
      score: 0.5,
      basis: "Water stress unavailable for this country, so water availability could not be weighed. Treated as neutral rather than favourable.",
    };
  }
  // Aqueduct scores 0-5; the highest WUE among the modelled cooling types
  // normalises the design's water appetite. Product of the two, so a thirsty
  // design in a stressed basin scores worst and either factor alone is mild.
  const maxWue = Math.max(...Object.values(COOLING_SPECS).map((s) => s.wue));
  const exposure = (wue / maxWue) * (stress / 5);
  return {
    score: Math.max(0, 1 - exposure),
    basis:
      `Design draws ${wue} L/kWh against a national baseline water stress of ${stress.toFixed(2)}/5` +
      `${factors?.waterStressCategory ? ` (${factors.waterStressCategory})` : ""}` +
      `${factors?.waterStressWeighting === "industrial" ? ", industry-weighted" : ""}.`,
  };
}

export function assessCooling(
  options: CoolingConfig[],
  climate: ClimateProfile,
  factors: CountryFactors | null,
  pueModel: PueModel
): CoolingAdvice {
  const partial = options.map((cooling) => {
    const spec = COOLING_SPECS[cooling];
    const adj = adjustPueForClimate(pueModel, spec.pue, climate.meanDryBulbC);
    return { cooling, spec, adjustedPue: adj.adjustedPue, climate: climateCriterion(cooling, climate), water: waterCriterion(cooling, factors) };
  });

  // Efficiency is scored relative to the other candidates rather than against
  // an absolute scale, so it reflects the actual choice being made here.
  const pues = partial.map((p) => p.adjustedPue);
  const minPue = Math.min(...pues);
  const maxPue = Math.max(...pues);
  const carbon = factors?.carbonIntensityGco2PerKwh ?? null;

  const assessments: CoolingAssessment[] = partial.map((p) => {
    const efficiencyScore = maxPue === minPue ? 1 : (maxPue - p.adjustedPue) / (maxPue - minPue);
    const efficiency: CoolingCriterion = {
      score: efficiencyScore,
      basis: `Climate-adjusted PUE of ${p.adjustedPue.toFixed(3)} at this site (baseline ${p.spec.pue} for this technology).`,
    };

    const totalWeight = CRITERION_WEIGHTS.climate + CRITERION_WEIGHTS.water + CRITERION_WEIGHTS.efficiency;
    const suitability =
      (CRITERION_WEIGHTS.climate * p.climate.score +
        CRITERION_WEIGHTS.water * p.water.score +
        CRITERION_WEIGHTS.efficiency * efficiency.score) /
      totalWeight;

    const notes: string[] = [];
    const warnings: string[] = [];

    if (p.cooling === "free-air") {
      const pct = p.climate.score * 100;
      if (pct < 20) {
        warnings.push(
          `This climate supports free/evaporative cooling for only about ${pct.toFixed(0)}% of the year, so mechanical ` +
            `cooling would carry nearly the whole load. The ${p.spec.pue} baseline PUE assumes economiser operation ` +
            `this site cannot sustain, and real PUE would be materially worse than shown.`
        );
      } else if (pct < 60) {
        notes.push(`Economiser operation covers roughly ${pct.toFixed(0)}% of the year; mechanical cooling covers the remainder.`);
      } else {
        notes.push(`Economiser operation covers roughly ${pct.toFixed(0)}% of the year, so mechanical cooling is largely a backstop.`);
      }
    }

    const stress = factors?.waterStressScore;
    if (stress != null && stress >= 3 && p.spec.wue >= 1.0) {
      warnings.push(
        `Water stress here is ${factors?.waterStressCategory ?? stress.toFixed(2)} and this design draws ` +
          `${p.spec.wue} L/kWh. Water availability and abstraction permitting are likely to be a real constraint.`
      );
    }

    return {
      cooling: p.cooling,
      label: p.spec.label,
      baselinePue: p.spec.pue,
      adjustedPue: p.adjustedPue,
      wue: p.spec.wue,
      climate: p.climate,
      water: p.water,
      efficiency,
      suitability,
      operationalCarbonKgPerKwh: carbon != null ? (carbon / 1000) * p.adjustedPue : null,
      notes,
      warnings,
    };
  });

  assessments.sort((a, b) => b.suitability - a.suitability);

  return {
    assessments,
    recommended: assessments[0] ?? null,
    climate,
    countryFactors: factors,
    nationalDataUnavailable: factors == null,
  };
}
