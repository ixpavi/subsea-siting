import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateFacilityProfile, COOLING_SPECS } from "./facilityCalculator";
import { recommendConfigurations } from "./recommend";
import type { FacilityConfig } from "./types";

const BASE: FacilityConfig = {
  redundancy: "N+1",
  tier: "III",
  cooling: "air-crac",
  downtimeCostPerHourUsd: 9000,
};

/** The shipped country factors, so this tests the data as well as the logic. */
const countries = JSON.parse(
  readFileSync(join(process.cwd(), "public", "data", "siting-country.json"), "utf-8")
).countries as Record<string, { name?: string; carbonIntensityGco2PerKwh: number | null }>;

describe("CUE", () => {
  // The bug this guards against: CUE was computed from a flat 0.4 kg/kWh for
  // every site on earth, and displayed as a result. The real national figures
  // span 0 to 1,306 gCO2/kWh.
  it("is unavailable, not defaulted, when no grid intensity is known", () => {
    expect(calculateFacilityProfile(BASE).cue).toBeNull();
    expect(calculateFacilityProfile(BASE, null).cue).toBeNull();
  });

  it("is PUE x the supplied grid intensity, in kg per kWh", () => {
    const pue = COOLING_SPECS[BASE.cooling].pue;
    const profile = calculateFacilityProfile(BASE, 500);
    expect(profile.cue).toBeCloseTo(pue * 0.5, 3);
  });

  it("differs between a clean grid and a dirty one", () => {
    const clean = calculateFacilityProfile(BASE, 41); // France
    const dirty = calculateFacilityProfile(BASE, 670); // India
    expect(clean.cue).not.toBeNull();
    expect(dirty.cue).not.toBeNull();
    expect(dirty.cue!).toBeGreaterThan(clean.cue! * 10);
  });

  it("tracks the real shipped value for a country, not a constant", () => {
    const fr = Object.values(countries).find((c) => c.name === "France");
    const inCountry = Object.values(countries).find((c) => c.name === "India");
    expect(fr?.carbonIntensityGco2PerKwh).toBeTruthy();
    expect(inCountry?.carbonIntensityGco2PerKwh).toBeTruthy();

    const a = calculateFacilityProfile(BASE, fr!.carbonIntensityGco2PerKwh)!.cue!;
    const b = calculateFacilityProfile(BASE, inCountry!.carbonIntensityGco2PerKwh)!.cue!;
    expect(a).not.toBeCloseTo(b, 2);
  });

  it("does not change which configuration is recommended", () => {
    // Sustainability ranks on PUE + WUE, so CUE is reported, never scored.
    // If this ever fails, a display figure has started steering the answer.
    const weights = { cost: 1, availability: 1, sustainability: 1, speed: 1 };
    const withNone = recommendConfigurations(false, 9000, weights, 5, null);
    const withClean = recommendConfigurations(false, 9000, weights, 5, 41);
    const withDirty = recommendConfigurations(false, 9000, weights, 5, 1306);

    const ids = (r: typeof withNone) =>
      r.map((c) => `${c.config.tier}/${c.config.redundancy}/${c.config.cooling}`);
    expect(ids(withClean)).toEqual(ids(withNone));
    expect(ids(withDirty)).toEqual(ids(withNone));
  });

  it("reports CUE through the recommendation path when a grid is known", () => {
    const weights = { cost: 1, availability: 1, sustainability: 1, speed: 1 };
    expect(recommendConfigurations(false, 9000, weights, 5, null)[0].profile.cue).toBeNull();
    expect(recommendConfigurations(false, 9000, weights, 5, 474)[0].profile.cue).not.toBeNull();
  });
});
