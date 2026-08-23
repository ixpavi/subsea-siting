// Builds the TRAINING DATASET for the revealed-preference siting model
// (scripts/train-siting-model.mjs -> src/siting/*).
//
// THE CORE IDEA: where the industry has actually built data centres is a
// real label. This script assembles, for a global 1-degree land grid:
//   label   = does at least one real PeeringDB facility exist in this cell
//   features= climate, national grid carbon intensity, national water stress,
//             distance to real submarine-cable landing points, and
//             population/urbanisation proxies
// A model fitted to that learns which site characteristics coincide with
// real-world data-centre siting decisions -- rather than encoding my opinion
// about which characteristics ought to matter.
//
// CONFOUNDING, STATED UP FRONT: facility presence is driven enormously by
// population and economic activity. Without controlling for that, a model
// would mostly rediscover "cities exist" and dress it up as siting insight.
// The nearest-major-city distance and population features below exist
// specifically so the fitted model can separate "this is a populated place"
// from "this place has favourable siting characteristics". Interpretation of
// the trained coefficients must keep that in mind -- see the training script.
//
// CLIMATE SOURCE -- NASA POWER long-term monthly climatology (Langley
// Research Center), fetched via its regional endpoint at the native
// 0.5 deg x 0.625 deg grid.
//
// This replaces an earlier Open-Meteo/ERA5 approach that requested a full
// year of daily data per cell. That was worse on three counts, not one:
//   - It metered out. Open-Meteo's free tier bills by request WEIGHT
//     (locations x variables x days); a year of dailies for ~2,000 cells
//     exceeded the hourly allowance and the build stalled at 600 cells.
//   - It described a SINGLE YEAR (2024). A siting decision should not turn
//     on whether one year happened to be anomalous; POWER publishes
//     multi-decade normals, which is the correct statistic for this purpose.
//   - It had no wet-bulb variable at daily resolution. POWER provides
//     T2MWET directly, and wet bulb -- not dry bulb -- is what governs
//     evaporative and adiabatic cooling viability, so its absence was a
//     genuine gap in the feature set rather than a nice-to-have.
// One regional call returns ~357 grid points in about a second, so the whole
// job is a few hundred requests instead of tens of thousands of cell-years.
//
// Re-run manually; never fetched at app runtime.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "public", "data");
const CACHE = join(__dirname, ".cache");
if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });

const RESOLUTION_DEG = 1;
// 1:1 rather than 1.5:1. Open-Meteo's free tier meters by request WEIGHT
// (locations x variables x days), and a full year of daily data for
// thousands of cells exceeds the hourly allowance. A balanced class ratio is
// also perfectly adequate for logistic regression, so the extra negatives
// were buying very little at real cost.
const NEGATIVE_RATIO = 1.0;
const SEED = 20260823;
/** NASA POWER caps a regional query at 10 degrees per axis. */
const POWER_BLOCK_DEG = 10;
const POWER_PARAMS = ["T2M", "T2MWET"];
/** Polite spacing between POWER requests, and backoff if it pushes back. */
const REQUEST_DELAY_MS = 400;
const BACKOFF_MS = 30000;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const NE_COUNTRIES_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";
const NE_PLACES_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_populated_places.geojson";

