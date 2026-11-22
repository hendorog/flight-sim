#!/usr/bin/env python3
# moved.py A B: for each seed, the f3 lines (dir A) with catchment >= 10 km^2 whose course is more than 150 m from any
# line of dir B. A line "moved" if 500 m or more of it (its >= 10 km^2 part) lies off; "vanished" if 80 % or more does.
import json, math, sys
A, B = sys.argv[1], sys.argv[2]
CELL = 200
for seed in (1, 42, 777777):
    a = json.load(open(f"{A}/s{seed}.json")); b = json.load(open(f"{B}/s{seed}.json"))
    grid = {}
    for li, L in enumerate(b):
        p = L["pts"]
        for i in range(len(p) - 1):
            n0, e0, n1, e1 = p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]
            for gy in range(int(min(n0, n1) // CELL) - 1, int(max(n0, n1) // CELL) + 2):
                for gx in range(int(min(e0, e1) // CELL) - 1, int(max(e0, e1) // CELL) + 2):
                    grid.setdefault((gy, gx), []).append((n0, e0, n1, e1))
    def dist(n, e):
        best = 1e9
        for gy in range(int(n // CELL) - 1, int(n // CELL) + 2):
            for gx in range(int(e // CELL) - 1, int(e // CELL) + 2):
                for (n0, e0, n1, e1) in grid.get((gy, gx), ()):
                    dn, de = n1 - n0, e1 - e0; l2 = dn * dn + de * de or 1e-9
                    t = max(0, min(1, ((n - n0) * dn + (e - e0) * de) / l2))
                    d = math.hypot(n0 + dn * t - n, e0 + de * t - e)
                    if d < best: best = d
        return best
    moved = []; vanished = 0; km = 0; total = 0; lines = 0
    for li, L in enumerate(a):
        p = [q for q in L["pts"] if q[2] >= 10]
        if len(p) < 3: continue
        lines += 1
        off = [q for q in p if dist(q[0], q[1]) > 150]
        total += len(p) * 0.1
        if len(off) * 100 >= 500:
            km += len(off) * 0.1
            far = max(off, key=lambda q: q[2])
            moved.append((len(off) * 0.1, li, L["kind"], max(q[2] for q in p), far, len(off) / len(p)))
            if len(off) >= 0.8 * len(p): vanished += 1
    moved.sort(reverse=True)
    print(f"seed {seed}: f3 lines with A>=10: {lines} ({total:.0f} km); moved >150 m over >=0.5 km: {len(moved)} ({vanished} vanished, >=80 % off), {km:.1f} km off")
    for (k, li, kind, amax, far, fr) in moved[:5]:
        print(f"   line {li} kind {kind} A up to {amax:.0f} km2: {k:.1f} km off ({fr*100:.0f} %); e.g. at {far[0]},{far[1]} (A {far[2]:.0f})")
