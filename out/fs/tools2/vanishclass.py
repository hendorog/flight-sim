#!/usr/bin/env python3
# vanishclass.py A B [R=500]: the f3 courses (dir A, >= 10 km2) that survival.py counts as vanished in dir B, each put
# in one class: 'absorbed' (a B river - kind 0 - of larger catchment within 300 m along >= 60 % of it: the river now
# runs where this course ran beside it), 'relaid' (some B line of any catchment within R m along >= 60 % of it: the
# gully still drains, by a line of another catchment), 'gone' (neither).
import json, math, sys
A, B = sys.argv[1], sys.argv[2]
R = float(sys.argv[3]) if len(sys.argv) > 3 else 500.0
CELL = 500
def index(lines, kinds):
    g = {}
    for li, L in enumerate(lines):
        if L["kind"] not in kinds: continue
        p = L["pts"]
        for i in range(len(p) - 1):
            n0, e0, a0 = p[i][:3]; n1, e1, a1 = p[i + 1][:3]
            for gy in range(int(min(n0, n1) // CELL), int(max(n0, n1) // CELL) + 1):
                for gx in range(int(min(e0, e1) // CELL), int(max(e0, e1) // CELL) + 1):
                    g.setdefault((gy, gx), []).append((n0, e0, a0, n1, e1, a1, li))
    return g
def hit(g, n, e, rr, test):
    for gy in range(int(n // CELL) - 1, int(n // CELL) + 2):
        for gx in range(int(e // CELL) - 1, int(e // CELL) + 2):
            for (n0, e0, a0, n1, e1, a1, li) in g.get((gy, gx), ()):
                dn, de = n1 - n0, e1 - e0; l2 = dn * dn + de * de or 1e-9
                t = max(0, min(1, ((n - n0) * dn + (e - e0) * de) / l2))
                if math.hypot(n0 + dn * t - n, e0 + de * t - e) > rr: continue
                if test(a0 + (a1 - a0) * t): return True
    return False
for seed in (1, 42, 777777):
    a = json.load(open(f"{A}/s{seed}.json")); b = json.load(open(f"{B}/s{seed}.json"))
    gall = index(b, (0, 1)); griv = index(b, (0,))
    cls = {"absorbed": [], "relaid": [], "gone": []}
    for li, L in enumerate(a):
        p = [q for q in L["pts"] if q[2] >= 10]
        if len(p) < 3: continue
        off = [q for q in p if not hit(gall, q[0], q[1], R, lambda ab, A=q[2]: 0.5 * A <= ab <= 2 * A)]
        if len(off) < 0.8 * len(p): continue
        ab = sum(1 for q in off if hit(griv, q[0], q[1], 300, lambda x, A=q[2]: x > 2 * A))
        rl = sum(1 for q in off if hit(gall, q[0], q[1], R, lambda x: True))
        k = "absorbed" if ab >= 0.6 * len(off) else "relaid" if rl >= 0.6 * len(off) else "gone"
        cls[k].append((len(off) * 0.1, li, L["kind"], max(q[2] for q in p), off[len(off) // 2][:2]))
    print(f"seed {seed}: vanished {sum(len(v) for v in cls.values())}: absorbed by a bigger river {len(cls['absorbed'])} ({sum(x[0] for x in cls['absorbed']):.1f} km), re-laid as a line of another catchment {len(cls['relaid'])} ({sum(x[0] for x in cls['relaid']):.1f} km), gone {len(cls['gone'])} ({sum(x[0] for x in cls['gone']):.1f} km)")
    for k in ("gone", "absorbed", "relaid"):
        for x in sorted(cls[k], reverse=True)[:25 if k == "gone" else 8]:
            print(f"   {k:8} line {x[1]} kind {x[2]} A up to {x[3]:.0f}: {x[0]:.1f} km; at {x[4][0]},{x[4][1]}")
