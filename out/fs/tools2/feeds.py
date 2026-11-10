#!/usr/bin/env python3
"""feeds.py DIR [seeds]: stream/chain lines (kind 1) by where they end: within 300 m of a river (kind 0), of another
stream, elsewhere (in a lake, the sea, ...). The 'one stream for each gully' count: lines ending on a river, per 100 km of
river."""
import json, sys, math
D = sys.argv[1]; seeds = (sys.argv[2] if len(sys.argv) > 2 else '1,42,777777').split(',')
C = 300
for s in seeds:
    L = json.load(open(f'{D}/s{s}.json'))
    g = {}
    rkm = 0
    for li, l in enumerate(L):
        p = l['pts']
        if l['kind'] == 0: rkm += sum(math.hypot(p[i+1][0]-p[i][0], p[i+1][1]-p[i][1]) for i in range(len(p)-1)) / 1000
        for i in range(len(p) - 1):
            n0, e0 = p[i][:2]; n1, e1 = p[i+1][:2]
            d = math.hypot(n1-n0, e1-e0); k = max(1, int(d // 50))
            for j in range(k + 1):
                t = j / k; n = n0 + (n1-n0)*t; e = e0 + (e1-e0)*t
                g.setdefault((int(n//C), int(e//C)), []).append((n, e, l['kind'], li))
    def nearest(n, e, skip, kind):
        best = 1e9
        for gy in (int(n//C)-1, int(n//C), int(n//C)+1):
            for gx in (int(e//C)-1, int(e//C), int(e//C)+1):
                for q in g.get((gy, gx), ()):
                    if q[3] == skip or q[2] != kind: continue
                    best = min(best, math.hypot(q[0]-n, q[1]-e))
        return best
    onr = ons = other = 0
    for li, l in enumerate(L):
        if l['kind'] != 1: continue
        n, e = l['pts'][-1][:2]
        if nearest(n, e, li, 0) <= 300: onr += 1
        elif nearest(n, e, li, 1) <= 300: ons += 1
        else: other += 1
    print(f'seed {s}: river km {rkm:.0f}; streams {onr+ons+other}: ending on a river {onr} ({100*onr/rkm:.1f} per 100 river km), on a stream {ons}, elsewhere {other}')
