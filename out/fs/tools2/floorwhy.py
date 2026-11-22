"""floorwhy.py V0.f32 A.f32 N n0 e0 half step OUT [K]: floorlift's valley-floor cells of the V0 box (within 15 m of the
lowest V0 ground within 500 m, under 1500 m, not sea) whose drawn ground rose more than 50 m in A; K of them (default
400) at random, as 'north,east,v0,a' lines into OUT (for scripts/probes/floorWhy), with the counts."""
import sys, numpy as np
from scipy.ndimage import minimum_filter
B = np.fromfile(sys.argv[1], dtype=np.float32); A = np.fromfile(sys.argv[2], dtype=np.float32)
n = int(sys.argv[3]); n0, e0, half, step = map(float, sys.argv[4:8]); out = sys.argv[8]; K = int(sys.argv[9]) if len(sys.argv) > 9 else 400
B = B.reshape(n, n); A = A.reshape(n, n)
ok = np.isfinite(A) & np.isfinite(B) & (B > 1)
mn = minimum_filter(np.where(ok, B, 1e9), size=51)
floor = ok & (B - mn < 15) & (B < 1500)
rose = floor & (A - B > 50)
ys, xs = np.nonzero(rose)
print(f'V0 floor cells {floor.sum()}, risen > 50 m {rose.sum()} ({100 * rose.sum() / max(1, floor.sum()):.1f} %)')
rng = np.random.default_rng(1)
pick = rng.choice(len(ys), size=min(K, len(ys)), replace=False) if len(ys) else []
with open(out, 'w') as f:
    for k in pick:
        y, x = ys[k], xs[k]
        f.write(f'{n0 + half - (y + 0.5) * step:.0f},{e0 - half + (x + 0.5) * step:.0f},{B[y, x]:.1f},{A[y, x]:.1f}\n')
