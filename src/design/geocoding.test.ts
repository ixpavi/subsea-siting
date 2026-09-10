// The place search has to find the city a user is typing toward BEFORE they
// finish typing it. These fixtures are real Photon responses for partial
// names, recorded while diagnosing the report that the search "doesn't show a
// relevant city until fully typed". Photon can let a closer text match beat a
// much larger place, so the wanted city is not always its first hit;
// rankPhotonFeatures has to fix that without dropping anything, and without
// undoing what Photon already gets right (Tokyo for "Toky").
import { describe, expect, it } from "vitest";
import { rankPhotonFeatures, settlementRank } from "./geocoding";

type Fixture = [osmValue: string, name: string, state: string | undefined, country: string, cc: string, lng: number, lat: number];

const feature = ([osmValue, name, state, country, cc, lng, lat]: Fixture, osmKey = "place") => ({
  geometry: { coordinates: [lng, lat] as [number, number] },
  properties: { osm_key: osmKey, osm_value: osmValue, name, state, country, countrycode: cc },
});

// Photon's own order for "Mumb", verbatim.
const MUMB: Fixture[] = [
  ["town", "Mumbué", "Bié Province", "Angola", "AO", 16.0, -12.1],
  ["city", "Mumbai", "Maharashtra", "India", "IN", 72.8777, 19.076],
  ["village", "Mumbu", "West Nusa Tenggara", "Indonesia", "ID", 116.3, -8.6],
  ["village", "Mumbi", "Eastern Province", "Zambia", "ZM", 32.1, -13.6],
  ["village", "Mumbles", "Wales", "United Kingdom", "GB", -4.0, 51.57],
  ["town", "Mumbwa", "Central Province", "Zambia", "ZM", 27.06, -14.98],
];

// Photon's own order for "Bangalo", verbatim.
const BANGALO: Fixture[] = [
  ["locality", "Bangalow", "New South Wales", "Australia", "AU", 153.5, -28.69],
  ["city", "Bengaluru", "Karnataka", "India", "IN", 77.5946, 12.9716],
  ["village", "Bangaloko", "Basse-Kotto", "Central African Republic", "CF", 21.5, 4.9],
  ["village", "Bagnolo", "Veneto", "Italy", "IT", 11.4, 45.4],
  ["city", "Bangaon", "West Bengal", "India", "IN", 88.82, 23.05],
];

// Photon's own order for "Toky": Tokyo first, tagged place=province, with the
// town of Toki (place=city) sixth. A city-first ranking demoted Tokyo below it.
const TOKY: Fixture[] = [
  ["province", "Tokyo", undefined, "Japan", "JP", 139.6917, 35.6895],
  ["village", "Toky", "Ternopil Oblast", "Ukraine", "UA", 25.9, 49.5],
  ["village", "Toky", "Mandoul", "Chad", "TD", 18.1, 8.8],
  ["village", "Tokyedogo", "Sahel", "Burkina Faso", "BF", -0.5, 14.1],
  ["village", "Tokio", "Central Province", "Papua New Guinea", "PG", 147.2, -9.4],
  ["city", "Toki", "Gifu Prefecture", "Japan", "JP", 137.18, 35.35],
  ["town", "Tok", "Alaska", "United States", "US", -142.98, 63.34],
];

// Photon's own order for "Mosc": the region before the city of the same name.
const MOSC: Fixture[] = [
  ["state", "Moscow", undefined, "Russia", "RU", 37.3, 55.5],
  ["city", "Moscow", "Moscow", "Russia", "RU", 37.6173, 55.7558],
  ["city", "Moscow", "Idaho", "United States", "US", -117.0, 46.73],
];

// Photon's own order for "Singa": a village first, the city fourth.
const SINGA: Fixture[] = [
  ["village", "Singa", "Department of Huánuco", "Peru", "PE", -76.6, -9.3],
  ["country", "Singapore", undefined, "Singapore", "SG", 103.8, 1.36],
  ["village", "Singa", "North Sumatra", "Indonesia", "ID", 98.9, 2.5],
  ["city", "Singapore", undefined, "Singapore", "SG", 103.8198, 1.3521],
];

