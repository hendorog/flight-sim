# basinmap.py export.f32 [N]: closed basins (> 50 m deep, > 0.2 km2) of an export with their deepest point (north, east).
import sys, json, numpy as np
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import validate
from scipy import ndimage
f = sys.argv[1]
hdr = json.loads(Path(f).with_suffix('.json').read_text())
n, res = hdr['n'], hdr['res']
z = np.fromfile(f, np.float32).reshape(n, n).astype(np.float64)
F = validate._flood(z)
d = F - z
wet = np.nan_to_num(d) > 1e-3
lab, k = ndimage.label(wet, structure=np.ones((3, 3)))
idx = np.arange(1, k + 1)
depth = ndimage.maximum(np.nan_to_num(d), lab, idx)
size = ndimage.sum(np.ones_like(z), lab, idx) * (res / 1000) ** 2
pos = ndimage.maximum_position(np.nan_to_num(d), lab, idx)
rows = [(depth[i], size[i], pos[i]) for i in range(k) if depth[i] > 50 and size[i] > 0.2]
rows.sort(key=lambda r: -r[0])
print(f"{len(rows)} basins > 50 m and > 0.2 km2, {sum(r[1] for r in rows):.1f} km2")
for dp, sz, (y, x) in rows[: int(sys.argv[2]) if len(sys.argv) > 2 else 60]:
    north = hdr['north'] + hdr['half'] - (y + 0.5) * res
    east = hdr['east'] - hdr['half'] + (x + 0.5) * res
    print(f"{north:.0f} {east:.0f} depth {dp:.0f} size {sz:.2f} floor {z[y, x]:.0f}")
