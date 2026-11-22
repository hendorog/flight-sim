#!/usr/bin/env python3
"""whitepx.py IMG [x0 y0 x1 y1]: count near-white water pixels (min channel >= 200, max-min <= 30) in a crop of a
1600x900 shot. Default crop = the wind view's near reach of the owner's valley (500,330)-(1200,900)."""
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
if im.size != (1600, 900): im = im.resize((1600, 900))
box = tuple(map(int, sys.argv[2:6])) if len(sys.argv) >= 6 else (500, 330, 1200, 900)
c = im.crop(box)
n = sum(1 for r, g, b in c.getdata() if min(r, g, b) >= 200 and max(r, g, b) - min(r, g, b) <= 30)
print(f"{sys.argv[1]}: {n} white px in {box}")
