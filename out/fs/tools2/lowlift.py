"""lowlift.py B.f32 A.f32 N: change of the lowest drawn ground within 1 km and within 2 km (A - B), sampled on a 500 m grid
over land, so it reads whether valley bottoms rose or sank wherever the river ended up."""
import sys, numpy as np
from scipy.ndimage import minimum_filter
n = int(sys.argv[3])
B = np.fromfile(sys.argv[1], dtype=np.float32).reshape(n, n)
A = np.fromfile(sys.argv[2], dtype=np.float32).reshape(n, n)
for w, name in ((51, '1 km'), (101, '2 km')):
    mB = minimum_filter(np.where(np.isfinite(B), B, 1e9), size=w)[::25, ::25]
    mA = minimum_filter(np.where(np.isfinite(A), A, 1e9), size=w)[::25, ::25]
    ok = (mB > 1) & (mB < 1e8) & (mA < 1e8)
    d = (mA - mB)[ok]
    print(f'lowest within {name}: p10 {np.percentile(d,10):+.1f} p25 {np.percentile(d,25):+.1f} p50 {np.percentile(d,50):+.1f} p75 {np.percentile(d,75):+.1f} p90 {np.percentile(d,90):+.1f}; rose >20 m {100*(d>20).mean():.0f}%, >50 m {100*(d>50).mean():.0f}%; sank >20 m {100*(d<-20).mean():.0f}%')
