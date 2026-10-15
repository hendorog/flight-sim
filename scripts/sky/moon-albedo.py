#!/usr/bin/env python3
# Night-sky P1: statistics of the NASA SVS CGI Moon Kit colour map (lroc_color_2k.jpg) for the Moon shader's
# albedo normalisation (src/render/sky/glsl/moon.ts MOON_MAP_NEAR_SIDE_MEAN).
#
#   python3 -I scripts/sky/moon-albedo.py public/sky/moon/lroc_color_2k.jpg
#
# Decodes sRGB to linear, takes Rec.709 luminance and averages it over the near side WEIGHTED as the disc is seen
# from Earth at full Moon: each surface element counts by its projected area (cos of the angle from the sub-Earth
# point (0,0)) times its area on the sphere (cos latitude per equirect pixel). The shader divides the map's linear
# luminance by this mean, so the disc-integrated full-Moon flux matches MOON_FULL_ILLUMINANCE_TOA. Also prints the
# plain (area-weighted) near-side mean, the maria/highland contrast and the mean colour (relative to luminance).
import sys

import numpy as np
from PIL import Image

img = np.asarray(Image.open(sys.argv[1]).convert('RGB'), dtype=np.float64) / 255.0
lin = np.where(img <= 0.04045, img / 12.92, ((img + 0.055) / 1.055) ** 2.4)
lum = lin @ np.array([0.2126, 0.7152, 0.0722])
h, w = lum.shape
lat = (0.5 - (np.arange(h) + 0.5) / h) * np.pi  # top row = +90 deg (north)
lon = ((np.arange(w) + 0.5) / w - 0.5) * 2 * np.pi  # centre column = 0 deg
LON, LAT = np.meshgrid(lon, lat)
mu = np.cos(LAT) * np.cos(LON)  # cosine from the sub-Earth point
near = mu > 0
area = np.cos(LAT)
wdisc = np.where(near, mu * area, 0.0)
mean_disc = (lum * wdisc).sum() / wdisc.sum()
mean_area = (lum * area * near).sum() / (area * near).sum()
p5, p50, p95 = np.percentile(lum[near & (np.abs(LAT) < 1.2)], [5, 50, 95])
rgb = (lin * wdisc[..., None]).sum((0, 1)) / wdisc.sum()
print(f'size {w}x{h}')
print(f'near-side mean linear luminance, disc-weighted (mu * cos lat): {mean_disc:.5f}')
print(f'near-side mean linear luminance, area-weighted: {mean_area:.5f}')
print(f'near-side luminance p5 / p50 / p95: {p5:.4f} / {p50:.4f} / {p95:.4f}')
print(f'mean colour / luminance: {rgb[0]/mean_disc:.4f} {rgb[1]/mean_disc:.4f} {rgb[2]/mean_disc:.4f}')
