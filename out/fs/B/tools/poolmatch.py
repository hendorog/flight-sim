#!/usr/bin/env python3
"""poolmatch.py NEW_DIR REF_DIR [REF2_DIR ...]: every standing pool of NEW (poolMatch.test.ts dumps, pools-<seed>.tsv)
matched by place against each reference tree's pools (centroid within 600 m and level within 30 m). Prints, per seed:
counts by kind, the pools new against every reference (in none of them), and the reference pools lost (no NEW pool
within 600 m), with their level, bottom, wet points (each 0.0625 km2) and kind."""
import sys, csv, math, os
R = 600.0
def load(d, s):
    p = os.path.join(d, f'pools-{s}.tsv')
    if not os.path.exists(p): return None
    out = []
    for r in csv.DictReader(open(p), delimiter='\t'):
        if r['drained'] == '1': continue
        out.append({k: (float(v) if k not in ('kind',) else v) for k, v in r.items()})
    return out
def near(p, pools):
    best = None
    for q in pools:
        d = math.hypot(p['north'] - q['north'], p['east'] - q['east'])
        if d < R and abs(p['level'] - q['level']) < 30 and (best is None or d < best[0]): best = (d, q)
    return best
new, refs = sys.argv[1], sys.argv[2:]
for s in ('1', '42', '777777', '7'):
    N = load(new, s)
    if N is None: continue
    Rs = [(r, load(r, s)) for r in refs]
    Rs = [(r, x) for r, x in Rs if x is not None]
    kinds = {}
    for p in N: kinds[p['kind']] = kinds.get(p['kind'], 0) + 1
    print(f'seed {s}: {len(N)} pools ({", ".join(f"{k} {v}" for k, v in sorted(kinds.items()))}); water points {sum(p["wet"] for p in N):.0f}')
    newp = [p for p in N if all(near(p, x) is None for _, x in Rs)]
    print(f'  new against every reference ({", ".join(os.path.basename(r.rstrip("/")) for r, _ in Rs)}): {len(newp)}, {sum(p["wet"] for p in newp) * 0.0625:.2f} km2')
    for p in sorted(newp, key=lambda p: -p['wet']):
        print(f'    {p["kind"]} {p["north"]:.0f},{p["east"]:.0f} level {p["level"]:.1f} bottom {p["bottom"]:.1f} depth {p["level"] - p["bottom"]:.1f} wet {p["wet"]:.0f} ({p["wet"] * 0.0625:.2f} km2)')
    for r, x in Rs:
        lost = [q for q in x if near(q, N) is None]
        print(f'  {os.path.basename(r.rstrip("/"))}: {len(x)} pools; lost (no pool within {R:.0f} m now): {len(lost)}; of its main lakes lost {sum(1 for q in lost if q["kind"] == "main")}')
        for q in sorted(lost, key=lambda q: -q['wet'])[:12]:
            print(f'    lost {q["kind"]} {q["north"]:.0f},{q["east"]:.0f} level {q["level"]:.1f} wet {q["wet"]:.0f}')
