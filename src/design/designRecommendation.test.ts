// The design recommendation, with the two hard requirements applied before
// any scoring: the Tier floor, and the site's climate.
import { describe, expect, it } from "vitest";
import { computeDesignResult, unviableCooling } from "./designRecommendation";
import type { ClimateProfile } from "../siting/climateProfile";
import type { DesignRequirement } from "./designTypes";

const requirement = (
  availabilityRequirement: "standard" | "high" | "mission-critical",
  primary: "cost" | "availability" | "sustainability" | "speed"
): DesignRequirement => ({
  businessContext: { industry: "Cloud / SaaS", availabilityRequirement, capacityMW: 10 },
  locationConnectivity: { location: { query: "" }, connectivityDestination: { query: "" } },
  priorities: { primary, secondary: null },
});

const climate = (freeCooling: number, evaporative: number) =>
  ({ freeCoolingFractionAt24C: freeCooling, evaporativeFractionAt20C: evaporative }) as ClimateProfile;

describe("computeDesignResult", () => {
  it("recommends 2N when availability comes first and Tier IV is required", () => {
    // It used to recommend N: Tier I's 40 hours of downtime, although ruled
    // out, set the scale and made 2N's extra uptime look like nothing.
    const r = computeDesignResult(requirement("mission-critical", "availability"), null, null)!;
    expect(r.top.config.tier).toBe("IV");
    expect(r.top.config.redundancy).toBe("2N");
  });

  it("never offers a configuration below the Tier floor", () => {
    const r = computeDesignResult(requirement("high", "cost"), null, null)!;
    for (const c of r.alternatives) expect(["III", "IV"]).toContain(c.config.tier);
  });

  it("leaves out free-air cooling where the climate cannot carry it, and says why", () => {
    // Chennai-like: outside air below 24 C for 4% of the year.
    const r = computeDesignResult(requirement("standard", "speed"), null, climate(0.04, 0.1))!;
    expect(r.climateScreened).toBe(true);
    expect(r.excludedCooling.map((x) => x.cooling)).toEqual(["free-air"]);
    expect(r.excludedCooling[0].reason).toMatch(/only about \d+% of the year/);
    for (const c of r.alternatives) expect(c.config.cooling).not.toBe("free-air");
  });

  it("keeps free-air where the climate supports it", () => {
    // Speed first favours the simplest cooling, which is free-air.
    const r = computeDesignResult(requirement("standard", "speed"), null, climate(0.8, 0.9))!;
    expect(r.excludedCooling).toEqual([]);
    expect(r.alternatives.some((c) => c.config.cooling === "free-air")).toBe(true);
  });

  it("says when the climate was not available to screen against", () => {
    const r = computeDesignResult(requirement("standard", "cost"), null, null)!;
    expect(r.climateScreened).toBe(false);
    expect(r.excludedCooling).toEqual([]);
  });
});

describe("unviableCooling", () => {
  it("uses the same threshold as the cooling assessment's warning", () => {
    expect(unviableCooling(climate(0.1, 0.1))).toHaveLength(1); // ~19% combined
    expect(unviableCooling(climate(0.2, 0))).toHaveLength(0); // exactly 20%
  });
});
