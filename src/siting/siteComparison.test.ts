import { describe, it, expect } from "vitest";
import {
  compareSites,
  rawValue,
  SITE_CRITERIA,
  DEFAULT_SITE_WEIGHTS,
  type SiteEvaluation,
  type SiteCriterionId,
} from "./siteComparison";

/** Builds a site with only the fields the comparison actually reads, so a test
 *  failure points at the comparison logic rather than at fixture drift. */
function site(
  label: string,
  opts: {
    freeCoolingPct?: number | null;
    pue?: number | null;
    water?: number | null;
    carbon?: number | null;
    cables?: number | null;
    error?: string;
  } = {}
): SiteEvaluation {
  const {
    freeCoolingPct = 50,
    pue = 1.2,
    water = 2,
    carbon = 300,
    cables = 5,
    error = null,
  } = opts;
  return {
    id: label.toLowerCase(),
    label,
    lat: 0,
    lng: 0,
    countryCode: "xx",
    climate:
      freeCoolingPct === null
        ? null
        : ({ freeCoolingFractionAt24C: freeCoolingPct / 100 } as SiteEvaluation["climate"]),
    countryFactors:
      water === null && carbon === null
        ? null
        : ({
            waterStressScore: water,
            carbonIntensityGco2PerKwh: carbon,
          } as SiteEvaluation["countryFactors"]),
    cooling:
      pue === null
        ? null
        : ({ recommended: { adjustedPue: pue } } as SiteEvaluation["cooling"]),
    cableSystemsNearby: cables,
    error,
  };
}

describe("rawValue", () => {
  it("reads each criterion from the right place", () => {
    const s = site("A", { freeCoolingPct: 62, pue: 1.15, water: 3.4, carbon: 210, cables: 9 });
    expect(rawValue(s, "freeCooling")).toBeCloseTo(62, 6);
    expect(rawValue(s, "adjustedPue")).toBe(1.15);
    expect(rawValue(s, "waterStress")).toBe(3.4);
    expect(rawValue(s, "gridCarbon")).toBe(210);
    expect(rawValue(s, "connectivity")).toBe(9);
  });

  it("returns null rather than a default when data is absent", () => {
    const s = site("A", { freeCoolingPct: null, pue: null, water: null, carbon: null, cables: null });
    for (const id of Object.keys(SITE_CRITERIA) as SiteCriterionId[]) {
      expect(rawValue(s, id)).toBeNull();
    }
  });
});

describe("compareSites: ranking", () => {
  it("ranks a strictly better site first", () => {
    const good = site("Good", { freeCoolingPct: 80, pue: 1.1, water: 1, carbon: 100, cables: 10 });
    const bad = site("Bad", { freeCoolingPct: 20, pue: 1.6, water: 4, carbon: 600, cables: 2 });
    const r = compareSites([bad, good]);
    expect(r.ranked[0].evaluation.label).toBe("Good");
    expect(r.ranked[0].rank).toBe(1);
    expect(r.ranked[0].winsOn.sort()).toEqual(
      ["adjustedPue", "connectivity", "freeCooling", "gridCarbon", "waterStress"].sort()
    );
    expect(r.ranked[1].losesOn.length).toBeGreaterThan(0);
  });

  it("respects the direction of each criterion", () => {
    // Lower PUE, water stress and carbon are better; higher free cooling and
    // connectivity are better. A site that is best on the "lower is better"
    // criteria must not be penalised for having small numbers.
    const lowIsGood = site("Low", { freeCoolingPct: 50, pue: 1.05, water: 0.5, carbon: 50, cables: 5 });
    const highIsBad = site("High", { freeCoolingPct: 50, pue: 1.9, water: 4.9, carbon: 900, cables: 5 });
    const r = compareSites([highIsBad, lowIsGood]);
    expect(r.ranked[0].evaluation.label).toBe("Low");
  });

  it("is deterministic for tied sites, ordering by label", () => {
    const a = site("Alpha");
    const b = site("Bravo");
    const first = compareSites([b, a]);
    const second = compareSites([a, b]);
    expect(first.ranked.map((x) => x.evaluation.label)).toEqual(
      second.ranked.map((x) => x.evaluation.label)
    );
  });
});

