#!/usr/bin/env python3
"""steep.py F.f32 [...]: a landform box's (heightExport format) land steeper than 35 / 40 degrees, km2 and share (central
differences at its own spacing, cells with a NaN neighbour left out)."""
import json, sys, numpy as np
for f in sys.argv[1:]:
    h = json.load(open(f.replace('.f32', '.json'))); n = h['n']; r = h['res']
    z = np.fromfile(f, dtype=np.float32).reshape(n, n).astype(np.float64)
    gy, gx = np.gradient(z, r)
    d = np.degrees(np.arctan(np.hypot(gx, gy)))
    ok = np.isfinite(d)
    a = r * r / 1e6
    print(f'{f}: land {ok.sum() * a:.0f} km2; over 35 deg {(d[ok] > 35).sum() * a:.1f} km2 ({100 * (d[ok] > 35).mean():.2f} %), over 40 deg {(d[ok] > 40).sum() * a:.1f} km2 ({100 * (d[ok] > 40).mean():.2f} %)')
