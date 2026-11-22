"""pitdiff.py A.f32 B.f32: hollows > 10 m deep in B with none in A within 150 m (new), and the reverse count."""
import sys, json
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).parent))
import validate as V
from scipy import ndimage as nd
def pits(f):
    h = json.load(open(f.replace('.f32', '.json'))); n = h['n']; res = h['res']
    z = np.fromfile(f, dtype=np.float32).reshape(n, n).astype(np.float64)
    d = V._flood(z) - z
    lab, k = nd.label(d > 2.0); idx = np.arange(1, k + 1)
    dep = nd.maximum(d, lab, idx); size = nd.sum(np.ones_like(d), lab, idx) * (res / 1000) ** 2
    com = nd.center_of_mass(d > 2.0, lab, idx)
    return [(dep[i], size[i], h['north'] + h['half'] - (com[i][0] + 0.5) * res, h['east'] - h['half'] + (com[i][1] + 0.5) * res) for i in range(k) if dep[i] > 10 and size[i] >= 2 * (res / 1000) ** 2]
A = pits(sys.argv[1]); B = pits(sys.argv[2])
def near(p, S): return any((p[2] - q[2]) ** 2 + (p[3] - q[3]) ** 2 < 150 ** 2 for q in S)
new = sorted([p for p in B if not near(p, A)], reverse=True); gone = [p for p in A if not near(p, B)]
print(f"A {len(A)}, B {len(B)}: new in B {len(new)}, gone from A {len(gone)}")
for p in new[:int(sys.argv[3]) if len(sys.argv) > 3 else 25]: print(f"  new depth {p[0]:5.1f} m area {p[1]:.4f} at {p[2]:.0f},{p[3]:.0f}")
