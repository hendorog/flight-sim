#!/usr/bin/env python3
# bandwidth.py PROJ IMAGE: for each projected sample (projLines probe), the drawn band's width across the line in the
# render: the run of pixels about the line's point (within 4 px of it, across its screen direction over +-20 px) whose
# luminance departs from the local background (median of the outer 8 px each side) by more than 18 or whose colour does;
# reported per line against the projected bed-law width (bed px) and water width (px).
import json, sys, math
from PIL import Image
pts = [json.loads(l[3:]) for l in open(sys.argv[1]) if l.startswith('PL ')]
im = Image.open(sys.argv[2]).convert('RGB'); W, H = im.size; px = im.load()
lum = lambda c: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
by = {}
for p in pts: by.setdefault(p['li'], []).append(p)
for li, P in by.items():
    rows = []
    for k, p in enumerate(P):
        a, b = P[max(0, k - 2)], P[min(len(P) - 1, k + 2)]
        dx, dy = b['px'] - a['px'], b['py'] - a['py']; L = math.hypot(dx, dy)
        if L < 1: continue
        nx, ny = -dy / L, dx / L
        prof = []
        for t in range(-20, 21):
            x, y = int(round(p['px'] + nx * t)), int(round(p['py'] + ny * t))
            if not (0 <= x < W and 0 <= y < H): prof = None; break
            prof.append(px[x, y])
        if not prof: continue
        bg = sorted([lum(c) for c in prof[:8] + prof[-8:]])[8]
        bgc = [sorted(c[i] for c in prof[:8] + prof[-8:])[8] for i in range(3)]
        off = [abs(lum(c) - bg) > 18 or sum(abs(c[i] - bgc[i]) for i in range(3)) > 45 for c in prof]
        # the run containing a pixel within 4 of the centre
        best = 0
        for c0 in range(16, 25):
            if not off[c0]: continue
            i0 = c0; i1 = c0
            while i0 > 0 and off[i0 - 1]: i0 -= 1
            while i1 < 40 and off[i1 + 1]: i1 += 1
            best = max(best, i1 - i0 + 1)
        rows.append((best, p['bed'], p['water'], p['A'], p['dist']))
    if not rows: continue
    seen = [r for r in rows if r[0] > 0]
    ratio = sorted(r[0] / max(r[1], 1) for r in seen)
    q = lambda a, f: a[min(len(a) - 1, int(f * len(a)))] if a else float('nan')
    A = sorted(r[3] for r in rows)
    print(f"line {li}: A {A[0]:.0f}-{A[-1]:.0f} km2, {len(rows)} points at {min(r[4] for r in rows)}-{max(r[4] for r in rows)} m; band seen at {len(seen)}; band px p50 {q(sorted(r[0] for r in seen),0.5)} (bed-law px p50 {q(sorted(r[1] for r in rows),0.5):.1f}, water px {q(sorted(r[2] for r in rows),0.5):.1f}); band/bed p50 {q(ratio,0.5):.2f} p90 {q(ratio,0.9):.2f}; mean contrast-pixels {sum(r[0] for r in rows)/len(rows):.1f}")
