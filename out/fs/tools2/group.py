#!/usr/bin/env python3
# group.py JSON... : raised reaches (bank or valley > 10 m, invWalls) grouped by cause; reaches, km, reaches > 30 m.
import json, sys, collections
def grp(x):
    c = x['cause']
    if c in ('bench', 'lowerLineBeside'):
        if c == 'lowerLineBeside' and x['lineLen'] - x['sWorst'] < 1000 and x['joins'] in x['others']:
            return '3 tributary beside its receiver before the junction'
        return '1 river on a bench off its valley low line' if x['kind'] == 'river' else '2 stream/chain on a floor beside a lower floor'
    return {'overGround': '4 water >10 m over its own centre ground', 'aboveNatural': '5 level over the natural ground at its centre',
            'lakeHeld': '6 lake level', 'lakeBeside': '6 lake level', 'bankLow': '7 bank low (other)', 'sea': '8 sea'}[c]
res = {}
for f in sys.argv[1:]:
    d = json.load(open(f))
    g = collections.defaultdict(lambda: [0, 0.0, 0])
    for x in d['part2']['reaches']:
        if x['group'] != 'raised': continue
        k = grp(x); g[k][0] += 1; g[k][1] += x['len'] / 1000; g[k][2] += x['h'] > 30
    res[f] = g
keys = sorted(set(k for g in res.values() for k in g))
for k in keys:
    print(k.ljust(52), ' | '.join(f"{res[f][k][0]:5d} r {res[f][k][1]:7.1f} km {res[f][k][2]:4d}>30" for f in sys.argv[1:]))
