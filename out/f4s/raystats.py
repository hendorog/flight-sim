# raystats.py RAY.f32 [...]: the share of a view's ground pixels steeper than 43 degrees (the CPU's rock) and 50, and of
# those in a valley's outer reach (t 0.6-1) - viewRay probe output.
import sys, numpy as np
for p in sys.argv[1:]:
    r = np.fromfile(p, dtype=np.float32).reshape(225, 400, 8)
    ok = ~np.isnan(r[..., 0]) & (r[..., 2] > 0)
    s, t = r[..., 3], r[..., 5]
    edge = (t > 0.6) & (t < 1)
    n = ok.sum()
    print(f'{p.split("/")[-1]:28} ground {n}; >43 deg {np.mean(s[ok] > 43):.3f} (outer reach {np.mean((s > 43) & edge & ok) / max(1e-9, np.mean(ok)):.3f}); >50 deg {np.mean(s[ok] > 50):.3f}; rock class {np.mean(r[..., 7][ok] == 1):.3f}')
