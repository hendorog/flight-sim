#!/usr/bin/env python3
"""parallelRR.py LINES_DIR [seeds]: Round V A3 fix - parallel.py's doubled-course check for rivers beside rivers: every river
(kind 0) point within 300 m of another river's point whose catchment is 0.5-2 times its own; runs along the river longer
than 500 m, each told apart by where the river ends (on that river, within 300 m: a tributary running into its junction
beside its receiver; further: two rivers down one floor)."""
import json, math, sys
D = sys.argv[1]
seeds = [int(x) for x in (sys.argv[2] if len(sys.argv) > 2 else '1,42,777777').split(',')]
C = 300
for seed in seeds:
    L = json.load(open(f"{D}/s{seed}.json"))
    g = {}
    for lj, l in enumerate(L):
        if l['kind'] != 0: continue
        for q in l['pts']: g.setdefault((int(q[0] // C), int(q[1] // C)), []).append((q[0], q[1], q[2], lj))
    runs = []
    for li, l in enumerate(L):
        if l['kind'] != 0: continue
        p = l['pts']; run = 0.0; start = None; riv = None
        for i, q in enumerate(p):
            hit = None
            ci, cj = int(q[0] // C), int(q[1] // C)
            for a in range(ci - 1, ci + 2):
                for b in range(cj - 1, cj + 2):
                    for x in g.get((a, b), ()):
                        if x[3] != li and math.hypot(x[0] - q[0], x[1] - q[1]) <= C and 0.5 * q[2] <= x[2] <= 2 * q[2]: hit = x[3]
            if hit is not None:
                if start is None: start = q; riv = hit; run = 0.0
                else: run += math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1])
            else:
                if start is not None and run > 500: runs.append((run, li, riv, start))
                start = None; run = 0.0
        if start is not None and run > 500: runs.append((run, li, riv, start))
    def endGap(r):
        e = L[r[1]]['pts'][-1]
        return min(math.hypot(q[0] - e[0], q[1] - e[1]) for q in L[r[2]]['pts'])
    runs.sort(reverse=True)
    gaps = [endGap(r) for r in runs]
    # (A pair is listed from both rivers; the one that ends on the other is the tributary.)
    appr = sum(1 for g_ in gaps if g_ <= C)
    print(f"seed {seed}: {len(runs)} river-beside-river runs > 500 m ({sum(r[0] for r in runs) / 1000:.2f} km, each pair from both sides); the river ends on the other (junction approach) {appr}" + ''.join(f"\n   river {r[1]} by river {r[2]}: {r[0]:.0f} m from {r[3][0]:.0f},{r[3][1]:.0f} (A {r[3][2]:.0f}), ends {gg:.0f} m from it" for r, gg in list(zip(runs, gaps))[:6]))