describe("place search ranking on partial names", () => {
  it("puts Mumbai first for 'Mumb', ahead of Mumbue, Angola", () => {
    const r = rankPhotonFeatures(MUMB.map((f) => feature(f)), "Mumb");
    expect(r[0].displayName).toBe("Mumbai, Maharashtra, India");
    expect(r[0].lat).toBeCloseTo(19.076, 3);
    expect(r[0].lng).toBeCloseTo(72.8777, 3);
  });

  it("puts Bengaluru first for 'Bangalo', ahead of Bangalow, Australia", () => {
    const r = rankPhotonFeatures(BANGALO.map((f) => feature(f)), "Bangalo");
    expect(r[0].displayName).toBe("Bengaluru, Karnataka, India");
  });

  it("puts Singapore the city first, and does not list it twice", () => {
    const r = rankPhotonFeatures(SINGA.map((f) => feature(f)), "Singa");
    expect(r[0].displayName).toBe("Singapore, Singapore");
    // The city is kept, not the country centroid it shares a name with.
    expect(r[0].lat).toBeCloseTo(1.3521, 3);
    expect(r.filter((x) => x.displayName === "Singapore, Singapore")).toHaveLength(1);
  });

  it("keeps Tokyo first for 'Toky', although OSM tags it a province", () => {
    const r = rankPhotonFeatures(TOKY.map((f) => feature(f)), "Toky");
    expect(r[0].displayName).toBe("Tokyo, Japan");
    // Toki is still offered -- ahead of the villages, behind Tokyo.
    expect(r[1].displayName).toBe("Toki, Gifu Prefecture, Japan");
  });

  it("uses the city's coordinates when a region shares its name", () => {
    const r = rankPhotonFeatures(MOSC.map((f) => feature(f)), "Mosc");
    expect(r[0].displayName).toBe("Moscow, Russia");
    expect(r[0].lat).toBeCloseTo(55.7558, 3);
    expect(r[0].lng).toBeCloseTo(37.6173, 3);
    expect(r.filter((x) => x.displayName === "Moscow, Russia")).toHaveLength(1);
    // The other Moscow is still there, and distinguishable.
    expect(r[1].displayName).toBe("Moscow, Idaho, United States");
  });

  it("only reorders -- keeps Photon's order within a class, drops nothing", () => {
    const r = rankPhotonFeatures(MUMB.map((f) => feature(f)), "Mumb");
    // city, then the two towns in Photon's order, then villages in Photon's order.
    expect(r.map((x) => x.displayName.split(",")[0])).toEqual(["Mumbai", "Mumbué", "Mumbwa", "Mumbu", "Mumbi"]);
  });

  it("still finds a village when it is the only match", () => {
    const only: Fixture[] = [["village", "Mumbles", "Wales", "United Kingdom", "GB", -4.0, 51.57]];
    expect(rankPhotonFeatures(only.map((f) => feature(f)), "Mumbles")[0].displayName).toBe(
      "Mumbles, Wales, United Kingdom"
    );
  });

  it("returns lowercase country codes, which country factors are keyed on", () => {
    const r = rankPhotonFeatures(MUMB.map((f) => feature(f)), "Mumb");
    expect(r[0].countryCode).toBe("in");
  });

  it("caps the list and skips features with no usable coordinates", () => {
    const broken = { geometry: {}, properties: { osm_key: "place", osm_value: "city", name: "Nowhere", country: "X" } };
    const r = rankPhotonFeatures([broken, ...MUMB.map((f) => feature(f))], "Mumb");
    expect(r.every((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng))).toBe(true);
    expect(r.some((x) => x.displayName.startsWith("Nowhere"))).toBe(false);
    expect(r.length).toBeLessThanOrEqual(5);
  });
});

describe("settlementRank", () => {
  it("puts every major place in one tier, so Photon's importance order decides among them", () => {
    for (const v of ["province", "state", "region", "country"]) {
      expect(settlementRank("place", v)).toBe(settlementRank("place", "city"));
    }
  });

  it("orders major places < towns < villages < anything else", () => {
    expect(settlementRank("place", "city")).toBeLessThan(settlementRank("place", "town"));
    expect(settlementRank("place", "town")).toBeLessThan(settlementRank("place", "village"));
    expect(settlementRank("place", "village")).toBeLessThan(settlementRank("place", "hamlet"));
    expect(settlementRank("boundary", "administrative")).toBe(settlementRank("place", "village"));
  });
});
