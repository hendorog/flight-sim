#!/usr/bin/env python3
"""pitnear.py BASE.f32 BASE_LINES.json NEW.f32 NEW_LINES.json: the new and gone seed-box pits (pitdiff's rule: > 10 m deep,
none in the other within 150 m), each classed by the nearest river change: 'moved' within 400 m of a NEW river point
> 150 m from every BASE river point (a moved reach), 'oldshelf' within 400 m of a BASE river point > 150 m from every
NEW river point (the course it left), else 'other'. Run with the landforms venv (numba)."""
import json, math, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))  # validate.py beside it (out/fs/tools2)
import numpy as np
from scipy import ndimage as nd
import validate as V
def pits(f):
    h = json.load(open(f.replace('.f32', '.json'))); n = h['n']; res = h['res']
    z = np.fromfile(f, dtype=np.float32).reshape(n, n).astype(np.float64)
    d = V._flood(z) - z; lab, k = nd.label(d > 2.0); idx = np.arange(1, k + 1)
    dep = nd.maximum(d, lab, idx); size = nd.sum(np.ones_like(d), lab, idx) * (res / 1000) ** 2
    com = nd.center_of_mass(d > 2.0, lab, idx)
    return [(dep[i], size[i], h['north'] + h['half'] - (com[i][0] + 0.5) * res, h['east'] - h['half'] + (com[i][1] + 0.5) * res)
            for i in range(k) if dep[i] > 10 and size[i] >= 2 * (res / 1000) ** 2]
def riverpts(f):
    return [(q[0], q[1]) for l in json.load(open(f)) if (l.get('kind') or 0) == 0 for q in l['pts']]
def grid(P, c=500.0):
    g = {}
    for p in P: g.setdefault((int(p[0] // c), int(p[1] // c)), []).append(p)
    return g
def dmin(g, n, e, c=500.0, r=2):
    best = 1e9
    for y in range(int(n // c) - r, int(n // c) + r + 1):
        for x in range(int(e // c) - r, int(e // c) + r + 1):
            for q in g.get((y, x), ()): best = min(best, math.hypot(q[0] - n, q[1] - e))
    return best
bf, bl, nf, nl = sys.argv[1:5]
base = pits(bf); new = pits(nf); B = riverpts(bl); N = riverpts(nl); gB = grid(B); gN = grid(N)
gM = grid([p for p in N if dmin(gB, *p) > 150]); gO = grid([p for p in B if dmin(gN, *p) > 150])
near = lambda p, S: any((p[2] - q[2]) ** 2 + (p[3] - q[3]) ** 2 < 150 ** 2 for q in S)
def cls(P):
    c = {'moved': 0, 'oldshelf': 0, 'other': 0}
    for p in P:
        c['moved' if dmin(gM, p[2], p[3]) < 400 else 'oldshelf' if dmin(gO, p[2], p[3]) < 400 else 'other'] += 1
    return c
nw = [p for p in new if not near(p, base)]; gone = [p for p in base if not near(p, new)]
print(f"pits {len(base)} -> {len(new)}; new {len(nw)} {cls(nw)}; gone {len(gone)} {cls(gone)}")
gR = grid(N)
for p in sorted(nw, key=lambda p: -p[0])[:25]:
    k = 'moved' if dmin(gM, p[2], p[3]) < 400 else 'oldshelf' if dmin(gO, p[2], p[3]) < 400 else 'other'
    print(f"  new {k:8s} depth {p[0]:5.1f} m size {p[1]*100:5.1f} ha at {p[2]:.0f},{p[3]:.0f}; nearest new river {dmin(gR, p[2], p[3], r=4):.0f} m")
