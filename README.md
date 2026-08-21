# Subsea Cable & Data Centre Planning Globe

An interactive 3D globe for data centre and submarine cable connectivity planning, built with React, TypeScript, and [react-globe.gl](https://github.com/vasturiano/react-globe.gl).

## Features

- **Submarine cable routes** — real TeleGeography-backed cable and landing-point data.
- **Land-based facilities** — sourced from [PeeringDB](https://www.peeringdb.com).
- **Subsea data centre sites** — a curated, source-cited dataset of real underwater/subsea deployments (Microsoft Project Natick, Highlander/HiCloud's Hainan and Shanghai Lingang sites, Subsea Cloud's announced Port Angeles project), each flagged with a coordinate-precision rating since none have a published exact GPS fix.
- **Nearest-landing connectors** — each subsea site is linked to its nearest cable landing point.
- **Independent layer toggles**, hover tooltips, and click-through detail panels for every marker.
- **Facility sizing calculator** — pick Tier (I–IV), redundancy (N/N+1/2N), and cooling type to see estimated availability, downtime cost, and PUE/CUE/WUE for a hypothetical deployment at any site.
- **Rule-based configuration recommender** — a closed-form multi-criteria scoring engine (no external API) that ranks the Pareto-efficient Tier × redundancy × cooling combinations against user-weighted priorities (cost, availability, sustainability, deployment speed).
- **Subsea route risk** — an illustrative environmental risk heuristic (depth, latitude band, route length) for a subsea site's connector route, clearly labeled as a model rather than sourced GIS data.

## Getting started

```bash
npm install
npm run dev
```

## Data pipeline

Raw sourced data lives in `scripts/raw/` and is transformed into app-ready JSON via `scripts/build-data.mjs`. See [scripts/README.md](scripts/README.md) for details on re-fetching and rebuilding the datasets.

## Stack

Vite, React, TypeScript, react-globe.gl / three.js.
