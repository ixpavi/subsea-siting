"""Builds the globe's Earth textures from NASA Blue Marble Next Generation.

WHY THIS EXISTS. The globe shipped with three-globe's example texture at
4096x2048 -- roughly 10 km per pixel at the equator, so it turns to mush as
soon as anyone zooms in on a landing point. NASA publishes the same imagery at
21600x10800, which is public domain and is the actual satellite composite
rather than an artist's rendering. That matters for a tool that is careful
about provenance everywhere else.

WHY 4096 AND NOT LARGER. An 8192x4096 version was tried and reverted. It
decodes to roughly 179 MB of GPU memory once mipmapped, four times the 45 MB
of 4096x2048, and on integrated graphics that showed up as lost frames during
camera animation -- the globe stuttered for a moment after every cable click.
The imagery still comes from the 21600x10800 NASA original rather than
three-globe's example texture, so it is a genuinely better source at the same
dimensions, and anisotropic filtering (see Globe.tsx) turned out to matter far
more for perceived sharpness than raw resolution anyway.

PROGRESSIVE LOADING. A 5-ish MB texture cannot block first paint, so a small
version is emitted alongside it. The app shows the small one immediately and
swaps in the large one when it arrives -- the globe is usable in under a
second and sharpens shortly after, rather than showing nothing for several.

Source: NASA Earth Observatory, Blue Marble Next Generation (public domain).
Run: python scripts/build-earth-texture.py
"""
import io
import os
import sys
import urllib.request

from PIL import Image

# PIL refuses very large images by default as a decompression-bomb guard. This
# one is a known NASA product at a known size, not untrusted input.
Image.MAX_IMAGE_PIXELS = None

SOURCE = (
    "https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/"
    "world.topo.bathy.200412.3x21600x10800.jpg"
)
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "textures")
FULL = (4096, 2048)
SMALL = (2048, 1024)
CACHE = os.path.join(os.path.dirname(__file__), ".cache-earth-source.jpg")

os.makedirs(OUT_DIR, exist_ok=True)

if not os.path.exists(CACHE):
    print(f"Downloading {SOURCE.rsplit('/', 1)[-1]} (~30 MB)...")
    req = urllib.request.Request(SOURCE, headers={"User-Agent": "globe-app-texture-build"})
    with urllib.request.urlopen(req, timeout=600) as r, open(CACHE, "wb") as f:
        total = 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            total += len(chunk)
            sys.stdout.write(f"\r  {total / 1e6:.1f} MB")
            sys.stdout.flush()
    print()
else:
    print("Using cached source image.")

img = Image.open(CACHE)
print(f"Source: {img.size[0]} x {img.size[1]}")

# draft() lets the JPEG decoder downscale during decode at DCT block level.
# Decoding 233 megapixels at full size would need ~700 MB of RAM for no gain,
# since we are about to shrink it anyway.
img.draft("RGB", FULL)
img = img.convert("RGB")
print(f"After draft decode: {img.size[0]} x {img.size[1]}")

for size, name, quality in ((FULL, "earth-4k.jpg", 88), (SMALL, "earth-2k.jpg", 82)):
    out = img.resize(size, Image.LANCZOS)
    path = os.path.join(OUT_DIR, name)
    # progressive=True so the browser paints a coarse version while the rest
    # streams, which matters most for the large file.
    out.save(path, "JPEG", quality=quality, optimize=True, progressive=True)
    print(f"  wrote {name}: {size[0]} x {size[1]}, {os.path.getsize(path) / 1e6:.2f} MB")

print("\nDone. Source: NASA Earth Observatory Blue Marble Next Generation (public domain).")
