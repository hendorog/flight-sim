#!/usr/bin/env python3
"""lakematch.py BASE NEW: match the drainage ponds (lakes) of two mrLakes dumps by place (centre within 1.5 km): lost,
new, left dry, level and area changes."""
import json, sys, math
B, N = sys.argv[1], sys.argv[2]
for s in (1, 42, 777777):
    b = json.load(open(f'{B}/lakes-s{s}.json'))['ponds']; n = json.load(open(f'{N}/lakes-s{s}.json'))['ponds']
    used = set(); lost = []; changed = []
    for p in b:
        best = None
        for q in n:
            if q['k'] in used: continue
            d = math.hypot(p['n'] - q['n'], p['e'] - q['e'])
            if d < 1500 and (best is None or d < best[0]): best = (d, q)
        if best is None: lost.append(p); continue
        q = best[1]; used.add(q['k'])
        if (p['pool'] >= 0) != (q['pool'] >= 0) or abs(p['level'] - q['level']) > 5 or abs(p['wetKm2'] - q['wetKm2']) > max(0.5, 0.3 * p['wetKm2']):
            changed.append((p, q))
    new = [q for q in n if q['k'] not in used]
    print(f'seed {s}: base {len(b)} (wet {sum(1 for p in b if p["pool"]>=0)}), new {len(n)} (wet {sum(1 for p in n if p["pool"]>=0)}); matched {len(b)-len(lost)}, lost {len(lost)}, new {len(new)}, changed {len(changed)}')
    for p in lost: print(f'   lost  at {p["n"]},{p["e"]} level {p["level"]} cells {p["cells"]} wet {p["wetKm2"]} km2 river {p["river"]}')
    for q in new: print(f'   new   at {q["n"]},{q["e"]} level {q["level"]} cells {q["cells"]} wet {q["wetKm2"]} km2 river {q["river"]}')
    for p, q in changed: print(f'   moved at {p["n"]},{p["e"]}: level {p["level"]} -> {q["level"]}, wet {p["wetKm2"]} -> {q["wetKm2"]} km2, cells {p["cells"]} -> {q["cells"]}, dry {p["pool"]<0} -> {q["pool"]<0}')
