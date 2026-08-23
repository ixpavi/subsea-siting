// Debug helper: prints the structure of a GeoTIFF (size, bbox, resolution,
// sample format, value range). Used while establishing what the EMODnet WCS
// actually returns -- native resolution, elevation convention, nodata handling
// -- before the tile downloader was written against those assumptions.
// Usage: node scripts/research/inspect-geotiff.mjs <file.tif>
import { fromFile } from "geotiff";
const img = await (await fromFile(process.argv[2])).getImage();
console.log("size      ", img.getWidth(), "x", img.getHeight());
console.log("bbox      ", img.getBoundingBox().map(v=>v.toFixed(4)).join(", "));
console.log("resolution", img.getResolution().map(v=>v.toFixed(6)).join(", "), "deg");
console.log("samples   ", img.getSamplesPerPixel(), "format", img.getSampleFormat(), "bits", img.getBitsPerSample());
const d = (await img.readRasters())[0];
let mn=Infinity,mx=-Infinity,nan=0;
for (const v of d) { if (!Number.isFinite(v)) { nan++; continue; } if(v<mn)mn=v; if(v>mx)mx=v; }
console.log("values    ", "min", mn.toFixed(1), "max", mx.toFixed(1), "non-finite", nan, "/", d.length);
console.log("nodata    ", img.getGDALNoData());
