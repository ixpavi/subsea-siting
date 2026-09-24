// The planner cannot start without a site, and the place search is an online
// service. These pin the offline fallback: it finds the cities people type,
// by their old names too, and only steps in when the services are unreachable.
import { afterEach, describe, expect, it, vi } from "vitest";
import { searchMajorCities } from "./majorCities";
import { geocodeLocation } from "./geocoding";

describe("searchMajorCities", () => {
  it("finds a city from its first letters", () => {
    expect(searchMajorCities("Chenn")[0]).toMatchObject({ displayName: "Chennai, India", countryCode: "in" });
    expect(searchMajorCities("new y")[0].displayName).toBe("New York, United States");
  });

  it("knows the names people still use", () => {
    expect(searchMajorCities("Bangalore")[0].displayName).toBe("Bengaluru, India");
    expect(searchMajorCities("Bombay")[0].displayName).toBe("Mumbai, India");
  });

  it("ignores accents", () => {
    expect(searchMajorCities("sao pau")[0].displayName).toBe("São Paulo, Brazil");
  });

  it("marks every result as offline, with usable coordinates", () => {
    for (const r of searchMajorCities("s")) expect(r.offline).toBe(true);
    for (const r of searchMajorCities("lon")) {
      expect(Number.isFinite(r.lat) && Number.isFinite(r.lng)).toBe(true);
    }
  });
});

describe("geocodeLocation offline fallback", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("answers from the built-in list when both services are unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const r = await geocodeLocation("Madra");
    expect(r[0]).toMatchObject({ displayName: "Chennai, India", offline: true });
  });

  it("still reports the failure when no built-in city matches", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(geocodeLocation("Qwertyville")).rejects.toThrow();
  });
});
