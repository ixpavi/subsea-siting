// Downtime cost and availability are the same quantity in this model:
//   annualDowntimeCostUsd = annualDowntimeHours x rate
//   availabilityPct       = 100 - annualDowntimeHours / 87.6
// so after min-max normalisation they are identical, and scoring both gave
// downtime twice the influence it should have against sustainability and
// deployment speed.
import { describe, expect, it } from "vitest";
import { recommendConfigurations } from "./recommend";
import { calculateFacilityProfile } from "./facilityCalculator";
import type { PriorityWeights } from "./types";

const RATE = 9000;
const flat: PriorityWeights = { cost: 20, availability: 20, sustainability: 20, speed: 20 };

describe("downtime cost and availability are one axis", () => {
  it("are perfectly collinear, which is why they must not both score", () => {
    // Demonstrates the premise directly rather than asserting it in prose.
    const hours = [28.8, 22.0, 1.6, 0.4, 40.32, 1.04];
    const costs = hours.map((h) => Math.round(h * RATE));
    const avails = hours.map((h) => 100 - (h / 8760) * 100);
    const norm = (v: number[], hi: boolean) => {
      const mn = Math.min(...v);
      const mx = Math.max(...v);
      return v.map((x) => (hi ? (x - mn) / (mx - mn) : (mx - x) / (mx - mn)));
    };
    const nCost = norm(costs, false);
    const nAvail = norm(avails, true);
    for (let i = 0; i < hours.length; i++) {
      expect(nCost[i]).toBeCloseTo(nAvail[i], 3);
    }
  });

  it("gives sustainability real influence under flat priorities", () => {
    // With three independent axes and equal weights, sustainability carries a
    // third of the score. While downtime was scored twice it carried half,
    // and sustainability only a quarter -- so the greenest configuration was
    // pushed down the shortlist by an axis counted twice.
    const ranked = recommendConfigurations(false, RATE, flat, 5, null);
    expect(ranked.length).toBeGreaterThan(0);

    const sustainabilityOf = (c: (typeof ranked)[number]) => c.profile.pue + c.profile.wue;
    const best = Math.min(...ranked.map(sustainabilityOf));
    // The top of the shortlist should not be materially worse on
    // sustainability than the best option it was ranked against.
    expect(sustainabilityOf(ranked[0])).toBeLessThanOrEqual(best + 0.6);
  });

  it("does not let naming the same axis twice inflate it", () => {
    // Cost primary + availability secondary is one preference stated twice.
    // It must not outweigh the same preference stated once.
    const statedTwice: PriorityWeights = { cost: 100, availability: 60, sustainability: 20, speed: 20 };
    const statedOnce: PriorityWeights = { cost: 100, availability: 20, sustainability: 20, speed: 20 };
    const a = recommendConfigurations(false, RATE, statedTwice, 5, null);
    const b = recommendConfigurations(false, RATE, statedOnce, 5, null);
    expect(a.map((c) => c.config)).toEqual(b.map((c) => c.config));
    expect(a.map((c) => c.score)).toEqual(b.map((c) => c.score));
  });

  it("still ranks uptime first when uptime is the stated priority", () => {
    const uptimeFirst: PriorityWeights = { cost: 20, availability: 100, sustainability: 20, speed: 20 };
    const ranked = recommendConfigurations(false, RATE, uptimeFirst, 5, null);
    const top = calculateFacilityProfile(ranked[0].config);
    // Tier IV at 2N is the lowest-downtime combination available.
    expect(top.annualDowntimeHours).toBeLessThan(1);
  });

  it("labels the best-uptime candidate once, not twice", () => {
    const ranked = recommendConfigurations(false, RATE, flat, 5, null);
    for (const c of ranked) {
      const uptimeTags = c.tags.filter((t) => /availability|downtime cost/i.test(t));
      expect(uptimeTags.length).toBeLessThanOrEqual(1);
    }
  });
});
