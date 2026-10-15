# public/sky/stars: provenance

Two third-party data files, both read by `src/render/sky/StarField.ts`. Licence pages were read on 2026-10-15.
Downloads are kept outside the repository; only the derived files below are shipped.

## bsc5.bin: Yale Bright Star Catalogue, 5th revised edition

| | |
| --- | --- |
| Shipped file | `bsc5.bin`, 109,336 bytes, SHA-256 `0d6734df237185294b9f561bf5daada925319d9673c7d085591c280ff61f998c` |
| Catalogue | The Bright Star Catalogue, 5th Revised Ed. (Preliminary Version), Hoffleit D., Warren Jr W.H., Astronomical Data Center, NSSDC/ADC (1991); 1964BS....C......0H, 1991bsc..book.....H. CDS catalogue V/50 |
| Source page | https://cdsarc.cds.unistra.fr/viz-bin/cat/V/50 (VizieR / CDS, Strasbourg) |
| Downloaded | https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz (573,921 bytes, SHA-256 `3dc44b1e90be8fbe5bcc7656032560f51275f985c7e3f783c9028e1838ec7bed`) and https://cdsarc.cds.unistra.fr/ftp/V/50/ReadMe (11,571 bytes, SHA-256 `44fd9c73e2eecad0beb47bdfa3f01c60fd43f93d6964198e31fcd48732de5b33`) |
| Licence | The catalogue's ReadMe carries **no copyright or licence line**. VizieR's licence page (https://cds.unistra.fr/vizier-org/licences_vizier.html), section "Data coming from another producer": "Please refer to the ReadMe file associated to the catalogue to verify if a "copyright" exists. Else, see the policy section of the journals." The catalogue was not published in a journal: it was issued by NASA's Astronomical Data Center (NSSDC/ADC, NASA Goddard Space Flight Center) for the ADC CD-ROM. CDS's catalogue page shows no licence either: its metadata (https://cdsarc.cds.unistra.fr/viz-bin/browse?out=json&search=V/50) has no `license` field. The Harvard copy's page (http://tdc-www.harvard.edu/catalogs/bsc5.html) states no licence or restriction. No restriction is stated anywhere we looked. It is factual astronomical data distributed by NASA. |
| Credit | Hoffleit, D. & Warren, W. H. Jr. 1991, The Bright Star Catalogue, 5th Revised Ed. (Preliminary Version), NASA Astronomical Data Center (NSSDC/ADC). Distributed by CDS/VizieR (catalogue V/50); "This research has made use of the VizieR catalogue access tool, CDS, Strasbourg, France." |
| Derivation | `python3 -I scripts/sky/stars-build.py <catalog.gz> public/sky/stars/bsc5.bin` (Python 3.14.7, standard library only). Takes the J2000 RA/Dec, Vmag and B-V columns (byte positions from the ReadMe) of all 9110 HR numbers; the 14 without data are kept as empty records so record n is HR n. Proper motion is not applied (J2000 positions; < 0.05 deg by 2016). Format in the script's header and in `src/render/sky/starCatalog.ts`. |

## milkyway_4k.webp: NASA SVS Deep Star Maps 2020, Milky Way background

| | |
| --- | --- |
| Shipped file | `milkyway_4k.webp`, 4096x2048, 401,794 bytes, SHA-256 `471badfb74fb6d56b3603608527d8fa52112698490fe63a8da228dff86742a3f` |
| Source page | https://svs.gsfc.nasa.gov/4851 ("Deep Star Maps 2020", released 9 September 2020, visualizations by Ernie Wright): "The Milky Way background in celestial coordinates. This is a version of the star map that omits the bright (Hipparcos and Tycho) stars." Plate carree, ICRF/J2000 RA/Dec; "The map is centered at 0h right ascension, and r.a. increases to the left." |
| Downloaded | https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/milkyway_2020_4k.exr (4096x2048 half-float OpenEXR, linear, 36,436,668 bytes, SHA-256 `2eb802d6e68d170b410f766c7fec07f7518619f6b6708fdc81e9302d93e74fdb`) |
| Licence | SVS help page (https://svs.gsfc.nasa.gov/help/), "Can I use your visualizations?": "All of our content is in the public domain (unless otherwise noted), meaning that it is free to download, use, and redistribute for whatever purposes you see fit." Page 4851 notes nothing otherwise (its only notes concern the coordinate update of the galactic-coordinate images). |
| Credit | As the page asks: "NASA/Goddard Space Flight Center Scientific Visualization Studio. Gaia DR2: ESA/Gaia/DPAC." (Built from Hipparcos-2, Tycho-2 and Gaia DR2, with the Yale Bright Star Catalog, UCAC3 and XHIP.) |
| Derivation | `scripts/sky/milkyway-build.sh <milkyway_2020_4k.exr> 85 1.0` (ImageMagick 7.1.2-31 Q16-HDRI dumps the EXR as linear float32 RGB; `python3 -I scripts/sky/milkyway-encode.py` with Python 3.14.7, numpy 2.4.6, Pillow 12.3.0 encodes it). Pre-filter: a Gaussian of 1 texel on the sky in linear light (rows by 1 texel, each row by 1 / cos(Dec) texels, capped at W / 8), so the map's star-count noise does not read as grain under the night look's gain and the poles show no radial streaks. Encoding: v = sRGB_OETF(clamp(rgb / L_REF, 0, 1)) per channel, L_REF = 0.694355 (the map's 99.99th luminance percentile), WebP quality 85, method 6. The shader decodes it as an sRGB texture and multiplies by L_REF; the constants the script printed (L_REF, the 2 deg-smoothed peak 0.47445 at RA 271.93 Dec -29.00, the mean, the band pole) are recorded in `src/render/sky/glsl/milkyWay.ts`. |
