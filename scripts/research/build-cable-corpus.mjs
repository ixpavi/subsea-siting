// Builds a corpus of AS-LAID submarine telecommunication cable routes from
// EMODnet Human Activities, and characterises its fidelity.
//
// WHY A SECOND CABLE DATASET. The app ships TeleGeography-derived geometry,
// which is a CARTOGRAPHIC SCHEMATIC: measured at 7.3 vertices per 1,000 km,
// median segment 69 km, longest single segment 5,650 km. A 5,650 km straight
// line is not a cable route -- it is a line drawn to show that two places are
// connected. That geometry is perfectly adequate for the app (showing which
// systems exist and where they land) but it cannot support any claim about
// WHERE A CABLE ACTUALLY GOES, because it never recorded that.
//
// EMODnet republishes national hydrographic-office cable positions -- the
// data fishermen and marine planners rely on to avoid the things. Spot
// measured before writing this: BSH (Germany) at 3,369 vertices per 1,000 km
// with a 10-metre median segment. That is as-laid survey position.
//
// This script exists to answer one question before any modelling starts:
// after excluding power cables and unusable geometry, HOW MANY REAL ROUTES
// ARE THERE, and are they long enough to have made routing decisions worth
// recovering? A corpus of 800 features that turns out to be mostly 2 km
// shore-end stubs would not support the study.
//
// Telecommunication layers only. The portal publishes power cables
// separately (emodnet:pcables*) and those are a different engineering
// problem -- different burial rules, different route economics.
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, ".cache");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const WFS = "https://ows.emodnet-humanactivities.eu/wfs";
const PAGE = 500;

/** Telecommunication cable layers, confirmed from the WFS capabilities titles. */
const LAYERS = [
  { name: "bshcontiscables", source: "DE BSH-CONTIS" },
  { name: "cicacables", source: "ES CICA" },
  { name: "shomcables", source: "FR SHOM" },
  { name: "sigcables", source: "FR SIGCables" },
  { name: "maltacables", source: "MT IOI-MOC" },
  { name: "rijkscables", source: "NL Rijkswaterstaat" },
  { name: "ukfibrecables", source: "UK OGA" },
];

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** GeoJSON LineString / MultiLineString -> array of [lng,lat] rings. */
function linesOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

async function fetchLayer(layer) {
  const cachePath = join(OUT, `${layer.name}.json`);
  if (existsSync(cachePath)) {
    console.log(`  ${layer.name} (cached)`);
    return JSON.parse(readFileSync(cachePath, "utf-8"));
  }
  const features = [];
  for (let start = 0; ; start += PAGE) {
    const url =
      `${WFS}?service=WFS&version=2.0.0&request=GetFeature&typeName=emodnet:${layer.name}` +
      `&outputFormat=application/json&count=${PAGE}&startIndex=${start}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${layer.name} page ${start}: HTTP ${res.status}`);
    const page = await res.json();
    const got = page.features ?? [];
    features.push(...got);
    process.stdout.write(`\r  ${layer.name}: ${features.length} features   `);
    if (got.length < PAGE) break;
  }
  console.log("");
  const fc = { type: "FeatureCollection", features };
  writeFileSync(cachePath, JSON.stringify(fc));
  return fc;
}

console.log("Fetching EMODnet as-laid telecommunication cable routes...");

const perLayer = [];
const routes = [];

for (const layer of LAYERS) {
  const fc = await fetchLayer(layer);
  let vertices = 0;
  let lengthKm = 0;
  const segments = [];

  for (const feature of fc.features) {
    for (const line of linesOf(feature.geometry)) {
      if (line.length < 2) continue;
      let routeLen = 0;
      for (let i = 0; i < line.length - 1; i++) {
        const d = haversineKm(line[i][1], line[i][0], line[i + 1][1], line[i + 1][0]);
        routeLen += d;
        segments.push(d);
      }
      vertices += line.length;
      lengthKm += routeLen;
      routes.push({
        source: layer.source,
        layer: layer.name,
        lengthKm: routeLen,
        vertices: line.length,
        verticesPer1000Km: routeLen > 0 ? line.length / (routeLen / 1000) : 0,
        coordinates: line,
        properties: feature.properties ?? {},
      });
    }
  }

  segments.sort((a, b) => a - b);
  const median = segments.length ? segments[Math.floor(segments.length / 2)] : NaN;
  perLayer.push({
    layer: layer.name,
    source: layer.source,
    features: fc.features.length,
    lines: routes.filter((r) => r.layer === layer.name).length,
    vertices,
    lengthKm,
    verticesPer1000Km: lengthKm > 0 ? vertices / (lengthKm / 1000) : 0,
    medianSegmentKm: median,
  });
}

