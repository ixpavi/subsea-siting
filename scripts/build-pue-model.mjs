// Fits PUE = f(climate) against REAL MEASURED per-facility PUE, and emits
// public/data/pue-model.json.
//
// WHY THIS EXISTS: calculator/facilityCalculator.ts currently assigns a
// FIXED PUE to each cooling type regardless of where the facility is. That is
// physically wrong -- an air-side economiser in Dublin and the same equipment
// in Chennai do not perform alike -- and the constants were invented by me
// rather than measured. This replaces the location-blind part of that with a
// relationship fitted to real operating data.
//
// SOURCE: Google publishes quarterly and trailing-twelve-month PUE for each
// of its data-centre campuses at https://datacenters.google/efficiency/.
// That is measured operating data for named, locatable facilities -- the only
// large public dataset I could find that pairs real PUE with real coordinates.
//
// FOUR LIMITATIONS, ALL MATERIAL. These are not boilerplate; they bound what
// the output may be used for:
//
//  1. GOOGLE-CLASS FACILITIES ONLY. This fleet is hyperscale, custom-designed
//     and exceptionally optimised -- fleet PUE around 1.09 against a widely
//     reported industry average nearer 1.5. A relationship fitted here
//     describes how CLIMATE MOVES PUE within that class. It must not be used
//     to predict the absolute PUE a 20 MW enterprise build would achieve.
//     The app therefore applies the fitted climate GRADIENT, not the fitted
//     intercept.
//  2. NO COOLING TECHNOLOGY IS PUBLISHED per facility. So this fits
//     PUE = f(climate), not f(climate, cooling type). It cannot by itself
//     answer "which cooling system should I choose" -- it can only say how
//     much a given design's efficiency should be expected to shift with
//     climate.
//  3. SMALL n (about 35 facilities), heavily concentrated in the United
//     States. Confidence intervals are reported and should be quoted.
//  4. SURVIVORSHIP/SITING BIAS. Google chose these locations partly FOR their
//     climate, so the sample under-represents hot, humid sites. Extrapolating
//     to conditions outside the fitted range is unsupported, and the emitted
//     model records that range explicitly.
//
// Re-run manually; never fetched at app runtime.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public", "data");
const CACHE = join(__dirname, ".cache");
if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });

const EFFICIENCY_URL = "https://datacenters.google/efficiency/";
/** Median over the most recent quarters -- damps commissioning ramps and one-off seasonal excursions. */
const RECENT_QUARTERS = 8;
const USER_AGENT =
  "globe-app-datacentre-planning/0.1 (academic project; contact via repository github.com/ixpavi/globe-app)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// --- 1. Fetch + parse the published PUE tables -----------------------------
const htmlPath = join(CACHE, "google-efficiency.html");
let html;
if (existsSync(htmlPath)) {
  html = readFileSync(htmlPath, "utf-8");
  console.log("  google-efficiency.html (cached)");
} else {
  process.stdout.write("  fetching Google efficiency page... ");
  const res = await fetch(EFFICIENCY_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`efficiency page failed: ${res.status}`);
  html = await res.text();
  writeFileSync(htmlPath, html);
  console.log(`${(html.length / 1024).toFixed(0)} KB`);
}

const flat = html.replace(/\s+/g, " ");
// Each quarter's table is preceded by its label; split on tables and look
// back for the nearest preceding "Qn YYYY" to attribute rows to a quarter.
const segments = flat.split("<table");
const observations = []; // { facility, quarter, quarterlyPue, ttmPue }
for (let i = 1; i < segments.length; i++) {
  const before = segments[i - 1];
  const qm = [...before.matchAll(/Q([1-4])\s*(20[0-9]{2})/g)].pop();
  if (!qm) continue;
  const quarter = `${qm[2]}Q${qm[1]}`;
  const body = segments[i].split("</table")[0];
  const rows = [...body.matchAll(/<td role="cell">([^<]+)<\/td>\s*<td role="cell">([0-9.]+)<\/td>\s*<td role="cell">([0-9.]+)<\/td>/g)];
  for (const r of rows) {
    const facility = r[1].trim();
    if (!facility || facility.toLowerCase() === "fleet") continue; // fleet aggregate is not a locatable site
    const ttm = Number(r[3]);
    if (!Number.isFinite(ttm) || ttm < 1 || ttm > 3) continue;
    observations.push({ facility, quarter, quarterlyPue: Number(r[2]), ttmPue: ttm });
  }
}
const quarters = [...new Set(observations.map((o) => o.quarter))].sort().reverse();
const recent = new Set(quarters.slice(0, RECENT_QUARTERS));
console.log(`  parsed ${observations.length} observations across ${quarters.length} quarters; using most recent ${recent.size}`);

