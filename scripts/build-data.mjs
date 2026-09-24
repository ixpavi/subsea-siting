// Transforms raw sourced data (scripts/raw/*, scripts/subsea-dcs.json) into
// trimmed, app-ready JSON in public/data/. Re-run manually after re-scraping;
// never fetched at app runtime.
import { existsSync, readFileSync, writeFileSync } from "fs";
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

// --- Cable owners and builders (per-cable detail records) ---
// Fetched separately by fetch-cable-details.mjs, because cable-geo.json
// carries geometry only. Optional: the app works without it and says so.
const detailsPath = join(RAW, "cable-details.json");
if (existsSync(detailsPath)) {
  const raw = readJSON(detailsPath);
  // Owners and suppliers arrive as one comma-separated string, and a few
  // names contain a comma of their own ("Unicom, Inc.", "Co., Ltd."). A part
  // that is only a company-form suffix is joined back onto the name before it.
  const SUFFIX = /^(inc|ltd|llc|co|corp|plc|s\.?a|ag|gmbh|lp|b\.?v|n\.?v|s\.?p\.?a|sas|limited)\.?$/i;
  const splitNames = (s) => {
    const out = [];
    for (const part of (s ?? "").split(",").map((p) => p.trim()).filter(Boolean)) {
      if (out.length && SUFFIX.test(part)) out[out.length - 1] += `, ${part}`;
      else out.push(part);
    }
    return out;
  };
  const cables = {};
  for (const r of raw.records) {
    if (r.missing) continue;
    const km = Number.parseFloat(String(r.length ?? "").replace(/,/g, ""));
    cables[r.id] = {
      owners: splitNames(r.owners),
      suppliers: splitNames(r.suppliers),
      rfsYear: Number.isFinite(r.rfs_year) ? r.rfs_year : null,
      planned: r.is_planned === true,
      lengthKm: Number.isFinite(km) ? km : null,
      url: r.url || null,
    };
  }
  writeFileSync(
    join(OUT, "cable-details.json"),
    JSON.stringify({
      fetchedAt: raw.fetchedAt,
      source: "TeleGeography Submarine Cable Map (submarinecablemap.com)",
      licence: "CC BY-NC-SA 3.0",
      cables,
    })
  );
  console.log(`cable-details.json: ${Object.keys(cables).length} cable systems`);
} else {
  console.log("cable-details.json: skipped (run fetch-cable-details.mjs first)");
}
