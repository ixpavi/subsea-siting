import { describe, it, expect } from "vitest";
import { assessCooling } from "./coolingAdvisor";
import { LAND_COOLING_OPTIONS } from "../calculator/facilityCalculator";
import type { ClimateProfile } from "./climateProfile";
import type { CountryFactors } from "./countryFactors";
import type { PueModel } from "./pueAdjustment";

const MODEL: PueModel = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  source: { name: "test", url: "https://example.invalid", quartersUsed: [] },
  provenance: "test",
  facilityCount: 31,
  best: "meanTempC",
  gradientMilliPuePerDegC: 3,
  fittedRange: { min: 5, max: 25, variable: "meanTempC" },
  observedPue: { min: 1.04, max: 1.16, median: 1.1 },
  predictors: [{ name: "meanTempC", r: 0.5, loo: 0.2, slope: 0.003, intercept: 1.0, meanX: 15, min: 5, max: 25 }],
  facilities: [],
};

function climate(over: Partial<ClimateProfile>): ClimateProfile {
  return {
    latitude: 0,
    longitude: 0,
    year: 2024,
    hoursSampled: 8784,
    meanDryBulbC: 15,
    designDryBulbC: 30,
    designWetBulbC: 20,
    freeCoolingFractionAt18C: 0.5,
    freeCoolingFractionAt24C: 0.5,
    evaporativeFractionAt20C: 0.5,
    source: "test",
    ...over,
  };
}

function country(over: Partial<CountryFactors>): CountryFactors {
  return {
    name: "Testland",
    carbonIntensityGco2PerKwh: 400,
    carbonIntensityYear: 2025,
    lowCarbonSharePct: 40,
    renewablesSharePct: 30,
    waterStressScore: 1,
    waterStressCategory: "Low (<10%)",
    waterStressWeighting: "industrial",
    ...over,
  };
}

const find = (advice: ReturnType<typeof assessCooling>, id: string) =>
  advice.assessments.find((a) => a.cooling === id)!;

describe("assessCooling", () => {
  /**
   * The behaviour the whole advisor exists for: the SAME technology must be
   * judged differently by climate. Measured against real data, free air is
   * viable ~5% of the year in Chennai and 100% in Dublin -- a distinction the
   * fixed per-technology PUE constants could not express at all.
   */
  it("scores free air far lower in a hot humid climate than in a temperate one", () => {
    const chennaiLike = assessCooling(
      LAND_COOLING_OPTIONS,
      climate({ meanDryBulbC: 28, freeCoolingFractionAt24C: 0.04, evaporativeFractionAt20C: 0.003 }),
      country({}),
      MODEL
    );
    const dublinLike = assessCooling(
      LAND_COOLING_OPTIONS,
      climate({ meanDryBulbC: 11, freeCoolingFractionAt24C: 1, evaporativeFractionAt20C: 1 }),
      country({}),
      MODEL
    );
    expect(find(chennaiLike, "free-air").climate.score).toBeLessThan(0.15);
    expect(find(dublinLike, "free-air").climate.score).toBeGreaterThan(0.95);
    expect(find(dublinLike, "free-air").suitability).toBeGreaterThan(find(chennaiLike, "free-air").suitability);
  });

  /** Hot-but-DRY: dry bulb alone would misjudge this, wet bulb rescues it. */
  it("credits a hot but dry climate through the wet-bulb window", () => {
    const phoenixLike = assessCooling(
      LAND_COOLING_OPTIONS,
      climate({ meanDryBulbC: 24, freeCoolingFractionAt24C: 0.51, evaporativeFractionAt20C: 0.8 }),
      country({}),
      MODEL
    );
    // 51% dry-bulb hours alone would score ~0.51; the wet-bulb window lifts it.
    expect(find(phoenixLike, "free-air").climate.score).toBeGreaterThan(0.8);
  });

  it("treats mechanically cooled options as climate-feasible everywhere", () => {
    const harsh = assessCooling(
      LAND_COOLING_OPTIONS,
      climate({ meanDryBulbC: 30, freeCoolingFractionAt24C: 0, evaporativeFractionAt20C: 0 }),
      country({}),
      MODEL
    );
    expect(find(harsh, "chilled-water").climate.score).toBe(1);
    expect(find(harsh, "immersion").climate.score).toBe(1);
  });

  it("penalises water-hungry designs where water stress is high", () => {
    const stressed = assessCooling(LAND_COOLING_OPTIONS, climate({}), country({ waterStressScore: 5, waterStressCategory: "Extremely High (>80%)" }), MODEL);
    const relaxed = assessCooling(LAND_COOLING_OPTIONS, climate({}), country({ waterStressScore: 0.2 }), MODEL);
    // Chilled water is the thirstiest modelled option (1.8 L/kWh).
    expect(find(stressed, "chilled-water").water.score).toBeLessThan(find(relaxed, "chilled-water").water.score);
    // Immersion barely draws water, so it should be far less affected.
    const chilledDrop = find(relaxed, "chilled-water").water.score - find(stressed, "chilled-water").water.score;
    const immersionDrop = find(relaxed, "immersion").water.score - find(stressed, "immersion").water.score;
    expect(chilledDrop).toBeGreaterThan(immersionDrop);
  });

  it("warns when a thirsty design meets a stressed basin", () => {
    const stressed = assessCooling(
      LAND_COOLING_OPTIONS,
      climate({}),
      country({ waterStressScore: 4.1, waterStressCategory: "Extremely High (>80%)" }),
      MODEL
    );
    expect(find(stressed, "chilled-water").warnings.join(" ")).toMatch(/water/i);
  });

  it("warns that a free-air baseline PUE is optimistic where the climate cannot sustain it", () => {
    const chennaiLike = assessCooling(
      LAND_COOLING_OPTIONS,
      climate({ meanDryBulbC: 28, freeCoolingFractionAt24C: 0.04, evaporativeFractionAt20C: 0.003 }),
      country({}),
      MODEL
    );
    expect(find(chennaiLike, "free-air").warnings.join(" ")).toMatch(/mechanical cooling would carry/i);
  });

  /**
   * Absence of data must never read as a favourable result -- the same rule
   * the routing engine applies to environmental analysis.
   */
  it("scores water neutral, not favourable, when national data is missing", () => {
    const unknown = assessCooling(LAND_COOLING_OPTIONS, climate({}), null, MODEL);
    expect(unknown.nationalDataUnavailable).toBe(true);
    for (const a of unknown.assessments) {
      expect(a.water.score).toBe(0.5);
      expect(a.water.basis).toMatch(/unavailable/i);
      expect(a.operationalCarbonKgPerKwh).toBeNull();
    }
  });

  it("ranks by suitability, best first", () => {
    const advice = assessCooling(LAND_COOLING_OPTIONS, climate({}), country({}), MODEL);
    for (let i = 1; i < advice.assessments.length; i++) {
      expect(advice.assessments[i - 1].suitability).toBeGreaterThanOrEqual(advice.assessments[i].suitability);
    }
    expect(advice.recommended).toBe(advice.assessments[0]);
  });

  it("derives operational carbon from the climate-adjusted PUE and the real grid intensity", () => {
    const advice = assessCooling(LAND_COOLING_OPTIONS, climate({ meanDryBulbC: 15 }), country({ carbonIntensityGco2PerKwh: 500 }), MODEL);
    const a = find(advice, "immersion");
    expect(a.operationalCarbonKgPerKwh).toBeCloseTo(0.5 * a.adjustedPue, 6);
  });
});