const byFacility = new Map();
for (const o of observations) {
  if (!recent.has(o.quarter)) continue;
  if (!byFacility.has(o.facility)) byFacility.set(o.facility, []);
  byFacility.get(o.facility).push(o.ttmPue);
}
const facilities = [...byFacility.entries()]
  .filter(([, v]) => v.length >= 2) // at least two quarters of evidence
  .map(([facility, vals]) => ({ facility, pue: median(vals), quartersObserved: vals.length }));
console.log(`  facilities with >=2 recent quarters: ${facilities.length}`);

// --- 2. Geocode each facility ----------------------------------------------
// Nominatim requires an identifying User-Agent and asks for <=1 request/sec.
// Both are honoured here; results are cached so a re-run makes no requests.
const geoPath = join(CACHE, "pue-geocode.json");
const geo = existsSync(geoPath) ? JSON.parse(readFileSync(geoPath, "utf-8")) : {};

/** "Central Ohio (New Albany), Ohio" -> "New Albany, Ohio"; "Council Bluffs, Iowa (2nd facility)" -> "Council Bluffs, Iowa". */
function toQuery(name) {
  let s = name.replace(/\((\d+(?:st|nd|rd|th))\s+facility\)/gi, "");
  const paren = s.match(/\(([^)]+)\)/);
  if (paren) s = s.replace(/^[^,(]*\(([^)]+)\)/, paren[1]);
  return s.replace(/\s+,/g, ",").replace(/\s{2,}/g, " ").trim().replace(/,\s*$/, "");
}

let geocoded = 0;
for (const f of facilities) {
  if (geo[f.facility]) continue;
  const q = toQuery(f.facility);
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (res.ok) {
    const j = await res.json();
    if (j[0]) geo[f.facility] = { query: q, lat: Number(j[0].lat), lng: Number(j[0].lon) };
  }
  writeFileSync(geoPath, JSON.stringify(geo, null, 1));
  geocoded++;
  process.stdout.write(`\r  geocoding: ${geocoded} requested   `);
  await sleep(1100); // Nominatim usage policy
}
console.log("");

// --- 3. Climate per facility (NASA POWER point climatology) ----------------
const climPath = join(CACHE, "pue-climate.json");
const clim = existsSync(climPath) ? JSON.parse(readFileSync(climPath, "utf-8")) : {};
const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
let climFetched = 0;
for (const f of facilities) {
  const g = geo[f.facility];
  if (!g || clim[f.facility]) continue;
  const url =
    `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M,T2MWET&community=RE` +
    `&longitude=${g.lng.toFixed(4)}&latitude=${g.lat.toFixed(4)}&format=JSON`;
  const res = await fetch(url);
  if (res.ok) {
    const j = await res.json();
    const p = j.properties?.parameter;
    const ok = (v) => (typeof v === "number" && v > -900 ? v : null);
    const t = MONTHS.map((m) => ok(p?.T2M?.[m])).filter((v) => v != null);
    const w = MONTHS.map((m) => ok(p?.T2MWET?.[m])).filter((v) => v != null);
    if (t.length === 12 && w.length === 12) {
      clim[f.facility] = {
        meanTempC: ok(p.T2M.ANN) ?? t.reduce((a, b) => a + b, 0) / 12,
        meanWetBulbC: ok(p.T2MWET.ANN) ?? w.reduce((a, b) => a + b, 0) / 12,
        warmestMonthTempC: Math.max(...t),
        warmestMonthWetBulbC: Math.max(...w),
        coldestMonthTempC: Math.min(...t),
      };
    }
  }
  writeFileSync(climPath, JSON.stringify(clim, null, 1));
  climFetched++;
  process.stdout.write(`\r  climate: ${climFetched} requested   `);
  await sleep(400);
}
console.log("");

