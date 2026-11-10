#!/usr/bin/env python3
# doubled.py BASE NEW [seeds]: drawn stream km of BASE (kind 1, ~100 m points) with no line of NEW within 150 m, split:
#   strict  - a settled river of NEW (its point moved > 100 m off its BASE course) runs within 250 m and the stream's
#             catchment there is at least half the river's (the brief's doubled stream);
#   river   - a settled river of NEW runs within 300 m (it took the stream's floor; any catchment);
#   valley  - a settled river of NEW runs within 1000 m and the same river's BASE course ran within 1500 m, parallel
#             (the stream ran down the same valley as the river: a doubled course the settled river now drains);
#   other   - the rest.
# Also the stream km gained (NEW off BASE) and the net. Lists the biggest 'other' lines.
import json, sys, math
BASE, NEW = sys.argv[1], sys.argv[2]
seeds = [int(x) for x in (sys.argv[3] if len(sys.argv) > 3 else '1,42,777777').split(',')]
C = 250
def cells(lines, pred):
    g = {}
    for lj, L in enumerate(lines):
        if not pred(lj, L): continue
        p = L['pts']
        for i in range(len(p)):
            q = p[i]
            nxt = p[i + 1] if i + 1 < len(p) else p[i]
            dn, de = nxt[0] - q[0], nxt[1] - q[1]
            for f in (0, 0.5) if i + 1 < len(p) else (0,):
                n, e = q[0] + dn * f, q[1] + de * f
                g.setdefault((int(n // C), int(e // C)), []).append((n, e, q[2], lj, dn, de))
    return g
def near(g, n, e, r):
    k = int(r // C) + 1; ci, cj = int(n // C), int(e // C); best = None
    for a in range(ci - k, ci + k + 1):
        for b in range(cj - k, cj + k + 1):
            for x in g.get((a, b), ()):
                d = math.hypot(x[0] - n, x[1] - e)
                if d <= r and (best is None or d < best[0]): best = (d,) + x
    return best
for seed in seeds:
    a = json.load(open(f"{BASE}/s{seed}.json")); b = json.load(open(f"{NEW}/s{seed}.json"))
    ga = cells(a, lambda lj, L: True); gb = cells(b, lambda lj, L: True)
    # settled river points of NEW, and BASE rivers by line
    rb = {}
    for lj, L in enumerate(a):
        if L['kind'] == 0: rb[lj] = cells([L], lambda *_: True)
    settled = {}
    for lj, L in enumerate(b):
        if L['kind'] != 0 or lj not in rb: continue
        for q in L['pts']:
            x = near(rb[lj], q[0], q[1], 100)
            if x is None: settled.setdefault((int(q[0] // C), int(q[1] // C)), []).append((q[0], q[1], q[2], lj, 0, 0))
    km = {'strict': 0.0, 'river': 0.0, 'valley': 0.0, 'other': 0.0}
    per = {}
    for li, L in enumerate(a):
        if L['kind'] != 1: continue
        p = L['pts']
        for i, q in enumerate(p):
            if near(gb, q[0], q[1], 150) is not None: continue
            s = near(settled, q[0], q[1], 1000)
            cls = 'other'
            if s is not None:
                if s[0] <= 250 and q[2] >= 0.5 * s[3]: cls = 'strict'
                elif s[0] <= 300: cls = 'river'
                else:
                    o = near(rb[s[4]], q[0], q[1], 1500)
                    if o is not None:
                        nx = p[min(i + 1, len(p) - 1)]; pv = p[max(i - 1, 0)]
                        tn, te = nx[0] - pv[0], nx[1] - pv[1]
                        c = abs(tn * o[5] + te * o[6]) / ((math.hypot(tn, te) * math.hypot(o[5], o[6])) or 1)
                        if c >= 0.7: cls = 'valley'
            km[cls] += 0.1
            if cls == 'other': per[li] = per.get(li, 0) + 0.1
    gain = 0.0
    for lj, L in enumerate(b):
        if L['kind'] != 1: continue
        for q in L['pts']:
            if near(ga, q[0], q[1], 150) is None: gain += 0.1
    tb = sum(len(L['pts']) for L in a if L['kind'] == 1) * 0.1; tn = sum(len(L['pts']) for L in b if L['kind'] == 1) * 0.1
    print(f"seed {seed}: stream km (dumps) {tb:.0f} -> {tn:.0f} ({100 * (tn - tb) / tb:+.1f} %); off any NEW line (150 m): strict doubled {km['strict']:.0f}, river took its floor {km['river']:.0f}, same valley as a settled river {km['valley']:.0f}, other {km['other']:.0f}; NEW off BASE (moved or new) {gain:.0f}")
    for li, k in sorted(per.items(), key=lambda x: -x[1])[:8]:
        q = a[li]['pts'][len(a[li]['pts']) // 2]
        print(f"   other: line {li} {k:.1f} km (A end {a[li]['pts'][-1][2]:.0f}) e.g. {q[0]},{q[1]}")