/** Deterministic PRNG so the sampled negative set is reproducible across runs. */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function cachedFetchJson(url, cacheName) {
  const path = join(CACHE, cacheName);
  if (existsSync(path)) {
    console.log(`  ${cacheName} (cached)`);
    return JSON.parse(readFileSync(path, "utf-8"));
  }
  process.stdout.write(`  fetching ${cacheName}... `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${cacheName} failed: ${res.status}`);
  const text = await res.text();
  writeFileSync(path, text);
  console.log(`${(text.length / 1024).toFixed(0)} KB`);
  return JSON.parse(text);
}

// --- point-in-polygon (even-odd), with the antimeridian handling proven in
// build-ocean-grid.mjs. Kept local: these are build scripts, and duplicating
// a small pure function is safer than refactoring a script that is known to
// produce correct output.
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function pointInPolygon(x, y, rings) {
  if (!pointInRing(x, y, rings[0])) return false;
  for (let h = 1; h < rings.length; h++) if (pointInRing(x, y, rings[h])) return false;
  return true;
}
function ringHasAntimeridianEdge(ring) {
  for (let i = 1; i < ring.length; i++) if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) return true;
  return false;
}
function ringBounds(ring) {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLng, maxLng, minLat, maxLat };
}

console.log("Building siting training features...");

// --- 1. Country polygons -> land mask + country per cell -------------------
const countriesGeo = await cachedFetchJson(NE_COUNTRIES_URL, "ne_110m_admin_0_countries.geojson");
const countryPolys = [];
for (const f of countriesGeo.features) {
  const iso2 = (f.properties.ISO_A2_EH ?? f.properties.ISO_A2 ?? "").trim().toUpperCase();
  const geom = f.geometry;
  if (!geom || iso2.length !== 2 || iso2 === "-9") continue;
  const multi = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
  for (const rings of multi) {
    const wide = ringHasAntimeridianEdge(rings[0]);
    const useRings = wide ? rings.map((r) => r.map(([lng, lat]) => [lng < 0 ? lng + 360 : lng, lat])) : rings;
    countryPolys.push({ iso2, rings: useRings, wide, bounds: ringBounds(useRings[0]) });
  }
}
console.log(`  country polygons: ${countryPolys.length}`);

function countryAt(lat, lng) {
  for (const p of countryPolys) {
    if (lat < p.bounds.minLat || lat > p.bounds.maxLat) continue;
    if (p.wide) {
      if (pointInPolygon(lng, lat, p.rings) || pointInPolygon(lng + 360, lat, p.rings)) return p.iso2;
    } else {
      if (lng < p.bounds.minLng || lng > p.bounds.maxLng) continue;
      if (pointInPolygon(lng, lat, p.rings)) return p.iso2;
    }
  }
  return null;
}

// --- 2. Populated places (confounder control) ------------------------------
const placesGeo = await cachedFetchJson(NE_PLACES_URL, "ne_110m_populated_places.geojson");
const places = placesGeo.features
  .map((f) => ({
    lat: f.geometry?.coordinates?.[1],
    lng: f.geometry?.coordinates?.[0],
    pop: Number(f.properties.POP_MAX ?? f.properties.POP_MIN ?? 0) || 0,
  }))
  .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.pop > 0);
console.log(`  populated places: ${places.length}`);

function nearestCity(lat, lng) {
  let best = null;
  let bestD = Infinity;
  for (const p of places) {
    const d = haversineKm(lat, lng, p.lat, p.lng);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return { distanceKm: bestD, population: best ? best.pop : 0 };
}

// --- 3. Project datasets ---------------------------------------------------
const facilities = JSON.parse(readFileSync(join(DATA, "land-dcs.json"), "utf-8"));
const landingPoints = JSON.parse(readFileSync(join(DATA, "landing-points.json"), "utf-8"));
const sitingCountry = JSON.parse(readFileSync(join(DATA, "siting-country.json"), "utf-8"));
console.log(`  facilities: ${facilities.length}, landing points: ${landingPoints.length}`);

function nearestLandingKm(lat, lng) {
  let best = Infinity;
  for (const lp of landingPoints) {
    const d = haversineKm(lat, lng, lp.lat, lp.lng);
    if (d < best) best = d;
  }
  return best;
}

const cellKey = (lat, lng) => `${Math.floor(lat / RESOLUTION_DEG)},${Math.floor(lng / RESOLUTION_DEG)}`;
const cellCenter = (key) => {
  const [r, c] = key.split(",").map(Number);
  return { lat: (r + 0.5) * RESOLUTION_DEG, lng: (c + 0.5) * RESOLUTION_DEG };
};

// --- 4. Positive cells -----------------------------------------------------
const positive = new Map();
for (const f of facilities) {
  const key = cellKey(f.lat, f.lng);
  const cur = positive.get(key) ?? { facilityCount: 0, netCount: 0, iso2: f.country };
  cur.facilityCount++;
  cur.netCount += Number(f.netCount) || 0;
  positive.set(key, cur);
}
console.log(`  positive cells: ${positive.size}`);

// --- 5. Zero cells: PLAUSIBLE CANDIDATE locations with no facility ---------
//
// These are not "negatives" in the wilderness sense. An earlier version
// sampled uniformly from all land, which made the problem trivially easy --
// separating the Sahara from Dublin needs no model, and a fit trained that
// way scored a remote Costa Rican town at 0.76 while ranking Frankfurt, the
// largest European hub, at 0.57 (it is merely inland). The model had learned
// "coastal and near a city", which is not the question a siting tool has to
// answer.
//
// Zero cells are therefore drawn only from places that could plausibly host
// a facility -- reasonably close to a populated centre -- so the model must
// learn what separates a strong location from a merely viable one.
const rng = makeRng(SEED);
const targetZeros = Math.round(positive.size * NEGATIVE_RATIO);
const negative = new Map();
let attempts = 0;
const MAX_ATTEMPTS = targetZeros * 3000;
/** A cell qualifies as a candidate if a populated place of at least this size is within this distance. */
const CANDIDATE_MAX_CITY_KM = 250;
const CANDIDATE_MIN_CITY_POP = 100000;
process.stdout.write(`  sampling ${targetZeros} zero-facility CANDIDATE cells... `);
while (negative.size < targetZeros && attempts < MAX_ATTEMPTS) {
  attempts++;
  const lat = -60 + rng() * 135;
  const lng = -180 + rng() * 360;
  const key = cellKey(lat, lng);
  if (positive.has(key) || negative.has(key)) continue;
  const { lat: cLat, lng: cLng } = cellCenter(key);
  const iso2 = countryAt(cLat, cLng);
  if (!iso2) continue; // ocean
  const city = nearestCity(cLat, cLng);
  if (city.distanceKm > CANDIDATE_MAX_CITY_KM || city.population < CANDIDATE_MIN_CITY_POP) continue;
  negative.set(key, { facilityCount: 0, netCount: 0, iso2 });
}
console.log(`got ${negative.size} (${attempts} attempts)`);

// --- 6. Assemble rows ------------------------------------------------------
const rows = [];
for (const [key, meta] of [...positive.entries()].map((e) => [e[0], e[1]])) {
  rows.push({ key, label: 1, ...meta });
}
for (const [key, meta] of negative.entries()) rows.push({ key, label: 0, ...meta });
console.log(`  total rows: ${rows.length} (${positive.size} positive, ${negative.size} negative)`);

process.stdout.write("  computing geographic features... ");
for (const row of rows) {
  const { lat, lng } = cellCenter(row.key);
  row.lat = lat;
  row.lng = lng;
  const city = nearestCity(lat, lng);
  row.nearestCityDistanceKm = city.distanceKm;
  row.nearestCityPopulation = city.population;
  row.nearestLandingPointKm = nearestLandingKm(lat, lng);
  const iso3 = sitingCountry.iso2ToIso3[(row.iso2 || "").toLowerCase()] ?? null;
  const cf = iso3 ? sitingCountry.countries[iso3] : null;
  row.iso3 = iso3;
  row.carbonIntensityGco2PerKwh = cf?.carbonIntensityGco2PerKwh ?? null;
  row.waterStressScore = cf?.waterStressScore ?? null;
  row.lowCarbonSharePct = cf?.lowCarbonSharePct ?? null;
}
console.log("done");

// --- 7. Climate: NASA POWER monthly climatology ----------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch whole 10-degree blocks rather than individual cells. Only blocks that
// actually contain a training row are requested, and each block is cached on
// disk the moment it lands, so the job is resumable.
const blockKey = (lat, lng) => `${Math.floor(lat / POWER_BLOCK_DEG)},${Math.floor(lng / POWER_BLOCK_DEG)}`;
const neededBlocks = new Set(rows.map((r) => blockKey(r.lat, r.lng)));

// ONE FILE PER BLOCK, not one growing object rewritten each time. Each block
// is ~120 KB; re-serialising the whole accumulated cache after every fetch is
// quadratic in disk writes and would reach multiple GB of redundant I/O over
// a few hundred blocks.
const POWER_DIR = join(CACHE, "power-blocks");
if (!existsSync(POWER_DIR)) mkdirSync(POWER_DIR, { recursive: true });
const blockPath = (b) => join(POWER_DIR, `${b.replace(",", "_")}.json`);

const powerCache = {};
for (const b of neededBlocks) {
  const p = blockPath(b);
  if (existsSync(p)) {
    try {
      powerCache[b] = JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      /* corrupt/partial write from an interrupted run -- refetch it */
    }
  }
}
const missingBlocks = [...neededBlocks].filter((b) => !powerCache[b]);
console.log(`  POWER blocks: ${neededBlocks.size} needed, ${neededBlocks.size - missingBlocks.length} cached, ${missingBlocks.length} to fetch`);

async function fetchParam(param, latMin, lngMin) {
  const url =
    `https://power.larc.nasa.gov/api/temporal/climatology/regional?parameters=${param}` +
    `&community=RE&latitude-min=${latMin}&latitude-max=${latMin + POWER_BLOCK_DEG}` +
    `&longitude-min=${lngMin}&longitude-max=${lngMin + POWER_BLOCK_DEG}&format=JSON`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const j = await res.json();
        if (j.features) return j.features;
        return null; // POWER returned a structured error (e.g. all-ocean block)
      }
      await sleep(BACKOFF_MS);
    } catch {
      await sleep(BACKOFF_MS);
    }
  }
  return null;
}