describe("compareSites: what must not happen", () => {
  it("excludes a criterion missing for ANY site, not just for that site", () => {
    // The dangerous case. If water stress were scored only where known, the
    // site with no water data would score as though it had none -- ranking
    // higher precisely because less is known about it.
    const known = site("Known", { water: 4.8 });
    const unknown = site("Unknown", { water: null, carbon: 300 });
    const r = compareSites([known, unknown]);
    const water = r.criteria.find((c) => c.id === "waterStress")!;
    expect(water.discriminates).toBe(false);
    expect(water.excludedReason).toMatch(/1 of 2 sites/);
    // And the site with missing data must not have won because of it.
    expect(r.ranked.find((x) => x.evaluation.label === "Unknown")!.winsOn).not.toContain("waterStress");
  });

  it("excludes a criterion on which every site is identical", () => {
    const a = site("A", { carbon: 400 });
    const b = site("B", { carbon: 400 });
    const r = compareSites([a, b]);
    const carbon = r.criteria.find((c) => c.id === "gridCarbon")!;
    expect(carbon.discriminates).toBe(false);
    expect(carbon.excludedReason).toMatch(/identically/);
  });

  it("never awards a win on a criterion where the best value is tied", () => {
    const a = site("A", { cables: 7, pue: 1.1 });
    const b = site("B", { cables: 7, pue: 1.4 });
    const r = compareSites([a, b]);
    for (const s of r.ranked) expect(s.winsOn).not.toContain("connectivity");
  });

  it("reports an arbitrary ordering as arbitrary when nothing discriminates", () => {
    const a = site("A");
    const b = site("B");
    const r = compareSites([a, b]);
    expect(r.indeterminate).toBe(true);
    expect(r.ranked[0].whyText).toMatch(/arbitrary/i);
  });

  it("excludes a criterion weighted to zero", () => {
    const a = site("A", { carbon: 100 });
    const b = site("B", { carbon: 800 });
    const r = compareSites([a, b], { ...DEFAULT_SITE_WEIGHTS, gridCarbon: 0 });
    const carbon = r.criteria.find((c) => c.id === "gridCarbon")!;
    expect(carbon.discriminates).toBe(false);
    expect(carbon.excludedReason).toMatch(/zero/i);
  });

  it("keeps failed sites visible instead of silently dropping them", () => {
    const ok = site("OK");
    const broken = site("Broken", { error: "Climate lookup failed" });
    const r = compareSites([ok, broken]);
    expect(r.ranked).toHaveLength(1);
    expect(r.failed.map((f) => f.label)).toEqual(["Broken"]);
    expect(r.notes.join(" ")).toMatch(/could not be evaluated/);
  });

  it("handles every site failing without inventing a winner", () => {
    const r = compareSites([site("A", { error: "x" }), site("B", { error: "y" })]);
    expect(r.ranked).toHaveLength(0);
    expect(r.failed).toHaveLength(2);
    expect(r.indeterminate).toBe(true);
  });
});

describe("compareSites: scoring", () => {
  it("keeps scores within 0..1", () => {
    const sites = [
      site("A", { freeCoolingPct: 90, pue: 1.05, water: 0.2, carbon: 30, cables: 14 }),
      site("B", { freeCoolingPct: 10, pue: 1.8, water: 4.9, carbon: 850, cables: 1 }),
      site("C", { freeCoolingPct: 55, pue: 1.3, water: 2.5, carbon: 400, cables: 6 }),
    ];
    for (const s of compareSites(sites).ranked) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
    }
  });

  it("weights actually change the outcome", () => {
    // A is better on carbon, B is better on connectivity. Which wins should
    // follow the weights, or the weights are decorative.
    const a = site("A", { freeCoolingPct: 50, pue: 1.2, water: 2, carbon: 50, cables: 2 });
    const b = site("B", { freeCoolingPct: 50, pue: 1.2, water: 2, carbon: 800, cables: 12 });
    const carbonFirst = compareSites([a, b], {
      ...DEFAULT_SITE_WEIGHTS, gridCarbon: 10, connectivity: 1,
    });
    const cablesFirst = compareSites([a, b], {
      ...DEFAULT_SITE_WEIGHTS, gridCarbon: 1, connectivity: 10,
    });
    expect(carbonFirst.ranked[0].evaluation.label).toBe("A");
    expect(cablesFirst.ranked[0].evaluation.label).toBe("B");
  });
});

describe("criterion metadata", () => {
  it("declares provenance and a source for every criterion", () => {
    for (const id of Object.keys(SITE_CRITERIA) as SiteCriterionId[]) {
      const m = SITE_CRITERIA[id];
      expect(m.label).toBeTruthy();
      expect(m.source.length).toBeGreaterThan(20);
      expect(["REAL", "DERIVED", "MODELED"]).toContain(m.provenance);
    }
  });

  it("labels the PUE criterion as modelled, not measured", () => {
    // It is the only criterion that is not a published or directly derived
    // figure, and presenting it as real would misrepresent the whole table.
    expect(SITE_CRITERIA.adjustedPue.provenance).toBe("MODELED");
  });
});

describe("explanation text", () => {
  it("preserves acronyms and joins lists readably", () => {
    const winner = site("Winner", { freeCoolingPct: 95, pue: 1.02, carbon: 20, water: 1, cables: 9 });
    const other = site("Other", { freeCoolingPct: 10, pue: 1.7, carbon: 700, water: 4, cables: 2 });
    const why = compareSites([other, winner]).ranked[0].whyText;
    // Lowercasing the display label to fit a sentence produced "pue".
    expect(why).toContain("PUE");
    expect(why).not.toContain("pue ");
    // Three or more wins must not read "a and b and c".
    expect(why).not.toMatch(/ and .* and /);
    expect(why).toMatch(/,/);
  });

  it("says plainly when a top site wins nothing outright", () => {
    // Balanced winner: best overall, uniquely best on nothing.
    const a = site("A", { freeCoolingPct: 60, pue: 1.2, water: 1, carbon: 500, cables: 5 });
    const b = site("B", { freeCoolingPct: 60, pue: 1.2, water: 4, carbon: 100, cables: 5 });
    const r = compareSites([a, b]);
    expect(r.ranked[0].whyText.length).toBeGreaterThan(20);
  });
});
