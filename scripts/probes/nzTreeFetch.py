# NZ DEM boxes for the drainage-tree comparison (learning only; nothing NZ goes into the sim).
# Reads the LINZ 8 m national DEM (CC BY 4.0, "Sourced from LINZ") at a coarse spacing through the landform tools
# (~/github/fs/out/landforms/tools, read only: its cache is copied to out/tree/nz/cache and lf.CACHE pointed there),
# and writes each box as float32 rows (north row first, sea/no-data = NaN) plus a JSON header, for
# scripts/probes/treeNz.test.ts, which measures it with the same code as the seeded lattice (treeMetrics.ts).
#   ~/github/fs/out/landforms/.venv/bin/python -I scripts/probes/nzTreeFetch.py [res_m]
import json, sys, time
from pathlib import Path
import numpy as np
TOOLS = Path.home() / "github/fs/out/landforms/tools"
sys.path.insert(0, str(TOOLS))
import lf  # noqa: E402
OUT = Path(__file__).resolve().parents[2] / "out/tree/nz"
lf.CACHE = OUT / "cache"
_want = lf.collections_for
lf.collections_for = lambda layer, bounds: [c for c in _want(layer, bounds) if "dem_8m" in c["dir"]]
BOXES = {
    # Main divide to the coast, Waimakariri to Rangitata: the Rakaia's whole catchment and its neighbours.
    "canterbury": (-44.25, 170.55, -42.85, 172.85),
    # Ruahine / Tararua ranges, the Manawatu and Rangitikei hill country and plains (North Island).
    "manawatu": (-40.75, 175.0, -39.45, 176.6),
}
res = float(sys.argv[1]) if len(sys.argv) > 1 else 1000.0
for name, (lat0, lon0, lat1, lon1) in BOXES.items():
    xa, ya = lf.TO_NZTM.transform([lon0, lon1, lon0, lon1], [lat0, lat0, lat1, lat1])
    b = (min(xa), min(ya), max(xa), max(ya))
    t = time.time()
    z, tr = lf.read_layer("dem", b, res)
    z = z.astype(np.float32)
    path = OUT / f"{name}_{int(res)}.f32"
    z.tofile(path)
    path.with_suffix(".json").write_text(json.dumps({"rows": z.shape[0], "cols": z.shape[1], "res": res, "bounds_nztm": b, "bbox": [lat0, lon0, lat1, lon1]}))
    print(f"{name}: {z.shape} at {res} m in {time.time() - t:.0f}s, land {100 * np.isfinite(z).mean():.0f} %, max {np.nanmax(z):.0f} m")
