// Transforms raw sourced data (scripts/raw/*, scripts/subsea-dcs.json) into
// trimmed, app-ready JSON in public/data/. Re-run manually after re-scraping;
// never fetched at app runtime.
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW = join(__dirname, "raw");
const OUT = join(__dirname, "..", "public", "data");

const readJSON = (p) => JSON.parse(readFileSync(p, "utf-8"));

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// --- Submarine cables -> simplified path list ---
const cableGeo = readJSON(join(RAW, "cable-geo.json"));
const cables = cableGeo.features.map((f) => ({
  id: f.properties.id,
  name: f.properties.name,
  color: f.properties.color || "#4fd1ff",
  // MultiLineString -> array of paths, each an array of [lat, lng]
  paths: f.geometry.coordinates.map((line) =>
    line.map(([lng, lat]) => [lat, lng])
  ),
}));
writeFileSync(join(OUT, "cables.json"), JSON.stringify(cables));
console.log(`cables.json: ${cables.length} cables`);

// --- Cable landing points ---
const landingGeo = readJSON(join(RAW, "landing-point-geo.json"));
const landingPoints = landingGeo.features
  .filter((f) => !f.properties.is_tbd)
  .map((f) => ({
    id: f.properties.id,
    name: f.properties.name,
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
  }));
writeFileSync(join(OUT, "landing-points.json"), JSON.stringify(landingPoints));
console.log(`landing-points.json: ${landingPoints.length} landing points`);

// --- PeeringDB land-based facilities ---
const facRaw = readJSON(join(RAW, "peeringdb-fac-all.json"));
const landDCs = facRaw.data
  .filter((f) => f.status === "ok" && f.latitude != null && f.longitude != null)
  .map((f) => ({
    id: f.id,
    name: f.name,
    org: f.org_name,
    city: f.city,
    country: f.country,
    lat: f.latitude,
    lng: f.longitude,
    netCount: f.net_count,
  }));
writeFileSync(join(OUT, "land-dcs.json"), JSON.stringify(landDCs));
console.log(`land-dcs.json: ${landDCs.length} facilities`);

// --- Subsea data centres (curated, hand-verified) + nearest landing point ---
const subseaDCs = readJSON(join(__dirname, "subsea-dcs.json"));
const subseaWithConnector = subseaDCs.map((dc) => {
  let nearest = null;
  let nearestDist = Infinity;
  for (const lp of landingPoints) {
    const d = haversineKm(dc.lat, dc.lng, lp.lat, lp.lng);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = lp;
    }
  }
  return {
    ...dc,
    nearestLandingPoint: nearest
      ? { id: nearest.id, name: nearest.name, lat: nearest.lat, lng: nearest.lng }
      : null,
    nearestLandingPointDistanceKm: nearest ? Math.round(nearestDist) : null,
  };
});
writeFileSync(join(OUT, "subsea-dcs.json"), JSON.stringify(subseaWithConnector, null, 2));
console.log(`subsea-dcs.json: ${subseaWithConnector.length} subsea sites`);
subseaWithConnector.forEach((dc) =>
  console.log(
    `  ${dc.name} -> nearest landing point: ${dc.nearestLandingPoint?.name} (${dc.nearestLandingPointDistanceKm} km)`
  )
);
