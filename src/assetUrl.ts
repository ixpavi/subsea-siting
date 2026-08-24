// Resolves a bundled asset path against wherever the app is actually served
// from.
//
// WHY THIS EXISTS. Every dataset and texture used to be fetched by absolute
// path -- "/data/cables.json". That works when the site is served from a domain
// root and breaks completely anywhere else: on a GitHub Pages project site the
// app lives at /globe-app/, so "/data/cables.json" resolves to the domain root
// and every fetch 404s. The globe renders black and nothing explains why.
//
// Vite substitutes BASE_URL at build time from the `base` config, defaulting to
// "/". So this is identical to the old behaviour when served from a root, and
// correct when served from a subpath -- which makes the deployment target a
// config choice rather than a code change.
const BASE = import.meta.env.BASE_URL ?? "/";

/** @param path asset path relative to the public directory, e.g. "data/cables.json" */
export function assetUrl(path: string): string {
  const clean = path.replace(/^\/+/, "");
  return BASE.endsWith("/") ? `${BASE}${clean}` : `${BASE}/${clean}`;
}
