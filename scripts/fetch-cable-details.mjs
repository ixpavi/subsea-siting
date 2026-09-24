// Downloads each cable system's detail record -- owners, suppliers, ready-for-
// service year, stated length -- into scripts/raw/cable-details.json.
//
// WHY A SECOND DOWNLOAD. cable-geo.json (see scripts/README.md) carries only
// id, name, colour and geometry. The owners and the companies that built each
// system are published per cable, one record per id, at the same TeleGeography
// API. build-data.mjs then trims these records into public/data/cable-details.json.
//
// Run once, then re-run build-data.mjs:
//   node scripts/fetch-cable-details.mjs
//
// Data: TeleGeography Submarine Cable Map, licensed CC BY-NC-SA 3.0.
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW = join(__dirname, "raw");
const API = "https://www.submarinecablemap.com/api/v3/cable";
const CONCURRENCY = 6;

const geo = JSON.parse(readFileSync(join(RAW, "cable-geo.json"), "utf-8"));
const ids = [...new Set(geo.features.map((f) => f.properties.id))].sort();
console.log(`${ids.length} cable systems to fetch`);

async function fetchOne(id) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${API}/${encodeURIComponent(id)}.json`);
      if (res.status === 404) return { id, missing: true };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      // A few ids in the map's geometry have no detail record, and the site
      // answers those with its HTML page rather than a 404.
      if (text.trimStart().startsWith("<")) return { id, missing: true };
      return JSON.parse(text);
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw new Error(`${id}: ${lastError}`);
}

const records = [];
let next = 0;
async function worker() {
  while (next < ids.length) {
    const id = ids[next++];
    records.push(await fetchOne(id));
    if (records.length % 100 === 0) console.log(`  ${records.length}/${ids.length}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

records.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(
  join(RAW, "cable-details.json"),
  JSON.stringify({ fetchedAt: new Date().toISOString(), source: `${API}/{id}.json`, records })
);
const missing = records.filter((r) => r.missing).length;
console.log(`cable-details.json: ${records.length} records (${missing} not found)`);