console.log("\n=== FIDELITY BY SOURCE ===");
console.log(
  "  " +
    "source".padEnd(22) +
    "lines".padStart(7) +
    "vertices".padStart(10) +
    "length km".padStart(11) +
    "vtx/1000km".padStart(12) +
    "med seg km".padStart(12)
);
for (const l of perLayer) {
  console.log(
    "  " +
      l.source.padEnd(22) +
      String(l.lines).padStart(7) +
      String(l.vertices).padStart(10) +
      Math.round(l.lengthKm).toLocaleString().padStart(11) +
      l.verticesPer1000Km.toFixed(0).padStart(12) +
      l.medianSegmentKm.toFixed(3).padStart(12)
  );
}

// --- Usability screen -------------------------------------------------------
// A route only carries recoverable routing DECISIONS if it is long enough to
// have had alternatives, and sampled finely enough to show which was taken.
// Both thresholds are stated here rather than buried, and the counts at
// several cutoffs are printed so the sensitivity is visible.
console.log("\n=== USABLE SAMPLE (routes with recoverable routing decisions) ===");
for (const minKm of [5, 10, 25, 50, 100]) {
  const usable = routes.filter((r) => r.lengthKm >= minKm && r.verticesPer1000Km >= 50);
  const totalKm = usable.reduce((a, r) => a + r.lengthKm, 0);
  console.log(
    `  >= ${String(minKm).padStart(3)} km and >= 50 vtx/1000km : ` +
      `${String(usable.length).padStart(4)} routes, ${Math.round(totalKm).toLocaleString().padStart(7)} km total`
  );
}

const usable = routes.filter((r) => r.lengthKm >= 25 && r.verticesPer1000Km >= 50);
usable.sort((a, b) => b.lengthKm - a.lengthKm);
console.log("\n  longest usable routes:");
for (const r of usable.slice(0, 8)) {
  console.log(
    `    ${r.source.padEnd(22)} ${r.lengthKm.toFixed(0).padStart(6)} km  ` +
      `${String(r.vertices).padStart(5)} vtx  ${r.verticesPer1000Km.toFixed(0).padStart(5)} vtx/1000km`
  );
}

// --- Spatial extent, for matching against a bathymetry product --------------
let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
for (const r of usable) {
  for (const [lng, lat] of r.coordinates) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
}
console.log("\n=== SPATIAL EXTENT of usable routes ===");
console.log(`  lat ${minLat.toFixed(2)} .. ${maxLat.toFixed(2)}   lng ${minLng.toFixed(2)} .. ${maxLng.toFixed(2)}`);

writeFileSync(
  join(OUT, "cable-corpus.json"),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: "EMODnet Human Activities -- national hydrographic office telecommunication cable routes",
    wfs: WFS,
    layers: LAYERS,
    note:
      "As-laid route positions republished from national sources. Distinct from the TeleGeography-derived " +
      "schematic geometry the application ships, which is measured at 7.3 vertices per 1,000 km and cannot " +
      "support claims about actual route position.",
    perLayer,
    bbox: { minLat, maxLat, minLng, maxLng },
    usableCriteria: { minLengthKm: 25, minVerticesPer1000Km: 50 },
    usableCount: usable.length,
    routes: usable,
  })
);
console.log(`\nWrote scripts/research/.cache/cable-corpus.json (${usable.length} usable routes)`);
