#!/usr/bin/env python3
"""gate.py NAME [NAME ...]: the stage-4 hard-gate numbers from validate.py's metrics.json (out/f4/data/validate/NAME)."""
import json, statistics as st, sys
from pathlib import Path
D = Path(__file__).resolve().parent.parent / "data" / "validate"
print(f"{'name':16} {'p50':>5} {'p90':>5} {'peak':>9} {'r1km':>5} {'r5km':>5} {'b1-100':>6} {'b1-10':>6} {'b10-100':>7} {'pit10':>6} {'pit5':>5} {'theta':>5} {'hack':>5} {'elev50/99':>10}")
for n in sys.argv[1:]:
    d = json.load(open(D / n / "metrics.json"))
    L = d["land_km2"]
    h = d["hollows"]
    pit10 = sum(1 for x in h if x[2] > 10) / L * 100
    pit5 = sum(1 for x in h if x[2] > 5) / L * 100
    v = d["valleys"]
    b = lambda lo, hi: st.median([x["b"] for x in v if lo <= x["area_km2"] < hi] or [float("nan")])
    hist = d["slope_hist"]
    i = max(range(len(hist)), key=lambda k: hist[k])
    s = d["slope_deg_pct"]
    e = d["elev_pct"]
    print(f"{n:16} {s['50']:5.1f} {s['90']:5.1f} {i*2.5:4.1f}-{i*2.5+2.5:4.1f} {d['relief_1km_median_m']:5.0f} {d['relief_5km_median_m']:5.0f} {b(1,100):6.2f} {b(1,10):6.2f} {b(10,100):7.2f} {pit10:6.2f} {pit5:5.1f} {d['flint_theta']:5.2f} {d['hack_h']:5.2f} {e['50']:5.0f}/{e['99']:4.0f}")
