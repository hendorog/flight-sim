"""kmlines.py DIR...: drawn km by kind (river 0, stream/chain 1) from lineDump dirs (s<seed>.json)."""
import json, sys, math
for D in sys.argv[1:]:
    row = []
    for s in (1, 42, 777777):
        L = json.load(open(f'{D}/s{s}.json'))
        km = {0: 0.0, 1: 0.0}
        for l in L:
            p = l['pts']
            km[l['kind']] = km.get(l['kind'], 0) + sum(math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]) for i in range(len(p) - 1)) / 1000
        row.append(f's{s} river {km[0]:.0f} stream+chain {km[1]:.0f}')
    print(D, ' | '.join(row))
