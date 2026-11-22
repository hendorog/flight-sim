#!/usr/bin/env python3
"""rivercmp.py A.json B.json : compare two riverDump files (same seed): rivers (kind 0) matched by index and position;
level change along them, and the streams' count and length."""
import json, sys, math
import numpy as np
A = json.load(open(sys.argv[1])); B = json.load(open(sys.argv[2]))
ra = [l for l in A if l['kind'] == 0]; rb = [l for l in B if l['kind'] == 0]
print(f"rivers {len(ra)} -> {len(rb)}; streams {sum(1 for l in A if l['kind'])} -> {sum(1 for l in B if l['kind'])}")
same = moved = 0; dl = []; dm = []; worst = (0, None)
for i, (a, b) in enumerate(zip(ra, rb)):
    if len(a['n']) != len(b['n']) or any(abs(x - y) > 1 for x, y in zip(a['n'], b['n'])) or any(abs(x - y) > 1 for x, y in zip(a['e'], b['e'])):
        moved += 1
        # Their channels swing differently on their floors: compare the level at each sample's nearest one (<= 50 m).
        pa = np.c_[a['n'], a['e']].astype(float); la = np.array(a['lv'])
        for k in range(len(b['n'])):
            d2 = ((pa[:, 0] - b['n'][k]) ** 2 + (pa[:, 1] - b['e'][k]) ** 2)
            j = int(np.argmin(d2))
            if d2[j] <= 2500: dm.append(abs(b['lv'][k] - la[j]))
        continue
    same += 1
    d = np.array(b['lv']) - np.array(a['lv'])
    dl.extend(d.tolist())
    k = int(np.argmax(np.abs(d)))
    if abs(d[k]) > abs(worst[0]): worst = (float(d[k]), (i, a['n'][k], a['e'][k], a['lv'][k], b['lv'][k]))
dl = np.abs(np.array(dl))
print(f"rivers on the same axis {same}, axis moved {moved}")
if len(dl): print(f"level change |d| over their samples: p50 {np.median(dl):.2f} p90 {np.percentile(dl,90):.2f} p99 {np.percentile(dl,99):.2f} max {dl.max():.1f} m; share > 1 m {np.mean(dl>1)*100:.1f} %, > 5 m {np.mean(dl>5)*100:.1f} %; worst {worst}")
if dm:
    dm = np.array(dm); print(f"moved rivers, level at the nearest sample (<= 50 m, {len(dm)} samples): p50 {np.median(dm):.2f} p90 {np.percentile(dm,90):.2f} p99 {np.percentile(dm,99):.2f} max {dm.max():.1f} m; > 1 m {np.mean(dm>1)*100:.1f} %")
def km(L): return sum(math.hypot(l['n'][k+1]-l['n'][k], l['e'][k+1]-l['e'][k]) for l in L for k in range(len(l['n'])-1))/1000
print(f"stream km {km([l for l in A if l['kind']]):.0f} -> {km([l for l in B if l['kind']]):.0f}")
