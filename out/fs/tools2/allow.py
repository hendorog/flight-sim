#!/usr/bin/env python3
# allow.py BASE_MOVED NEW_MOVED NEW_MOVEDWHY [SETTLE_ALLOW]: owner decision 2's generated allow-list. Every f3 line
# moved.py flags in NEW that it did not flag in BASE (finalS8) must be allowed, with its reason:
#  - 'dead-end notch': 50 % or more of its moved length ran as a notch more than 5 m under its ground in the current
#    build (movedwhy.py): the trace's pit climb round a hollow, removed by filling the hollow (round T step 2);
#  - 'settle': listed in SETTLE_ALLOW (lines "seed line km reason", written by the settle's own flag list, step 5).
# Prints the list per seed and every moved line that is neither (a failure).
import re, sys
def moved(path):
    out = {}; seed = None
    for l in open(path):
        m = re.match(r"seed (\d+):", l)
        if m: seed = int(m.group(1)); out.setdefault(seed, {}); continue
        m = re.match(r"\s+(?:f3 )?line (\d+)(?: kind \d+ A up to \d+ km2)?: ([\d.]+) km off(?:, ([\d.]+) km of it)?", l)
        if m and seed is not None: out[seed][int(m.group(1))] = (float(m.group(2)), float(m.group(3)) if m.group(3) else None)
    return out
base = moved(sys.argv[1]); new = moved(sys.argv[2]); why = moved(sys.argv[3])
settle = {}
if len(sys.argv) > 4:
    for l in open(sys.argv[4]):
        p = l.split(None, 3)
        if len(p) >= 3: settle[(int(p[0]), int(p[1]))] = p[3].strip() if len(p) > 3 else 'settle'
bad = 0
for seed in sorted(why):
    rows = []
    for li, (km, notch) in sorted(why[seed].items()):
        if li in base.get(seed, {}): rows.append(f"   line {li}: {km:.1f} km off - in the baseline already (finalS8)"); continue
        if notch is not None and notch >= 0.5 * km: rows.append(f"   line {li}: {km:.1f} km off, {notch:.1f} km of it a notch > 5 m under its ground ({100 * notch / km:.0f} %): allowed, dead-end notch"); continue
        if (seed, li) in settle: rows.append(f"   line {li}: {km:.1f} km off: allowed, {settle[(seed, li)]}"); continue
        rows.append(f"   line {li}: {km:.1f} km off, notch {notch} km: NOT ALLOWED"); bad += 1
    print(f"seed {seed}: {len(why[seed])} moved lines")
    print("\n".join(rows))
print(f"not allowed: {bad}")
