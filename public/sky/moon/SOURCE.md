# Moon colour map

| | |
| --- | --- |
| File | `lroc_color_2k.jpg` (2048 x 1024 sRGB JPEG, equirectangular, centred on 0 deg longitude, north up; 457,942 bytes) |
| Source page | NASA SVS "CGI Moon Kit", ID 4720: https://svs.gsfc.nasa.gov/4720 |
| Download URL | https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg |
| Downloaded | 2026-10-15 |
| Licence | Public domain. NASA SVS help page (https://svs.gsfc.nasa.gov/help/, "Can I use your visualizations?"), read 2026-10-15: "All of our content is in the public domain (unless otherwise noted), meaning that it is free to download, use, and redistribute for whatever purposes you see fit." The 4720 page notes no exception for this file (its only stated caveat concerns licensed music in some videos, not applicable). |
| Credit | NASA's Scientific Visualization Studio (as the page asks: "Please give credit for this item to: NASA's Scientific Visualization Studio"). Visualizer Ernie Wright (USRA); scientist Noah Petro (NASA/GSFC). Data: Lunar Reconnaissance Orbiter LROC WAC colour mosaic (Hapke normalised) and LOLA. |
| Derivation | None: shipped byte-for-byte as downloaded (re-encoding at JPEG q80 would save only 25 %). |
| Statistics | `python3 -I scripts/sky/moon-albedo.py public/sky/moon/lroc_color_2k.jpg` (Python 3, Pillow 12.3.0, NumPy): near-side mean linear luminance, disc-weighted 0.39681 (used as MOON_MAP_NEAR_SIDE_MEAN in src/render/sky/glsl/moon.ts), area-weighted 0.43109; p5 / p50 / p95 0.2084 / 0.4481 / 0.6780 (MOON_PEAK_ALBEDO 1.7 = p95 / mean in src/render/sky/moon.ts). |
| SHA-256 (download) | `f7130a1822681fa7512d7dcfd40db8c10b9ba4f06777910348698260ed7a2170` |
| SHA-256 (shipped) | `f7130a1822681fa7512d7dcfd40db8c10b9ba4f06777910348698260ed7a2170` |

Used by `src/render/sky/moon.ts` (loaded at runtime from `${BASE_URL}sky/moon/lroc_color_2k.jpg`; the sky falls back
to procedural maria until it has loaded or if it fails).
