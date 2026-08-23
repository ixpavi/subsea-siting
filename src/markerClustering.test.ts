import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clusterPoints, clusterCellDeg, clusterRadiusScale } from "./markerClustering";

const p = (lat: number, lng: number, id = "") => ({ lat, lng, id });

describe("clusterCellDeg", () => {
  it("stops clustering entirely when the camera is close", () => {
    // At city zoom the user is asking exactly where facilities are; a cluster
    // marker there would be hiding the answer.
    expect(clusterCellDeg(0.3)).toBe(0);
    expect(clusterCellDeg(0.2)).toBe(0);
  });

  it("clusters more aggressively the further out the camera is", () => {
    const near = clusterCellDeg(0.5);
    const mid = clusterCellDeg(1.0);
    const far = clusterCellDeg(2.2);
    expect(near).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(near);
    expect(far).toBeGreaterThan(mid);
  });
});

describe("clusterPoints", () => {
  it("returns every point individually when clustering is off", () => {
    const pts = [p(10, 10), p(10.01, 10.01), p(-40, 120)];
    const out = clusterPoints(pts, 0);
    expect(out).toHaveLength(3);
    expect(out.every((c) => c.members.length === 1)).toBe(true);
  });

  it("keeps a lone facility at its exact position", () => {
    // Snapping a single known facility to a cell centre would move a real
    // location for no benefit.
    const out = clusterPoints([p(51.5074, -0.1278)], 2.5);
    expect(out[0].lat).toBeCloseTo(51.5074, 10);
    expect(out[0].lng).toBeCloseTo(-0.1278, 10);
  });

  it("groups nearby points and keeps the full membership", () => {
    const pts = [p(51.5, -0.1), p(51.6, -0.2), p(51.4, 0.0), p(-33.9, 151.2)];
    const out = clusterPoints(pts, 2.5);
    const total = out.reduce((n, c) => n + c.members.length, 0);
    // Nothing may be lost or duplicated: a facility silently dropped from the
    // map is worse than one drawn badly.
    expect(total).toBe(pts.length);
    // Three London-area points collapse into fewer markers, and Sydney stays
    // its own. Not asserting all three merge -- see the boundary case below.
    expect(out.length).toBeLessThan(pts.length);
    expect(out.some((c) => c.members.length > 1)).toBe(true);
  });

  it("splits at cell boundaries, and that is expected", () => {
    // Documents a real property rather than hiding it. At a 2.5 degree cell
    // size a boundary lands on the prime meridian, so London sites either side
    // of it do not merge. Inherent to grid clustering; harmless because the
    // counts stay right and it resolves as the user zooms in.
    const out = clusterPoints([p(51.5, -0.1), p(51.5, 0.1)], 2.5);
    expect(out).toHaveLength(2);
    expect(out.reduce((n, c) => n + c.members.length, 0)).toBe(2);
  });

  it("places a cluster inside the spread of its members", () => {
    const pts = [p(50, 10), p(52, 12), p(51, 11)];
    const [c] = clusterPoints(pts, 5);
    expect(c.members).toHaveLength(3);
    expect(c.lat).toBeGreaterThanOrEqual(50);
    expect(c.lat).toBeLessThanOrEqual(52);
    expect(c.lng).toBeGreaterThanOrEqual(10);
    expect(c.lng).toBeLessThanOrEqual(12);
  });

  it("does not send an antimeridian cluster to the opposite side of the globe", () => {
    // Averaging +179 and -179 arithmetically gives 0 -- the Gulf of Guinea.
    // Same trap as the camera framing bug.
    const pts = [p(0, 179.5), p(0, -179.5)];
    const out = clusterPoints(pts, 2.5);
    for (const c of out) {
      const nearSeam = Math.abs(Math.abs(c.lng) - 180) < 2;
      expect(nearSeam).toBe(true);
    }
  });

  it("merges across the antimeridian rather than leaving a seam", () => {
    // Points 1 degree apart either side of the seam belong together.
    const pts = [p(0, 179.6), p(0, 179.9), p(0, -179.9)];
    const out = clusterPoints(pts, 5);
    expect(out.some((c) => c.members.length > 1)).toBe(true);
  });

  it("is deterministic and stable across calls", () => {
    const pts = [p(10, 10), p(10.5, 10.5), p(60, -70), p(-20, 100)];
    const a = clusterPoints(pts, 2);
    const b = clusterPoints(pts, 2);
    expect(a.map((c) => c.key)).toEqual(b.map((c) => c.key));
    expect(a.map((c) => c.members.length)).toEqual(b.map((c) => c.members.length));
  });

  it("does not depend on input order", () => {
    const pts = [p(10, 10, "a"), p(10.5, 10.5, "b"), p(60, -70, "c")];
    const forward = clusterPoints(pts, 2).map((c) => c.key).sort();
    const backward = clusterPoints([...pts].reverse(), 2).map((c) => c.key).sort();
    expect(forward).toEqual(backward);
  });
});

describe("clusterRadiusScale", () => {
  it("leaves a single facility at its normal size", () => {
    expect(clusterRadiusScale(1)).toBe(1);
  });

  it("grows sublinearly so a huge cluster is not a huge disc", () => {
    const ten = clusterRadiusScale(10);
    const thousand = clusterRadiusScale(1000);
    expect(ten).toBeGreaterThan(1);
    expect(thousand).toBeGreaterThan(ten);
    // 100x the members must not be anywhere near 100x the radius.
    expect(thousand / ten).toBeLessThan(3);
  });
});

describe("against the real facility dataset", () => {
  interface LandDC { lat: number; lng: number; name?: string }
  const dcs: LandDC[] = JSON.parse(
    readFileSync(join(process.cwd(), "public", "data", "land-dcs.json"), "utf-8")
  );

  it("loads the real dataset", () => {
    expect(dcs.length).toBeGreaterThan(5000);
  });

  it("substantially reduces marker count at low zoom", () => {
    const clusters = clusterPoints(dcs, clusterCellDeg(2.2));
    expect(clusters.length).toBeLessThan(dcs.length / 3);
  });

  it("never loses or duplicates a facility at any zoom level", () => {
    for (const alt of [2.2, 1.5, 1.0, 0.6, 0.3]) {
      const clusters = clusterPoints(dcs, clusterCellDeg(alt));
      const total = clusters.reduce((n, c) => n + c.members.length, 0);
      expect(total).toBe(dcs.length);
    }
  });

  it("resolves to individual facilities once the camera is close", () => {
    const clusters = clusterPoints(dcs, clusterCellDeg(0.3));
    expect(clusters).toHaveLength(dcs.length);
    expect(clusters.every((c) => c.members.length === 1)).toBe(true);
  });

  it("breaks clusters apart monotonically as the camera approaches", () => {
    const counts = [2.2, 1.5, 1.0, 0.6, 0.3].map(
      (alt) => clusterPoints(dcs, clusterCellDeg(alt)).length
    );
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    }
  });
});
