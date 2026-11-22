#!/usr/bin/env python3
"""pitnear3.py BASE.f32 NEW.f32 DUMP.json OLD_LINES.json [NEW_LINES.json]: Round V A2's pit classes. The pits of NEW (pitnear2's
rule, validate.py's pit10: a closed hollow > 10 m deep of 2 cells or more), per 100 km2 of land, and each pit classed by
what lies within 500 m of its centre (A2 probe dump, a2Attrib.test.ts A2_DUMP: from A1's build):
  core   - a fine node on a river core's taper (0 < core < held: the held core's edge in the slope pass)
  corner - a lattice cell the 1 km corner fix lowered by more than 20 m (the 1 km square, by its edge)
  axis   - a river point of OLD_LINES (V0's wandered axes)
shares of all of NEW's pits and of the new ones (none of BASE's within 150 m), each class alone and exclusively in that
order (core, then corner, then axis, then other). Run with the landforms venv (numba)."""
import json, math, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import numpy as np
from scipy import ndimage as nd
import validate as V
def pits(f):  # pitnear2.py's
    h = json.load(open(f.replace('.f32', '.json'))); n = h['n']; res = h['res']
    z = np.fromfile(f, dtype=np.float32).reshape(n, n).astype(np.float64)
    d = V._flood(z) - z; lab, k = nd.label(d > 2.0); idx = np.arange(1, k + 1)
    dep = nd.maximum(d, lab, idx); size = nd.sum(np.ones_like(d), lab, idx) * (res / 1000) ** 2
    com = nd.center_of_mass(d > 2.0, lab, idx)
    return [(dep[i], size[i], h['north'] + h['half'] - (com[i][0] + 0.5) * res, h['east'] - h['half'] + (com[i][1] + 0.5) * res)
            for i in range(k) if dep[i] > 10 and size[i] >= 2 * (res / 1000) ** 2]
bf, nf, df, of = sys.argv[1:5]
base = pits(bf); new = pits(nf)
D = json.load(open(df))
hdr = json.load(open(nf.replace('.f32', '.json')))
z = np.fromfile(nf, dtype=np.float32)
land = np.isfinite(z).sum() * (hdr['res'] / 1000) ** 2
def grid(P, c=500.0):
    g = {}
    for p in P: g.setdefault((int(math.floor(p[0] / c)), int(math.floor(p[1] / c))), []).append(p)
    return g
gCore = grid([(p[0], p[1]) for p in D['taper']])
gCorner = grid([(p[0], p[1]) for p in D['corner'] if p[2] > 20], 1000.0)
old = [(q[0], q[1]) for l in json.load(open(of)) if (l.get('kind') or 0) == 0 for q in l['pts']]
gOld = grid(old)
def near(g, n, e, r, c=500.0, sq=0.0):
    k = int(math.ceil((r + sq) / c)) + 1
    for y in range(int(math.floor(n / c)) - k, int(math.floor(n / c)) + k + 1):
        for x in range(int(math.floor(e / c)) - k, int(math.floor(e / c)) + k + 1):
            for q in g.get((y, x), ()):
                dn = max(0.0, abs(q[0] - n) - sq); de = max(0.0, abs(q[1] - e) - sq)
                if dn * dn + de * de <= r * r: return True
    return False
def classes(p):
    n, e = p[2], p[3]
    return {'core': near(gCore, n, e, 500), 'corner': near(gCorner, n, e, 500, 1000.0, 500.0), 'axis': near(gOld, n, e, 500)}
gHeld = grid([(p[0], p[1]) for p in D.get('held', [])])
def nearest(g, n, e, c=500.0):
    best = 1e9
    for y in range(int(math.floor(n / c)) - 2, int(math.floor(n / c)) + 3):
        for x in range(int(math.floor(e / c)) - 2, int(math.floor(e / c)) + 3):
            for q in g.get((y, x), ()): best = min(best, math.hypot(q[0] - n, q[1] - e))
    return best
def where(p):
    # The fine node (250 m) nearest the pit's centre, if within half a diagonal: on the held core, on its taper, or off it.
    h = nearest(gHeld, p[2], p[3]); t = nearest(gCore, p[2], p[3])
    if min(h, t) > 177: return 'off'
    return 'held' if h <= t else 'taper'
gNew = grid([(q[0], q[1]) for l in json.load(open(sys.argv[5])) if (l.get('kind') or 0) == 0 for q in l['pts']]) if len(sys.argv) > 5 else None
close = lambda p, S: any((p[2] - q[2]) ** 2 + (p[3] - q[3]) ** 2 < 150 ** 2 for q in S)
nw = [p for p in new if not close(p, base)]
def report(name, P):
    if not P:
        print(f'  {name}: 0'); return
    C = [classes(p) for p in P]
    alone = {k: sum(c[k] for c in C) for k in ('core', 'corner', 'axis')}
    ex = {'core': 0, 'corner': 0, 'axis': 0, 'other': 0}
    for c in C: ex['core' if c['core'] else 'corner' if c['corner'] else 'axis' if c['axis'] else 'other'] += 1
    W = [where(p) for p in P]
    if gHeld: print(f'  {name}: centre on a held core node {W.count("held")}, on a taper node {W.count("taper")}, off the core {W.count("off")}' + (f'; nearest river (NEW_LINES) p50 {np.median([nearest(gNew, p[2], p[3]) for p in P]):.0f} m' if gNew else ''))
    print(f'  {name}: {len(P)}; within 500 m of a core taper {alone["core"]} ({100*alone["core"]/len(P):.0f} %), of a corner-lowered cell {alone["corner"]} ({100*alone["corner"]/len(P):.0f} %), of an old (V0) axis {alone["axis"]} ({100*alone["axis"]/len(P):.0f} %); exclusive core/corner/axis/other {ex["core"]}/{ex["corner"]}/{ex["axis"]}/{ex["other"]}')
print(f'{nf}: pits > 10 m {len(new)} ({100 * len(new) / land:.2f} per 100 km2 of {land:.0f} km2 land); base {len(base)} ({100 * len(base) / land:.2f}); new {len(nw)}, gone {sum(1 for p in base if not close(p, new))}')
report('all pits', new)
report('new pits', nw)
for p in sorted(nw, key=lambda p: -p[0])[:8]:
    c = classes(p)
    print(f'    new depth {p[0]:5.1f} m, {p[1]*100:5.1f} ha at {p[2]:.0f},{p[3]:.0f}: {",".join(k for k in c if c[k]) or "other"}')
