#!/usr/bin/env python3
"""parallel.py LINES_DIR [seeds]: PLAN-V A3's doubled-course check (checker R13's pattern): every stream or chain
(kind 1) point of 20 km2 or more within 300 m of a river (kind 0) point whose catchment is 0.5-2 times the stream's;
runs of such points along the stream longer than 500 m are listed (stream, river, length, where)."""
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
        if l['kind'] != 1: continue
        p = l['pts']; run = 0.0; start = None; riv = None
        def flush():
            if run > 500: runs.append((run, li, riv, start, p[i - 1] if i > 0 else start))
        for i, q in enumerate(p):
            hit = None
            if q[2] >= 20:
                ci, cj = int(q[0] // C), int(q[1] // C)
                for a in range(ci - 1, ci + 2):
                    for b in range(cj - 1, cj + 2):
                        for x in g.get((a, b), ()):
                            if math.hypot(x[0] - q[0], x[1] - q[1]) <= 300 and 0.5 * q[2] <= x[2] <= 2 * q[2]: hit = x[3]
            if hit is not None:
                if start is None: start = q; riv = hit; run = 0.0
                else: run += math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1])
            else:
                if start is not None: flush()
                start = None; run = 0.0
        i = len(p)
        if start is not None: flush()
    runs.sort(reverse=True)
    # (Round V A3 fix: each run told apart by where the stream ends - on that river's channel, within 300 m: a tributary
    # running beside its receiver into the junction; further: a true double, two courses down one floor.)
    def endGap(r):
        e = L[r[1]]['pts'][-1]
        return min(math.hypot(q[0] - e[0], q[1] - e[1]) for q in L[r[2]]['pts'])
    gaps = [endGap(r) for r in runs]
    true = [(r, g) for r, g in zip(runs, gaps) if g > C]
    print(f"seed {seed}: {len(runs)} runs > 500 m, {sum(r[0] for r in runs) / 1000:.2f} km; junction approaches (the stream ends on that river) {len(runs) - len(true)}, true doubles {len(true)} ({sum(r[0] for r, g in true) / 1000:.2f} km)" + ''.join(f"\n   stream {r[1]} by river {r[2]}: {r[0]:.0f} m from {r[3][0]:.0f},{r[3][1]:.0f} (A {r[3][2]:.0f}), ends {g:.0f} m from it{' TRUE DOUBLE' if g > C else ''}" for r, g in list(zip(runs, gaps))[:10]))
