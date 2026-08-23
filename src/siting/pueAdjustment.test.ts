import { describe, it, expect } from "vitest";
import { adjustPueForClimate } from "./pueAdjustment";
import type { PueModel } from "./pueAdjustment";

/** Mirrors the shape build-pue-model.mjs emits, with round numbers so the arithmetic is checkable by hand. */
const MODEL: PueModel = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  source: { name: "test", url: "https://example.invalid", quartersUsed: [] },
  provenance: "test",
  facilityCount: 31,
  best: "meanTempC",
  gradientMilliPuePerDegC: 3, // 0.003 PUE per degC
  fittedRange: { min: 5, max: 25, variable: "meanTempC" },
  observedPue: { min: 1.04, max: 1.16, median: 1.1 },
  predictors: [{ name: "meanTempC", r: 0.5, loo: 0.2, slope: 0.003, intercept: 1.0, meanX: 15, min: 5, max: 25 }],
  facilities: [],
};

describe("adjustPueForClimate", () => {
  it("returns the baseline unchanged at the fitted reference climate", () => {
    // The correction is centred on the fitted sample mean, so a typical site
    // must not be silently re-scaled.
    const a = adjustPueForClimate(MODEL, 1.2, 15);
    expect(a.deltaPue).toBeCloseTo(0, 9);
    expect(a.adjustedPue).toBeCloseTo(1.2, 9);
  });

  it("worsens PUE in a warmer climate and improves it in a cooler one", () => {
    const warm = adjustPueForClimate(MODEL, 1.2, 25);
    const cool = adjustPueForClimate(MODEL, 1.2, 5);
    expect(warm.adjustedPue).toBeGreaterThan(1.2);
    expect(cool.adjustedPue).toBeLessThan(1.2);
    expect(warm.deltaPue).toBeCloseTo(0.03, 9); // 10 degC * 0.003
    expect(cool.deltaPue).toBeCloseTo(-0.03, 9);
  });

  /**
   * The fit comes from Google's hyperscale fleet (observed PUE 1.04-1.16),
   * whose absolute efficiency is not transferable to other facility classes.
   * Only the gradient may be applied; the intercept must never leak in.
   */
  it("transfers the gradient only, never the fitted intercept", () => {
    const a = adjustPueForClimate(MODEL, 1.6, 15); // air-cooled baseline
    // If the intercept (1.0) leaked in, this would collapse toward ~1.0.
    expect(a.adjustedPue).toBeCloseTo(1.6, 9);
    expect(a.baselinePue).toBe(1.6);
  });

  it("preserves the spacing between different cooling baselines", () => {
    const immersion = adjustPueForClimate(MODEL, 1.08, 28);
    const airCooled = adjustPueForClimate(MODEL, 1.6, 28);
    // Same climate shift applied to both, so their gap is unchanged.
    expect(airCooled.adjustedPue - immersion.adjustedPue).toBeCloseTo(1.6 - 1.08, 9);
  });

  it("flags sites outside the fitted temperature range as extrapolated", () => {
    expect(adjustPueForClimate(MODEL, 1.2, 15).extrapolated).toBe(false);
    expect(adjustPueForClimate(MODEL, 1.2, 28).extrapolated).toBe(true);
    expect(adjustPueForClimate(MODEL, 1.2, 2).extrapolated).toBe(true);
  });

  it("never returns a thermodynamically impossible PUE below 1", () => {
    // An unclamped extrapolation to an extremely cold site could otherwise
    // claim a facility uses less total power than its IT load.
    const a = adjustPueForClimate(MODEL, 1.02, -200);
    expect(a.adjustedPue).toBeGreaterThanOrEqual(1.0);
  });

  it("states its own basis for display", () => {
    const a = adjustPueForClimate(MODEL, 1.2, 20);
    expect(a.basis).toMatch(/gradient/i);
    expect(a.basis).toMatch(/31/);
  });
});
