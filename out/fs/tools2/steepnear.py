#!/usr/bin/env python3
"""steepnear.py LINES.json F.f32 [...]: a landform box's land steeper than 40 degrees (steep.py's slope) by distance from
the rivers (kind 0) of LINES (their points every ~100 m, rasterised on the box's grid), km2: 0-300, 300-700 (a river
core's taper, half + 180 to + 430 m), 700-1500 m and beyond."""
import json, sys, numpy as np
from scipy.ndimage import distance_transform_edt
L = json.load(open(sys.argv[1]))
pts = [(q[0], q[1]) for l in L if (l.get('kind') or 0) == 0 for q in l['pts']]
B = ((0, 300), (300, 700), (700, 1500), (1500, 1e9))
dist = None
for f in sys.argv[2:]:
    h = json.load(open(f.replace('.f32', '.json'))); n = h['n']; r = h['res']
    if dist is None:
        m = np.ones((n, n), bool)
        for pn, pe in pts:
            y = int((h['north'] + h['half'] - pn) / r); x = int((pe - h['east'] + h['half']) / r)
            if 0 <= y < n and 0 <= x < n: m[y, x] = False
        dist = distance_transform_edt(m) * r
    z = np.fromfile(f, dtype=np.float32).reshape(n, n).astype(np.float64)
    gy, gx = np.gradient(z, r)
    d = np.degrees(np.arctan(np.hypot(gx, gy)))
    ok = np.isfinite(d)
    a = r * r / 1e6
    s = ' | '.join(f'{lo:.0f}-{hi:.0f} m {((d > 40) & ok & (dist >= lo) & (dist < hi)).sum() * a:6.1f}' for lo, hi in B)
    print(f'{f}: over 40 deg by distance from a river, km2: {s}')
