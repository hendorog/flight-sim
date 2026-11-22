#!/usr/bin/env python3
# routemap.py DIR OUT.png [seed]: the box probe's one-routing channels (catchment >= 1 km2, darker = bigger) with the drawn
# lines on them (red: rivers >= 45 km2, orange: streams), north up.
import json, sys, math
from PIL import Image, ImageDraw
D, out = sys.argv[1], sys.argv[2]
seed = sys.argv[3] if len(sys.argv) > 3 else '42'
m = json.load(open(f'{D}/route-s{seed}.json')); N = m['N']; step = m['step']; n0 = m['n0']; e0 = m['e0']
raw = open(f'{D}/route-s{seed}.u8', 'rb').read()
cellA = (step * step) / 1e6
im = Image.new('RGB', (N, N), (245, 245, 240))
px = im.load()
for k, v in enumerate(raw):
    A = cellA * 10 ** (v / 40)
    if A < 1: continue
    y = k // N; x = k % N
    t = min(1, math.log10(A) / 3)
    px[x, N - 1 - y] = (int(150 - 130 * t), int(190 - 140 * t), int(240 - 60 * t))
dr = ImageDraw.Draw(im)
for pn, pe, a in m['lines']:
    x = (pe - e0) / step; y = N - 1 - (pn - n0) / step
    c = (220, 30, 30) if a >= 45 else (255, 140, 0)
    dr.point((x, y), fill=c)
im = im.resize((N * 2, N * 2), Image.NEAREST)
im.save(out)
