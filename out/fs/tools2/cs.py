#!/usr/bin/env python3
"""cs.py A B: course survival (design-U). For each f3 line (dir A, lineDump json) of >= 10 km2, every point of its
>= 10 km2 part looks for a point of any line in B within R m (500) whose catchment is within x0.5-2 of its own. A
course has VANISHED when 80 % or more of that part (and at least 0.5 km) finds none; 'partly lost' when 1 km or more
finds none but under 80 %. Points are 100 m apart (0.1 km each)."""
import json, math, sys
A, B = sys.argv[1], sys.argv[2]
R = float(sys.argv[3]) if len(sys.argv) > 3 else 500.0
CELL = 500.0
for seed in (1, 42, 777777):
    a = json.load(open(f"{A}/s{seed}.json")); b = json.load(open(f"{B}/s{seed}.json"))
    grid = {}
    for L in b:
        for q in L["pts"]:
            grid.setdefault((int(q[0] // CELL), int(q[1] // CELL)), []).append(q)
    def ok(n, e, area):
        gy, gx = int(n // CELL), int(e // CELL)
        for y in range(gy - 1, gy + 2):
            for x in range(gx - 1, gx + 2):
                for q in grid.get((y, x), ()):
                    if 0.5 * area <= q[2] <= 2 * area and (q[0] - n) ** 2 + (q[1] - e) ** 2 <= R * R:
                        return True
        return False
    lines = 0; total = 0; van = []; part = []
    for li, L in enumerate(a):
        p = [q for q in L["pts"] if q[2] >= 10]
        if len(p) < 3: continue
        lines += 1; total += len(p) * 0.1
        miss = [q for q in p if not ok(q[0], q[1], q[2])]
        if not miss: continue
        km = len(miss) * 0.1
        rec = (km, li, L.get("kind"), max(q[2] for q in p), len(p) * 0.1, miss[len(miss) // 2])
        if len(miss) >= 0.8 * len(p) and km >= 0.5: van.append(rec)
        elif km >= 1.0: part.append(rec)
    van.sort(reverse=True); part.sort(reverse=True)
    print(f"seed {seed}: f3 courses >= 10 km2: {lines} ({total:.0f} km); VANISHED {len(van)} ({sum(v[0] for v in van):.1f} km); partly lost (>= 1 km unmatched) {len(part)} ({sum(v[0] for v in part):.1f} km)")
    for (km, li, kind, amax, ln, at) in van:
        print(f"   vanished line {li} kind {kind} A up to {amax:.0f} km2, {ln:.1f} km, {km:.1f} km unmatched; e.g. at {at[0]:.0f},{at[1]:.0f} (A {at[2]:.0f})")
    for (km, li, kind, amax, ln, at) in part[:8]:
        print(f"   partly lost line {li} kind {kind} A up to {amax:.0f} km2: {km:.1f} of {ln:.1f} km unmatched; e.g. at {at[0]:.0f},{at[1]:.0f} (A {at[2]:.0f})")
