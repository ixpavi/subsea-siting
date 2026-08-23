# Land polygon source

`ne_land.geojson` = Natural Earth v5.1.1, "Land" theme, 50m resolution
(`ne_50m_land`), public domain: https://www.naturalearthdata.com/downloads/50m-physical-vectors/50m-land/

Downloaded from the `nvkelso/natural-earth-vector` GitHub mirror, then
simplified further with `mapshaper -simplify 10% keep-shapes -clean` for
bundle size. Used by `scripts/build-ocean-grid.mjs` to mask land cells out
of the marine routing grid (a cell is "ocean" only if it falls outside every
land polygon).