let fetched = 0;
for (const b of missingBlocks) {
  const [br, bc] = b.split(",").map(Number);
  const latMin = br * POWER_BLOCK_DEG;
  const lngMin = bc * POWER_BLOCK_DEG;

  // POWER returns one FeatureCollection per parameter; merge them by point.
  const points = new Map();
  let ok = true;
  for (const param of POWER_PARAMS) {
    const feats = await fetchParam(param, latMin, lngMin);
    if (!feats) {
      ok = false;
      break;
    }
    for (const f of feats) {
      const [lng, lat] = f.geometry.coordinates;
      const pk = `${lat},${lng}`;
      const entry = points.get(pk) ?? { lat, lng };
      const monthly = f.properties.parameter[param];
      if (monthly) entry[param] = monthly;
      points.set(pk, entry);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  powerCache[b] = ok ? [...points.values()] : [];
  writeFileSync(blockPath(b), JSON.stringify(powerCache[b]));
  fetched++;
  process.stdout.write(`\r  POWER blocks fetched: ${fetched}/${missingBlocks.length}   `);
}
console.log("");

/** POWER uses -999 as its fill value; treat it as missing rather than as a temperature. */
const clean = (v) => (typeof v === "number" && v > -900 ? v : null);

/** Nearest POWER grid point within the cell's own block. */
function climateForCell(lat, lng) {
  const pts = powerCache[blockKey(lat, lng)];
  if (!pts || pts.length === 0) return null;
  let best = null;
  let bestD = Infinity;
  for (const p of pts) {
    const d = (p.lat - lat) ** 2 + (p.lng - lng) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (!best) return null;

  const t = best.T2M ?? {};
  const w = best.T2MWET ?? {};
  const monthlyT = MONTHS.map((m) => clean(t[m])).filter((v) => v != null);
  const monthlyW = MONTHS.map((m) => clean(w[m])).filter((v) => v != null);
  if (monthlyT.length < 12 || monthlyW.length < 12) return null;

  const meanTempC = clean(t.ANN) ?? monthlyT.reduce((a, b) => a + b, 0) / monthlyT.length;
  const meanWetBulbC = clean(w.ANN) ?? monthlyW.reduce((a, b) => a + b, 0) / monthlyW.length;
  const warmestMonthTempC = Math.max(...monthlyT);
  const coldestMonthTempC = Math.min(...monthlyT);

  return {
    meanTempC,
    warmestMonthTempC,
    coldestMonthTempC,
    tempRangeC: warmestMonthTempC - coldestMonthTempC,
    meanWetBulbC,
    // Governs whether evaporative/adiabatic cooling can carry the load in the
    // worst month -- the condition a plant must actually be sized for.
    warmestMonthWetBulbC: Math.max(...monthlyW),
    // Months whose MEAN temperature sits below 18C. A monthly-resolution
    // proxy for economiser-favourable conditions, NOT an hour count.
    coolMonthFraction: monthlyT.filter((v) => v < 18).length / monthlyT.length,
  };
}

// --- 8. Finalise -----------------------------------------------------------
const complete = [];
let dropped = 0;
for (const row of rows) {
  const c = climateForCell(row.lat, row.lng);
  if (!c || row.carbonIntensityGco2PerKwh == null || row.waterStressScore == null) {
    dropped++;
    continue;
  }
  complete.push({ ...row, ...c });
}
console.log(`  usable rows: ${complete.length} (dropped ${dropped} for missing climate or country factors)`);
const posN = complete.filter((r) => r.label === 1).length;
console.log(`  class balance: ${posN} positive / ${complete.length - posN} negative`);

writeFileSync(
  join(CACHE, "siting-training-set.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      resolutionDeg: RESOLUTION_DEG,
      climateSource: "NASA POWER long-term monthly climatology (T2M, T2MWET), regional endpoint, 0.5 x 0.625 deg native grid",
      seed: SEED,
      note:
        "Revealed-preference training set. label=1 means at least one real PeeringDB facility falls in this 1-degree cell. " +
        "Facility presence is strongly confounded by population and economic activity; nearestCity* features exist to let the " +
        "model separate urbanisation from siting characteristics. Climate is MONTHLY climatology, so cool-month fraction is a " +
        "proxy for economiser-favourable conditions and not an hour count.",
      rows: complete,
    },
    null,
    0
  )
);
console.log(`Wrote scripts/.cache/siting-training-set.json (${complete.length} rows)`);
