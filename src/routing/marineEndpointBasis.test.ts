// An inland site's marine access point has to explain itself.
//
// THE CASE THAT PROMPTED THIS. Bangalore -> Moscow put a marker on the Kerala
// coast, which sits next to Kochi on the globe, and the panel said only that a
// modelled point had been derived. Read as "the app chose Kochi as the landing
// point" -- reasonable, and wrong twice over: no landing point was chosen at
// all, and the nearest one is Chennai, on the other coast.
//
// The numbers, measured against the shipped dataset:
//   Chennai landing point   287 km from Bangalore  (nearest real landing point)
//   Kochi landing point     367 km
//   nearest ocean cell      277 km, at 11.25N 75.75E, Arabian Sea
//
// So the fallback is correct -- the ocean cell really is closer than the
// nearest landing point -- but it lands on the opposite coast, and nothing
// said so. These tests pin the disclosure, not the arithmetic.
import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveMarineEndpoint } from "./hypotheticalRouting";
import type { OceanGrid } from "./oceanGrid";
import type { LandingPoint } from "../types";

const dataDir = join(process.cwd(), "public", "data");
const landingPoints: LandingPoint[] = JSON.parse(readFileSync(join(dataDir, "landing-points.json"), "utf-8"));

let grid: OceanGrid;
beforeAll(() => {
  const meta = JSON.parse(readFileSync(join(dataDir, "ocean-depth.json"), "utf-8"));
  const bin = readFileSync(join(dataDir, meta.binary));
  grid = {
    ...meta,
    depthM: new Int16Array(bin.buffer, bin.byteOffset, bin.byteLength / 2),
  } as OceanGrid;
});

const BANGALORE = { lat: 12.9716, lng: 77.5946, label: "Bangalore" };
const CHENNAI_LP = { lat: 13.0827, lng: 80.2707 };

describe("an inland site falling back to a modelled access point", () => {
  it("uses a modelled ocean cell, not a landing point", () => {
    const e = resolveMarineEndpoint(BANGALORE.lat, BANGALORE.lng, BANGALORE.label, landingPoints, grid);
    expect(e.kind).toBe("modeled-access-point");
    expect(e.landingPointName).toBeNull();
  });

  it("names the landing point it passed over, and by how far it missed", () => {
    const e = resolveMarineEndpoint(BANGALORE.lat, BANGALORE.lng, BANGALORE.label, landingPoints, grid);
    expect(e.nearestLandingPoint).not.toBeNull();
    expect(e.nearestLandingPoint!.name).toMatch(/Chennai/i);
    // Roughly 287 km -- outside the radius, which is the whole reason it was
    // not used.
    expect(e.nearestLandingPoint!.distanceKm).toBeGreaterThan(e.searchRadiusKm);
    expect(e.note).toMatch(/Chennai/);
    expect(e.note).toMatch(/beyond the/i);
  });

  it("says where on the coast the modelled point actually is", () => {
    const e = resolveMarineEndpoint(BANGALORE.lat, BANGALORE.lng, BANGALORE.label, landingPoints, grid);
    expect(e.localityReference).not.toBeNull();
    // Coordinates in the note, so the point is identifiable rather than just
    // a dot next to a city the user recognises.
    expect(e.note).toMatch(/\d+\.\d\d,\s*-?\d+\.\d\d/);
    // And it must disclaim the locality name it uses.
    expect(e.note).toMatch(/not because a cable lands there/i);
  });

  it("resolves to the coast nearer than the passed-over landing point", () => {
    const e = resolveMarineEndpoint(BANGALORE.lat, BANGALORE.lng, BANGALORE.label, landingPoints, grid);
    // The fallback is only defensible if the cell really is closer; if this
    // ever inverts, the rule itself is wrong, not just its explanation.
    expect(e.terrestrialAccessKm!).toBeLessThan(e.nearestLandingPoint!.distanceKm);
  });

  it("still prefers a real landing point when one is inside the radius", () => {
    // Chennai city itself sits on top of its landing point.
    const e = resolveMarineEndpoint(CHENNAI_LP.lat, CHENNAI_LP.lng, "Chennai", landingPoints, grid);
    expect(e.kind).toBe("real-landing-point");
    expect(e.landingPointName).toMatch(/Chennai/i);
    expect(e.localityReference).toBeNull();
    expect(e.note).toMatch(/inside the .* radius/i);
  });

  it("always reports the radius it applied", () => {
    const e = resolveMarineEndpoint(BANGALORE.lat, BANGALORE.lng, BANGALORE.label, landingPoints, grid);
    expect(e.searchRadiusKm).toBeGreaterThan(0);
    expect(e.note).toContain(String(e.searchRadiusKm));
  });
});
