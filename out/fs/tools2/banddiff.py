#!/usr/bin/env python3
# banddiff.py PROJ WITH.png WITHOUT.png: the painted streams' band in a render, as the pixels changed against a
# rills-off render (luminance by more than 6 or colour by more than 18 summed) in the run through each projected course
# point (within 3 px of it) across the course's screen direction, out to 12 px either side; median per catchment band
# (li: 0 under 0.25 km2, 1 to 1, 2 to 3, 3 to 10) against the projected bed law.
import json, sys, math
from PIL import Image
pts = [json.loads(l[3:]) for l in open(sys.argv[1]) if l.startswith('PL ')]
A = Image.open(sys.argv[2]).convert('RGB'); B = Image.open(sys.argv[3]).convert('RGB'); W, H = A.size; pa = A.load(); pb = B.load()
lum = lambda c: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
by = {}
for p in pts: by.setdefault(p['li'], []).append(p)
names = {0: '<0.25 km2', 1: '0.25-1 km2', 2: '1-3 km2', 3: '3-10 km2'}
for li in sorted(by):
    P = by[li]; widths = []; beds = []
    for p in P:
        L = math.hypot(p['dx'], p['dy'])
        if L < 0.5: continue
        nx, ny = -p['dy'] / L, p['dx'] / L
        off = []
        ok = True
        for t in range(-12, 13):
            x, y = int(round(p['px'] + nx * t)), int(round(p['py'] + ny * t))
            if not (0 <= x < W and 0 <= y < H): ok = False; break
            a, b = pa[x, y], pb[x, y]
            off.append(abs(lum(a) - lum(b)) > 6 or sum(abs(a[i] - b[i]) for i in range(3)) > 18)
        if not ok: continue
        best = 0
        for c0 in range(9, 16):
            if not off[c0]: continue
            i0 = i1 = c0
            while i0 > 0 and off[i0 - 1]: i0 -= 1
            while i1 < 24 and off[i1 + 1]: i1 += 1
            best = max(best, i1 - i0 + 1)
        widths.append(best); beds.append(p['bed'])
    if not widths: continue
    widths.sort(); beds.sort()
    print(f"{names.get(li, li)}: {len(widths)} points; band p50 {widths[len(widths)//2]} px, mean {sum(widths)/len(widths):.1f} px; bed law p50 {beds[len(beds)//2]:.1f} px")
