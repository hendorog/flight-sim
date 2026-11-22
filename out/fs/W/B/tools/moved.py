#!/usr/bin/env python3
# moved.py BEFORE_DIR AFTER_DIR SEEDS: how far the after lines' points (lineMoved dumps, every 50 m) lie from the nearest
# before point, split by the braid share there (0: a line that does not braid there, before or after), in km of line:
# moved over 2, 10, 50 m.
import json, sys
import numpy as np
from scipy.spatial import cKDTree
B, A, seeds = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
for s in seeds:
    b = np.array(json.load(open(f'{B}/lines-s{s}.json')))
    a = np.array(json.load(open(f'{A}/lines-s{s}.json')))
    t = cKDTree(b[:, 2:4])
    d, _ = t.query(a[:, 2:4])
    for tag, sel in (('share 0', a[:, 4] <= 0), ('share > 0', a[:, 4] > 0)):
        for kind, kn in ((0, 'rivers'), (1, 'streams')):
            m = sel & (a[:, 1] == kind)
            n = m.sum()
            km = n * 0.05
            def over(x): return f'{(m & (d > x)).sum() * 0.05:.1f}'
            print(f'seed {s} {tag} {kn}: {km:.0f} km; moved > 2 m {over(2)} km, > 10 m {over(10)} km, > 50 m {over(50)} km')