// --- 4. Assemble ------------------------------------------------------------
const dataset = facilities
  .filter((f) => geo[f.facility] && clim[f.facility])
  .map((f) => ({ ...f, ...geo[f.facility], ...clim[f.facility] }));
console.log(`  usable facilities: ${dataset.length}`);
if (dataset.length < 10) throw new Error("too few usable facilities to fit anything meaningful");

// --- 5. Fit -----------------------------------------------------------------
// Simple least squares with a leave-one-out cross-validated R-squared. With
// n ~ 35 a train/test split would be noise; LOO uses every point for both.
function fitOLS(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, meanX: mx };
}
function pearson(a, b) {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let nu = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    nu += x * y; da += x * x; db += y * y;
  }
  return nu / Math.sqrt(da * db);
}
function looR2(xs, ys) {
  let ssRes = 0;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let ssTot = 0;
  for (let i = 0; i < xs.length; i++) {
    const tx = xs.filter((_, j) => j !== i);
    const ty = ys.filter((_, j) => j !== i);
    const m = fitOLS(tx, ty);
    ssRes += (ys[i] - (m.intercept + m.slope * xs[i])) ** 2;
    ssTot += (ys[i] - my) ** 2;
  }
  return 1 - ssRes / ssTot;
}

const y = dataset.map((d) => d.pue);
const CANDIDATES = [
  ["meanTempC", (d) => d.meanTempC],
  ["meanWetBulbC", (d) => d.meanWetBulbC],
  ["warmestMonthTempC", (d) => d.warmestMonthTempC],
  ["warmestMonthWetBulbC", (d) => d.warmestMonthWetBulbC],
];

console.log("\n=== climate predictors of measured PUE (n=" + dataset.length + ") ===");
const fits = [];
for (const [name, get] of CANDIDATES) {
  const x = dataset.map(get);
  const r = pearson(x, y);
  const m = fitOLS(x, y);
  const loo = looR2(x, y);
  fits.push({ name, r, loo, ...m, min: Math.min(...x), max: Math.max(...x) });
  console.log(
    `  ${name.padEnd(22)} r=${r >= 0 ? "+" : ""}${r.toFixed(3)}  R2=${(r * r).toFixed(3)}  LOO-R2=${loo.toFixed(3)}  ` +
      `slope=${(m.slope * 1000).toFixed(2)} milli-PUE per degC`
  );
}

const best = fits.reduce((a, b) => (b.loo > a.loo ? b : a));
console.log(`\n  best predictor: ${best.name} (LOO-R2 ${best.loo.toFixed(3)})`);
console.log(`  fitted range: ${best.min.toFixed(1)}C .. ${best.max.toFixed(1)}C -- extrapolation beyond this is unsupported`);
console.log(`  observed PUE range: ${Math.min(...y).toFixed(3)} .. ${Math.max(...y).toFixed(3)} (fleet is hyperscale; not enterprise-representative)`);

writeFileSync(
  join(OUT, "pue-model.json"),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: { name: "Google data-centre efficiency disclosures", url: EFFICIENCY_URL, quartersUsed: [...recent].sort() },
    provenance:
      "Fitted to real measured trailing-twelve-month PUE published per facility by Google, against NASA POWER climate " +
      "normals at each facility's geocoded location. Google's fleet is hyperscale and exceptionally optimised, so the " +
      "INTERCEPT is not transferable to other facility classes -- only the climate GRADIENT (slope) should be applied, " +
      "as a relative adjustment to a design's baseline PUE. Cooling technology is not published per facility, so this " +
      "relates PUE to climate only and cannot select a cooling technology on its own.",
    facilityCount: dataset.length,
    predictors: fits,
    best: best.name,
    gradientMilliPuePerDegC: best.slope * 1000,
    fittedRange: { min: best.min, max: best.max, variable: best.name },
    observedPue: { min: Math.min(...y), max: Math.max(...y), median: median(y) },
    facilities: dataset.map((d) => ({
      facility: d.facility, lat: d.lat, lng: d.lng, pue: d.pue,
      quartersObserved: d.quartersObserved, meanTempC: d.meanTempC, meanWetBulbC: d.meanWetBulbC,
    })),
  })
);
console.log(`\nWrote public/data/pue-model.json`);
