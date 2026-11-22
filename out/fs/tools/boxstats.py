# boxstats.py name... : validate.py's numbers per region (out/f2/data/validate/<name>/metrics.json) on one line.
import json, sys
sys.path.insert(0, '/home/roger/github/fs-exp/foundation2/out/f2/tools')
for name in sys.argv[1:]:
    m = json.load(open(f'/home/roger/github/fs-exp/foundation2/out/f2/data/validate/{name}/metrics.json'))
    big = [x for x in m['hollows'] if x[2] > 50 and x[1] > 0.2]
    print(f"{name}: slope pct {m['slope_deg_pct']}; elev pct {m['elev_pct']}; relief 1/5 km {m['relief_1km_median_m']:.0f}/{m['relief_5km_median_m']:.0f} m; Flint {m['flint_theta']:.2f}; Hack {m['hack_h']:.2f}; hollows {len(m['hollows'])}, >10 m {sum(1 for x in m['hollows'] if x[2] > 10)}, >50 m & >0.2 km2 {len(big)} ({sum(x[1] for x in big):.1f} km2)")
