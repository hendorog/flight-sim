"""floorlift.py B.f32 A.f32 N: drawn-ground change A-B on an exported box (N x N, 20 m), overall and on valley floors
(cells of B within 15 m of the lowest B within 500 m, under 1500 m, not sea), by B's local relief."""
import sys, numpy as np
from scipy.ndimage import minimum_filter, maximum_filter
n = int(sys.argv[3])
B = np.fromfile(sys.argv[1], dtype=np.float32).reshape(n, n)
A = np.fromfile(sys.argv[2], dtype=np.float32).reshape(n, n)
ok = np.isfinite(A) & np.isfinite(B) & (B > 1)
d = A - B
mn = minimum_filter(np.where(ok, B, 1e9), size=51)  # 1 km window
mx = maximum_filter(np.where(ok, B, -1e9), size=51)
floor = ok & (B - mn < 15)
rel = mx - mn
def q(x):
    return ' '.join(f'p{p} {np.percentile(x, p):+.1f}' for p in (10, 50, 90)) + f'  mean {x.mean():+.1f}  share>+20m {100*(x>20).mean():.1f}%  share>+50m {100*(x>50).mean():.1f}%  share<-20m {100*(x<-20).mean():.1f}%'
print(f'all land ({ok.sum()} cells): {q(d[ok])}')
print(f'valley floors (within 15 m of the 1 km low; {floor.sum()} cells): {q(d[floor])}')
for lo, hi in ((0, 200), (200, 400), (400, 800), (800, 5000)):
    m = floor & (rel >= lo) & (rel < hi)
    if m.sum(): print(f'  floors, 1 km relief {lo}-{hi} m ({m.sum()} cells): {q(d[m])}')
