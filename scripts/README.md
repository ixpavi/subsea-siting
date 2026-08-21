# Data pipeline

Raw sourced data lives in `scripts/raw/` and `scripts/subsea-dcs.json`. It is
fetched/curated once and committed — the app never fetches these sources at
runtime, only the trimmed output in `public/data/`.

## Re-fetching raw sources

```bash
curl -s "https://www.submarinecablemap.com/api/v3/cable/cable-geo.json" -o scripts/raw/cable-geo.json
curl -s "https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json" -o scripts/raw/landing-point-geo.json
curl -s "https://www.peeringdb.com/api/fac?limit=10000" -o scripts/raw/peeringdb-fac-all.json
```

These are the live TeleGeography-backed endpoints behind submarinecablemap.com
(the richiecarmichael/delusan GitHub mirrors mentioned in project docs ship
the same per-cable JSON split across hundreds of files — these consolidated
endpoints are the same underlying data, much cheaper to fetch/parse). The
PeeringDB endpoint is public but rate-limited for unauthenticated requests
(~1/hour for large pulls) — get an API key at peeringdb.com for regular runs.

## Subsea data centre dataset

`scripts/subsea-dcs.json` is a hand-curated, source-cited list — there is no
structured API for subsea DCs. It was compiled via Apify web research
(`apify/rag-web-browser`) against primary/news sources for each site. Every
entry carries `coordinate_precision` ("exact" | "approximate" | "unverified")
and a `coordinate_note` explaining how the position was derived, since none of
the three currently-known real deployments have a publicly disclosed GPS fix:

- **Project Natick (Microsoft, Orkney)** — positioned at the EMEC tidal test
  site off Eday; Microsoft never published exact coordinates. Confirmed
  discontinued (DCD, 2025) — no successor deployment.
- **Hainan / Lingshui (Highlander Digital Technology)** — positioned on the
  Lingshui, Hainan coastline per news coverage; no published seabed fix.
  Actively expanding (a further module added Feb 2025).
- **Shanghai Lingang (HiCloud)** — estimated from "~10km off the Lingang
  coast" reporting; no published GPS fix. Depth is reported inconsistently
  across sources (10m vs 35m) — see `coordinate_note` in the dataset.
- **Subsea Cloud "Jules Verne" (Port Angeles, WA)** — `coordinate_precision:
  "unverified"`: announced 2022, no independent confirmation the pod was ever
  physically deployed. Included as a named, sourced candidate rather than
  omitted, but flagged as unconfirmed.

To add a new site, research it, append an entry to `subsea-dcs.json` with
`sources` URLs, and re-run the build.

## Building app-ready data

```bash
node scripts/build-data.mjs
```

Writes `public/data/{cables,landing-points,land-dcs,subsea-dcs}.json`. The
subsea build step also computes each subsea DC's nearest cable landing point
(haversine distance) and embeds it as `nearestLandingPoint` /
`nearestLandingPointDistanceKm`, which the globe uses to draw the connector
arcs.
