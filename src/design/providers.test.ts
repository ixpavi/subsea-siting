// "Who is already active here" -- tested on a hand-built case for the rules,
// and on the real Chennai -> New York data for the answer a user sees.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { providersForPlan, summarizeProviders, type CableDetailsFile } from "./providers";
import { analyzeConnectivity, type ConnectivityAnalysis, type RelevantCable } from "./connectivityAnalysis";
import type { CableFeature, LandDC, LandingPoint } from "../types";

const lp = (id: string) => ({ id, name: id, lat: 0, lng: 0, distanceFromQueryKm: 1 });
const cable = (id: string, site: boolean, dest: boolean): RelevantCable => ({
  id,
  name: id.toUpperCase(),
  color: "#fff",
  paths: [],
  sourceLandingPoints: site ? [lp("s")] : [],
  destinationLandingPoints: dest ? [lp("d")] : [],
  relevance: site && dest ? "direct" : site ? "source-side" : "destination-side",
});

const analysis = (cables: RelevantCable[]): ConnectivityAnalysis => ({
  source: { lat: 10, lng: 10, landingPoints: [], nearestLandingPoints: [] },
  destination: { lat: 40, lng: 40, landingPoints: [], nearestLandingPoints: [] },
  relevantCables: cables,
  cableSystemDiversity: cables.length,
  directCableSystemDiversity: 0,
  sourceLandingPointDiversity: 1,
  destinationLandingPointDiversity: 1,
  searchRadiusKm: 80,
  endpointMatchToleranceKm: 2,
  dataProvenance: "test",
});

const details = (cables: CableDetailsFile["cables"]): CableDetailsFile => ({
  fetchedAt: "2026-01-01",
  source: "test",
  licence: "test",
  cables,
});
const rec = (owners: string[], suppliers: string[], planned = false) => ({
  owners,
  suppliers,
  rfsYear: 2020,
  planned,
  lengthKm: 1000,
  url: null,
});

describe("summarizeProviders", () => {
  const a = analysis([cable("a", true, false), cable("b", false, true), cable("c", true, false), cable("x", true, false)]);
  const d = details({
    a: rec(["Acme", "SiteOnly"], ["ASN"]),
    b: rec(["Acme", "DestOnly"], ["SubCom"]),
    c: rec(["Acme"], ["ASN"], true),
  });
  const s = summarizeProviders(a, d, []);

  it("finds the owners present at both ends", () => {
    expect(s.bothEnds.map((e) => e.name)).toEqual(["Acme"]);
    expect(s.bothEnds[0].cables.map((c) => c.name).sort()).toEqual(["A", "B", "C"]);
  });

  it("lists each other owner at its own end only", () => {
    expect(s.nearSite.map((e) => e.name)).toEqual(["SiteOnly"]);
    expect(s.nearDestination.map((e) => e.name)).toEqual(["DestOnly"]);
  });

  it("lists who built the cables, busiest first", () => {
    expect(s.builders.map((e) => e.name)).toEqual(["ASN", "SubCom"]);
    expect(s.builders[0].cables).toHaveLength(2);
  });

  it("keeps a planned cable marked as planned", () => {
    expect(s.bothEnds[0].cables.find((c) => c.name === "C")!.planned).toBe(true);
  });

  it("counts cables it has no record for, rather than hiding them", () => {
    expect(s.cablesWithoutRecord).toBe(1);
  });

  it("works with no detail file at all", () => {
    const none = summarizeProviders(a, null, []);
    expect(none.bothEnds).toEqual([]);
    expect(none.cablesWithoutRecord).toBe(4);
  });

  it("finds data-centre operators within the radius only", () => {
    const dcs = [
      { id: 1, name: "n1", org: "Near Co", city: "", country: "", lat: 10.1, lng: 10.1, netCount: 1 },
      { id: 2, name: "n2", org: "Near Co", city: "", country: "", lat: 10.2, lng: 10.0, netCount: 1 },
      { id: 3, name: "f1", org: "Far Co", city: "", country: "", lat: 12, lng: 12, netCount: 1 },
    ] as LandDC[];
    const r = summarizeProviders(a, d, dcs);
    expect(r.dcOperatorsNearSite).toEqual([{ name: "Near Co", facilities: 2 }]);
  });
});

describe("Chennai to New York, on the shipped data", () => {
  const DATA = join(process.cwd(), "public", "data");
  const read = <T,>(f: string): T => JSON.parse(readFileSync(join(DATA, f), "utf-8"));

  it("reads an inland site's providers at its nearest landing point", () => {
    const cables = read<CableFeature[]>("cables.json");
    const landingPoints = read<LandingPoint[]>("landing-points.json");
    const conn = analyzeConnectivity({ lat: 12.9716, lng: 77.5946 }, null, cables, landingPoints); // Bengaluru
    expect(conn.relevantCables).toHaveLength(0);
    const s = providersForPlan(conn, cables, landingPoints, read<CableDetailsFile>("cable-details.json"), read<LandDC[]>("land-dcs.json"));
    expect(s.siteAnchor?.name).toMatch(/Chennai/);
    expect(s.nearSite.length).toBeGreaterThan(0);
    // Data-centre operators are still found around Bengaluru itself.
    expect(s.dcOperatorsNearSite.length).toBeGreaterThan(0);
  });

  it("names the companies with cables at both ends", () => {
    const conn = analyzeConnectivity(
      { lat: 13.0827, lng: 80.2707 },
      { lat: 40.7128, lng: -74.006 },
      read<CableFeature[]>("cables.json"),
      read<LandingPoint[]>("landing-points.json")
    );
    const s = summarizeProviders(conn, read<CableDetailsFile>("cable-details.json"), read<LandDC[]>("land-dcs.json"));
    const both = s.bothEnds.map((e) => e.name);
    expect(both).toContain("Tata Communications");
    expect(both).toContain("Meta");
    expect(s.builders.map((e) => e.name)).toContain("SubCom");
    expect(s.dcOperatorsNearSite.length).toBeGreaterThan(0);
  });
});
