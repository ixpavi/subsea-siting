// The explore search has room for eight results per group, so ORDER decides
// what a user can find. These names are real ones from the shipped dataset,
// chosen because file-order substring matching buried the obvious answer.
import { describe, expect, it } from "vitest";
import { buildCableNetworkIndex, searchNetwork } from "./cableNetwork";
import type { CableFeature, LandingPoint } from "./types";

const cable = (id: string, name: string): CableFeature => ({ id, name, color: "#fff", paths: [] });
const lp = (id: string, name: string): LandingPoint => ({ id, name, lat: 0, lng: 0 });

const CABLES = [
  cable("rising-8", "RISING 8"),
  cable("lake-michigan-chicago-crossing", "Lake Michigan Chicago Crossing"),
  cable("atlantic-crossing-1-ac-1", "Atlantic Crossing-1 (AC-1)"),
  cable("vietnam-singapore-cable-system-vts", "Vietnam-Singapore Cable System (VTS)"),
  cable("singapore-myanmar", "Singapore-Myanmar"),
  cable("seamewe-5", "SeaMeWe-5"),
  cable("marea", "MAREA"),
];

const LANDING_POINTS = [
  lp("markgrafenheide", "Markgrafenheide, Germany"),
  lp("maruyama", "Maruyama, Japan"),
  lp("mersing", "Mersing, Malaysia"),
  lp("helsingborg", "Helsingborg, Sweden"),
  lp("tuas", "Tuas, Singapore"),
  lp("changi-north", "Changi North, Singapore"),
  lp("marseille", "Marseille, France"),
  lp("santa-maria", "Santa Maria, Brazil"),
  lp("bude", "Bude, United Kingdom"),
];

const index = buildCableNetworkIndex(CABLES, LANDING_POINTS);
const names = (items: { name: string }[]) => items.map((i) => i.name);

describe("network search ranking", () => {
  it("puts names that start with the query first", () => {
    const r = searchNetwork("sing", index);
    expect(r.cables[0].name).toBe("Singapore-Myanmar");
  });

  it("ranks a word that starts with the query above a match inside a word", () => {
    const r = names(searchNetwork("sing", index).cables);
    expect(r.indexOf("Vietnam-Singapore Cable System (VTS)")).toBeLessThan(r.indexOf("RISING 8"));
    expect(r.indexOf("Vietnam-Singapore Cable System (VTS)")).toBeLessThan(r.indexOf("Atlantic Crossing-1 (AC-1)"));
  });

  it("lists a country's landing points before names that merely contain the query", () => {
    const r = names(searchNetwork("sing", index).landingPoints);
    expect(r.slice(0, 2).sort()).toEqual(["Changi North, Singapore", "Tuas, Singapore"]);
    expect(r).toContain("Mersing, Malaysia");
    expect(r).toContain("Helsingborg, Sweden");
  });

  it("finds Marseille for 'mar', among the places that start with it", () => {
    const r = names(searchNetwork("mar", index).landingPoints);
    expect(r.slice(0, 3)).toContain("Marseille, France");
    // A word inside the place name still counts, but after the prefixes.
    expect(r.indexOf("Santa Maria, Brazil")).toBeGreaterThan(r.indexOf("Marseille, France"));
  });

  it("puts busier landing points first among equally good matches", () => {
    // The real dataset has more than eight "Mar..." landing points, and
    // alphabetical order cut Marseille -- one of Europe's busiest -- off the
    // list. Cables that land there should lift it to the top.
    const at = (id: string, name: string, lat: number, lng: number): LandingPoint => ({ id, name, lat, lng });
    const landingAtMarseille = (id: string): CableFeature => ({
      id,
      name: id,
      color: "#fff",
      paths: [[[43.3, 5.37], [40, 10]]],
    });
    const idx = buildCableNetworkIndex(
      [landingAtMarseille("c1"), landingAtMarseille("c2")],
      [at("maracaibo", "Maracaibo, Venezuela", 10.6, -71.6), at("marseille", "Marseille, France", 43.3, 5.37)]
    );
    expect(searchNetwork("mar", idx, 1).landingPoints[0].name).toBe("Marseille, France");
  });

  it("ignores punctuation as a last resort, so 'sea-me-we' finds SeaMeWe-5", () => {
    expect(names(searchNetwork("sea-me-we", index).cables)).toContain("SeaMeWe-5");
    expect(names(searchNetwork("seamewe 5", index).cables)).toContain("SeaMeWe-5");
  });

  it("still matches nothing it should not -- no fuzzy matching", () => {
    expect(searchNetwork("xyzzy", index)).toEqual({ cables: [], landingPoints: [] });
    expect(searchNetwork("   ", index)).toEqual({ cables: [], landingPoints: [] });
  });

  it("respects the limit after ranking, not before", () => {
    const r = searchNetwork("a", index, 2);
    expect(r.cables).toHaveLength(2);
    expect(r.landingPoints).toHaveLength(2);
  });
});
