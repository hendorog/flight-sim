#!/usr/bin/env python3
"""liftwhere.py BASE.f32 NEW.f32 BASE_LINES.json NEW_LINES.json [TAPER_DUMP.json]: lowlift.py's 2 km windows (500 m grid) where
the lowest ground rose by more than 50 m, by where they lie: within 1 km of a BASE river point more than 300 m from every
NEW river point (a course the rivers left: its carve gone), within 1 km of a NEW river (a valley the rivers run in now),
else elsewhere."""
import json, sys, math, numpy as np
from scipy.ndimage import minimum_filter, distance_transform_edt
bf, nf, bl, nl = sys.argv[1:5]
h = json.load(open(nf.replace('.f32', '.json'))); n = h['n']; r = h['res']
B = np.fromfile(bf, dtype=np.float32).reshape(n, n); A = np.fromfile(nf, dtype=np.float32).reshape(n, n)
mB = minimum_filter(np.where(np.isfinite(B), B, 1e9), size=101)[::25, ::25]
mA = minimum_filter(np.where(np.isfinite(A), A, 1e9), size=101)[::25, ::25]
ok = (mB > 1) & (mB < 1e8) & (mA < 1e8); d = mA - mB
def ras(pts):
    m = np.ones((n, n), bool)
    for pn, pe in pts:
        y = int((h['north'] + h['half'] - pn) / r); x = int((pe - h['east'] + h['half']) / r)
        if 0 <= y < n and 0 <= x < n: m[y, x] = False
    return distance_transform_edt(m) * r
P = lambda f: [(q[0], q[1]) for l in json.load(open(f)) if (l.get('kind') or 0) == 0 for q in l['pts']]
pB = P(bl); pN = P(nl)
dN = ras(pN)
left = [p for p in pB if 0 <= int((h['north'] + h['half'] - p[0]) / r) < n and 0 <= int((p[1] - h['east'] + h['half']) / r) < n and dN[int((h['north'] + h['half'] - p[0]) / r), int((p[1] - h['east'] + h['half']) / r)] > 300]
dL = ras(left)[::25, ::25]; dN2 = dN[::25, ::25]
rose = ok & (d > 50)
c1 = rose & (dL < 1000); c2 = rose & ~c1 & (dN2 < 1000); c3 = rose & ~c1 & ~c2
print(f'{nf}: windows {ok.sum()}, lowest rose > 50 m in {rose.sum()} ({100 * rose.sum() / ok.sum():.1f} %): by a course the rivers left {c1.sum()} ({100 * c1.sum() / max(1, rose.sum()):.0f} %), by a river now {c2.sum()} ({100 * c2.sum() / max(1, rose.sum()):.0f} %), elsewhere {c3.sum()}; rise p50 {np.median(d[rose]):.0f} m')
