import { describe, it, expect } from "vitest";
import {
  analyzeWeightSensitivity,
  SELECTABLE_WEIGHT_LEVELS,
  type SensitivityCandidate,
} from "./weightSensitivity";
import type { RoutingCriterionId, RoutingProfileId, RoutingWeights } from "./routingTypes";

const EVEN: RoutingWeights = { length: 1, seabedDifficulty: 1, resilience: 1, environmental: 1 };

function cand(
  id: RoutingProfileId,
  n: Partial<Record<RoutingCriterionId, number>>
): SensitivityCandidate {
  return {
    id,
    label: id,
    normalized: {
      length: n.length ?? 0,
      seabedDifficulty: n.seabedDifficulty ?? 0,
      resilience: n.resilience ?? 0,
      environmental: n.environmental ?? 0,
    },
  };
}

describe("analyzeWeightSensitivity", () => {
  it("reports a dominant candidate as unconditional", () => {
    // Best on everything: no weighting can dethrone it, and saying otherwise
    // would understate a genuinely robust result.
    const best = cand("shortest", { length: 1, seabedDifficulty: 1, resilience: 1 });
    const worse = cand("shallow-favoring", { length: 0.2, seabedDifficulty: 0.1, resilience: 0.3 });
    const r = analyzeWeightSensitivity([best, worse], EVEN, ["length", "seabedDifficulty", "resilience"]);
    expect(r.currentWinner).toBe("shortest");
    expect(r.unconditional).toBe(true);
    expect(r.winShare).toBeCloseTo(1, 6);
    expect(r.summary).toMatch(/does not depend on the weights/i);
  });

  it("finds the weight at which the winner flips", () => {
    // A wins on length, B wins on seabed. Raising the seabed weight far enough
    // must hand it to B, and the reported flip point must be a real one.
    const a = cand("shortest", { length: 1, seabedDifficulty: 0 });
    const b = cand("shallow-favoring", { length: 0, seabedDifficulty: 1 });
    // Length at its minimum selectable weight, so raising seabed can overtake it.
    const current: RoutingWeights = { length: 0.5, seabedDifficulty: 0.5, resilience: 0, environmental: 0 };
    const r = analyzeWeightSensitivity([a, b], current, ["length", "seabedDifficulty"]);
    expect(r.currentWinner).toBe("shortest");
    const seabed = r.perCriterion.find((c) => c.id === "seabedDifficulty")!;
    expect(seabed.applicable).toBe(true);
    expect(seabed.flipsAt).not.toBeNull();
    expect(seabed.flipsTo).toBe("shallow-favoring");
    // Below the flip the original winner holds; at or above it, the rival.
    const below = seabed.sweep.filter((s) => s.weight < seabed.flipsAt!);
    expect(below.every((s) => s.winner === "shortest")).toBe(true);
  });

  it("does not claim a flip that never happens", () => {
    const a = cand("shortest", { length: 1, seabedDifficulty: 1 });
    const b = cand("shallow-favoring", { length: 0.1, seabedDifficulty: 0.1 });
    const r = analyzeWeightSensitivity([a, b], EVEN, ["length", "seabedDifficulty"]);
    for (const c of r.perCriterion.filter((x) => x.applicable)) {
      expect(c.flipsAt).toBeNull();
      expect(c.flipsTo).toBeNull();
    }
  });

  it("marks non-discriminating criteria inapplicable rather than robust", () => {
    // The trap: a criterion nothing varies on can never flip the winner, so a
    // naive sweep reports "never flips" -- which reads as robustness when it
    // actually means the criterion said nothing at all.
    const a = cand("shortest", { length: 1, environmental: 0.5 });
    const b = cand("shallow-favoring", { length: 0.4, environmental: 0.5 });
    const r = analyzeWeightSensitivity([a, b], EVEN, ["length"]);
    const env = r.perCriterion.find((c) => c.id === "environmental")!;
    expect(env.applicable).toBe(false);
    expect(env.sweep).toHaveLength(0);
  });

  it("calls a knife-edge result what it is", () => {
    // Near-mirror candidates: each wins about half the weighting space, so the
    // recommendation is an artefact of the slider positions.
    const a = cand("shortest", { length: 1, seabedDifficulty: 0, resilience: 1 });
    const b = cand("shallow-favoring", { length: 0, seabedDifficulty: 1, resilience: 0 });
    const r = analyzeWeightSensitivity([a, b], EVEN, ["length", "seabedDifficulty", "resilience"]);
    expect(r.unconditional).toBe(false);
    expect(r.winShare).toBeLessThan(1);
    expect(r.contenders.length).toBeGreaterThan(1);
  });

  it("shares sum to one across contenders", () => {
    const a = cand("shortest", { length: 1, seabedDifficulty: 0.2 });
    const b = cand("shallow-favoring", { length: 0.3, seabedDifficulty: 1 });
    const c = cand("diverse-corridor", { length: 0.6, seabedDifficulty: 0.6 });
    const r = analyzeWeightSensitivity([a, b, c], EVEN, ["length", "seabedDifficulty"]);
    const total = r.contenders.reduce((s, x) => s + x.share, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("says plainly when nothing discriminates", () => {
    const a = cand("shortest", { length: 0.5 });
    const b = cand("shallow-favoring", { length: 0.5 });
    const r = analyzeWeightSensitivity([a, b], EVEN, []);
    expect(r.gridPoints).toBe(0);
    expect(r.summary).toMatch(/carries no information/i);
  });

  it("is deterministic", () => {
    const a = cand("shortest", { length: 1, seabedDifficulty: 0.3 });
    const b = cand("shallow-favoring", { length: 0.3, seabedDifficulty: 1 });
    const first = analyzeWeightSensitivity([a, b], EVEN, ["length", "seabedDifficulty"]);
    const second = analyzeWeightSensitivity([a, b], EVEN, ["length", "seabedDifficulty"]);
    expect(first.winShare).toBe(second.winShare);
    expect(first.summary).toBe(second.summary);
  });

  it("handles a single candidate without inventing a contest", () => {
    const only = cand("shortest", { length: 1 });
    const r = analyzeWeightSensitivity([only], EVEN, ["length"]);
    expect(r.currentWinner).toBe("shortest");
    // One candidate cannot be flipped by any weighting.
    expect(r.perCriterion.every((c) => c.flipsAt === null)).toBe(true);
  });

  it("sweeps exactly the weightings the UI can produce", () => {
    // The grid must be the user's real option space: 4 selectable levels per
    // applicable criterion. Reporting robustness over weightings that cannot
    // be set would be a claim about a different tool.
    const a = cand("shortest", { length: 1 });
    const b = cand("shallow-favoring", { length: 0 });
    expect(analyzeWeightSensitivity([a, b], EVEN, ["length"]).gridPoints)
      .toBe(SELECTABLE_WEIGHT_LEVELS.length);
    expect(analyzeWeightSensitivity([a, b], EVEN, ["length", "seabedDifficulty"]).gridPoints)
      .toBe(SELECTABLE_WEIGHT_LEVELS.length ** 2);
  });

  it("only reports flip points a user could actually select", () => {
    const a = cand("shortest", { length: 1, seabedDifficulty: 0 });
    const b = cand("shallow-favoring", { length: 0, seabedDifficulty: 1 });
    const current: RoutingWeights = { length: 0.5, seabedDifficulty: 0.5, resilience: 0, environmental: 0 };
    const r = analyzeWeightSensitivity([a, b], current, ["length", "seabedDifficulty"]);
    for (const c of r.perCriterion.filter((x) => x.applicable)) {
      for (const step of c.sweep) {
        expect(SELECTABLE_WEIGHT_LEVELS).toContain(step.weight as never);
      }
      if (c.flipsAt !== null) expect(SELECTABLE_WEIGHT_LEVELS).toContain(c.flipsAt as never);
    }
  });
});
