import { describe, expect, it } from "vitest";
import { roundTripMs } from "./latency";

describe("roundTripMs", () => {
  it("is about 1 ms per 100 km of fibre", () => {
    // 4.9 us/km one way, doubled: 0.98 ms per 100 km.
    expect(roundTripMs(100)).toBeCloseTo(0.98, 6);
  });

  it("puts a 17,000 km route at roughly 167 ms", () => {
    expect(roundTripMs(17_000)).toBeCloseTo(166.6, 1);
  });
});
