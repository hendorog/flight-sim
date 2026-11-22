#!/usr/bin/env python3
"""planform.py RIVERS_DIR [seeds]: plains planform of the drawn channels (riverDump json: kind, n, e, lv, g, a).
A 'plains' sample: water gradient over +-1 km < 0.4 %, ground < 400 m. Sinuosity: channel length / chord over windows
of 3 km of channel. Reports km and sinuosity p50/p90 by catchment band, for rivers (kind 0) and streams (kind 1)."""
import json, sys, math
D = sys.argv[1]; seeds = sys.argv[2].split(',') if len(sys.argv) > 2 else ['1', '42', '777777']
def pct(v, p):
    if not v: return float('nan')
    v = sorted(v); return v[min(len(v) - 1, int(p * len(v)))]
for s in seeds:
    L = json.load(open(f'{D}/s{s}.json'))
    out = {}
    for li, r in enumerate(L):
        n, e, lv, a = r['n'], r['e'], r['lv'], r['a']
        m = len(n)
        if m < 3: continue
        S = [0.0]
        for i in range(1, m): S.append(S[-1] + math.hypot(n[i] - n[i-1], e[i] - e[i-1]))
        # windows of 3 km by arc length, stepping 1.5 km
        j0 = 0
        st = 0.0
        while st + 3000 <= S[-1]:
            i0 = next(i for i in range(j0, m) if S[i] >= st); j0 = i0
            i1 = next((i for i in range(i0, m) if S[i] >= st + 3000), m - 1)
            ln = S[i1] - S[i0]; ch = math.hypot(n[i1] - n[i0], e[i1] - e[i0])
            grad = (lv[i0] - lv[i1]) / max(1, ln)
            A = a[(i0 + i1) // 2]
            if grad < 0.004 and lv[i0] < 400 and ch > 100:
                kind = 'river' if r['kind'] == 0 else 'stream'
                band = '<45' if A < 45 else '45-150' if A < 150 else '150-400' if A < 400 else '400-1500' if A < 1500 else '>=1500'
                out.setdefault((kind, band), []).append(ln / ch)
            st += 1500
    print(f'seed {s}')
    for k in sorted(out):
        v = out[k]
        print(f'  {k[0]:6s} {k[1]:9s} windows {len(v):5d} ({len(v)*1.5:7.0f} km)  sinuosity p50 {pct(v,.5):.3f} p90 {pct(v,.9):.3f}  share>=1.3 {sum(1 for x in v if x>=1.3)/len(v)*100:5.1f}%')
