#!/usr/bin/env python3
"""rivermove.py A.json B.json: for the rivers (kind 0) whose samples differ, whether only the head moved: the samples
matched from the mouth up (same position within 1 m) and the level there, and where they part."""
import json, sys
A = json.load(open(sys.argv[1])); B = json.load(open(sys.argv[2]))
ra = [l for l in A if l['kind'] == 0]; rb = [l for l in B if l['kind'] == 0]
head_only = other = 0; dlv = 0.0; parts = []
for a, b in zip(ra, rb):
    na, nb = len(a['n']), len(b['n'])
    if na == nb and all(abs(x - y) <= 1 for x, y in zip(a['n'], b['n'])) and all(abs(x - y) <= 1 for x, y in zip(a['e'], b['e'])): continue
    k = 0
    while k < min(na, nb) and abs(a['n'][na - 1 - k] - b['n'][nb - 1 - k]) <= 1 and abs(a['e'][na - 1 - k] - b['e'][nb - 1 - k]) <= 1:
        dlv = max(dlv, abs(a['lv'][na - 1 - k] - b['lv'][nb - 1 - k])); k += 1
    frac = k / max(na, nb)
    parts.append(frac)
    if k >= min(na, nb) - 2: head_only += 1
    else: other += 1
parts.sort()
print(f"moved {len(parts)}: only the head (the rest identical from the mouth) {head_only}, parting lower down {other}; matched from the mouth: p10 {parts[len(parts)//10] if parts else 0:.2f} p50 {parts[len(parts)//2] if parts else 0:.2f} of the samples; max level change on the matched part {dlv:.2f} m")
