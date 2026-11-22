# basins.py metrics.json [depth_m] [area_km2]: count dry closed hollows deeper/larger than the thresholds (validate.py "hollows": elev, size km2, depth m).
import json, sys
m = json.load(open(sys.argv[1]))
D = float(sys.argv[2]) if len(sys.argv) > 2 else 50
A = float(sys.argv[3]) if len(sys.argv) > 3 else 0.2
h = [x for x in m["hollows"] if x[2] > D and x[1] > A]
print(f"hollows total {len(m['hollows'])} (/100 km2 {m['hollows_per_100km2']:.1f}); > {D:.0f} m deep and > {A} km2: {len(h)}, {sum(x[1] for x in h):.1f} km2; >10 m deep: {sum(1 for x in m['hollows'] if x[2] > 10)}")
for x in sorted(h, key=lambda x: -x[2])[:8]: print(f"  elev {x[0]:.0f} m, {x[1]:.2f} km2, {x[2]:.0f} m deep")
