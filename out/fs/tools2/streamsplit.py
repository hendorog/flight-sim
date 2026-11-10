#!/usr/bin/env python3
"""streamsplit.py BASE NEW [seeds]: drawn stream/chain km (kind 1) of BASE (lineDump dirs) with no NEW line within 150 m,
split: 'river' - a NEW river (kind 0) within 300 m (the river now runs where the stream ran); 'valley' - a NEW river
within 1000 m (the stream ran down the same valley beside where the river now runs); 'other'. By BASE catchment band.
Also NEW stream km with no BASE line within 150 m (gained). Lists the biggest 'other' losses (line, km, where, area)."""
import json, sys, math
BASE, NEW = sys.argv[1], sys.argv[2]
seeds = (sys.argv[3] if len(sys.argv) > 3 else '1,42,777777').split(',')
C = 250
def dense(L):
    out = []
    for li, l in enumerate(L):
        p = l['pts']
        for i in range(len(p) - 1):
            n0, e0, a0 = p[i][:3]; n1, e1, a1 = p[i + 1][:3]
            d = math.hypot(n1 - n0, e1 - e0); k = max(1, int(d // 100))
            for j in range(k):
                t = j / k
                out.append((n0 + (n1 - n0) * t, e0 + (e1 - e0) * t, a0 + (a1 - a0) * t, l['kind'], li, d / k))
    return out
def grid(pts):
    g = {}
    for q in pts: g.setdefault((int(q[0] // C), int(q[1] // C)), []).append(q)
    return g
def near(g, n, e, r, kind=None):
    best = r + 1
    rr = int(r // C) + 1
    for gy in range(int(n // C) - rr, int(n // C) + rr + 1):
        for gx in range(int(e // C) - rr, int(e // C) + rr + 1):
            for q in g.get((gy, gx), ()):
                if kind is not None and q[3] != kind: continue
                d = math.hypot(q[0] - n, q[1] - e)
                if d < best: best = d
    return best
def band(a): return '<10' if a < 10 else '10-45' if a < 45 else '>=45'
for s in seeds:
    B = json.load(open(f'{BASE}/s{s}.json')); N = json.load(open(f'{NEW}/s{s}.json'))
    pb, pn = dense(B), dense(N)
    gb, gn = grid(pb), grid(pn)
    gnr = grid([q for q in pn if q[3] == 0])
    tot = {}; lost = {}; per = {}
    for q in pb:
        if q[3] != 1: continue
        b = band(q[2]); tot[b] = tot.get(b, 0) + q[5]
        if near(gn, q[0], q[1], 150) <= 150: continue
        dr = near(gnr, q[0], q[1], 1000)
        c = 'river' if dr <= 300 else 'valley' if dr <= 1000 else 'other'
        lost[(c, b)] = lost.get((c, b), 0) + q[5]
        if c == 'other':
            o = per.setdefault(q[4], [0, q[0], q[1], q[2]]); o[0] += q[5]
    gain = sum(q[5] for q in pn if q[3] == 1 and near(gb, q[0], q[1], 150) > 150)
    tb = sum(q[5] for q in pb if q[3] == 1); tn = sum(q[5] for q in pn if q[3] == 1)
    print(f'seed {s}: stream+chain km {tb/1000:.0f} -> {tn/1000:.0f} (net {(tn-tb)/1000:+.0f}); lost {sum(lost.values())/1000:.0f} km, gained {gain/1000:.0f} km')
    for c in ('river', 'valley', 'other'):
        print(f'  lost {c:6s}: ' + ', '.join(f'{b} {lost.get((c,b),0)/1000:6.1f}' for b in ('<10', '10-45', '>=45')) + f'  total {sum(v for k,v in lost.items() if k[0]==c)/1000:6.1f} km')
    big = sorted(per.items(), key=lambda x: -x[1][0])[:12]
    print('  biggest other: ' + '; '.join(f'line {li} {o[0]/1000:.1f} km at {o[1]:.0f},{o[2]:.0f} A {o[3]:.0f}' for li, o in big))
