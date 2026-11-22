#!/usr/bin/env python3
"""pits.py FILE.f32 [MIN_DEPTH] : closed pits deeper than MIN_DEPTH (10 m) in a heightExport grid, as validate.py
counts them (priority-flooded surface minus ground > 2 m, connected, >= 2 cells), with their deepest point in world
coordinates (north, east), depth, area (ha). Writes FILE.pits.json; prints a summary."""
import json, sys
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).parent))
import validate as V
from scipy.ndimage import label, maximum as nd_max, sum as nd_sum, maximum_position
f = Path(sys.argv[1]); mind = float(sys.argv[2]) if len(sys.argv) > 2 else 10.0
hdr = json.loads(f.with_suffix(".json").read_text())
n, res = hdr["n"], float(hdr["res"])
z = np.fromfile(f, np.float32).reshape(n, n).astype(np.float64)
fl = V._flood(z)
d = fl - z
lab, k = label(d > 2.0)
idx = np.arange(1, k + 1)
depth = nd_max(d, lab, idx); size = nd_sum(np.ones_like(z), lab, idx); pos = maximum_position(d, lab, idx)
rows = []
for dep, s, (r, c) in zip(depth, size, pos):
    if s < 2 or dep <= mind: continue
    north = hdr["north"] + hdr["half"] - (r + 0.5) * res; east = hdr["east"] - hdr["half"] + (c + 0.5) * res
    rows.append(dict(north=round(north, 1), east=round(east, 1), depth=round(float(dep), 1), ha=round(float(s) * res * res / 1e4, 2), z=round(float(z[r, c]), 1)))
rows.sort(key=lambda x: -x["depth"])
land = (~np.isnan(z)).sum() * (res / 1000) ** 2
Path(str(f) + ".pits.json").write_text(json.dumps(rows))
print(f"{len(rows)} pits > {mind} m ({len(rows)/land*100:.2f} /100 km2); depth p50 {np.median([r['depth'] for r in rows]) if rows else 0:.1f} m, ha p50 {np.median([r['ha'] for r in rows]) if rows else 0:.2f}")
for r in rows[:8]: print(" ", r)
