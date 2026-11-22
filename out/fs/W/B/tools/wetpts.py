#!/usr/bin/env python3
# wetpts.py STATS_DIR OUT_DIR: per seed, every 1 km braided transect's middle with share >= 0.3 (braidStats JSON), thinned
# to at most 60 evenly through the list, as wetBoxes' points.
import json, sys, os
S, O = sys.argv[1], sys.argv[2]
os.makedirs(O, exist_ok=True)
for s in ['1', '42', '777777', '7']:
    r = [x for x in json.load(open(f'{S}/braid-s{s}.json')) if x['b'] >= 0.3]
    step = max(1, len(r) // 60)
    pts = [[x['n'], x['e']] for x in r[::step]][:60]
    json.dump(pts, open(f'{O}/pts-s{s}.json', 'w'))
    print(s, len(r), 'braided transects,', len(pts), 'boxes')
