# Bathymetry contour source

Depth-band polygons from **Natural Earth v5.1.1**, "Bathymetry" theme, 10m
cultural/physical resolution (`ne_10m_bathymetry_{L_0..A_10000}`), which
Natural Earth documents as derived from the GEBCO/ETOPO bathymetric compilations
and simplified for cartographic use: https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-bathymetry/

Public domain (Natural Earth terms of use place all data in the public domain).

Downloaded from the `nvkelso/natural-earth-vector` GitHub mirror (GeoJSON
export of the same official shapefiles), then simplified further with
`mapshaper -simplify 8% keep-shapes -clean` to keep the bundled app size
reasonable. This is a client-side visual/computational simplification of a
public domain vector product — NOT the full-resolution GEBCO grid (15
arc-second) and NOT official Natural Earth 50m/110m tiers (which do not
ship a bathymetry layer). Each polygon represents the area at or below the
named depth contour (e.g. `K_200.geojson` = ocean 200m and deeper).

Used by `scripts/build-ocean-grid.mjs` to rasterize a coarse global
depth-band grid for hypothetical marine cable routing. See that script's
header comment for the resulting grid's resolution and depth semantics, and
`src/routing/oceanGrid.ts` for how the app labels this data's provenance to
the user.
