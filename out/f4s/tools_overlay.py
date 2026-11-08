# overlay.py SHOT.png RAY.f32 OUT.png : the pale pixels of a shot against what the rays found (viewRay probe).
import sys, numpy as np
from PIL import Image
shot, ray, outp = sys.argv[1:4]
W, H = 400, 225
r = np.fromfile(ray, dtype=np.float32).reshape(H, W, 8)
im = Image.open(shot).convert('RGB').resize((W, H), Image.BILINEAR)
a = np.asarray(im).astype(float)
mx, mn = a.max(2), a.min(2)
sat = (mx - mn) / np.maximum(mx, 1)
pale = (sat < 0.22) & (mx > 120) & ~np.isnan(r[..., 0])
slope, step, t, I, surf = r[..., 3], r[..., 4], r[..., 5], r[..., 6], r[..., 7]
edge = (t > 0.6) & (t < 1.0)
print(f'pale pixels {pale.sum()}; on rock class {np.mean(surf[pale]==1):.2f}; slope p10/p50/p90 {np.percentile(slope[pale],[10,50,90]).round(1)}')
print(f'  pale in a valley reach t 0.6..1: {np.mean(edge[pale]):.2f}; t quartiles {np.nanpercentile(np.where(t[pale]>-5,t[pale],np.nan),[10,25,50,75,90]).round(2)}; I median {np.median(I[pale][t[pale]>-5]) if (t[pale]>-5).any() else 0:.0f}')
print(f'  pale with a 25 m step > 50 m: {np.mean(step[pale]>50):.2f}; > 30 m {np.mean(step[pale]>30):.2f}')
ok = ~np.isnan(r[..., 0]) & ~pale & (r[..., 2] > 0)
print(f'not pale ground: slope p50/p90 {np.percentile(slope[ok],[50,90]).round(1)}; in reach edge {np.mean(edge[ok]):.2f}; step>50 {np.mean(step[ok]>50):.3f}')
# picture: shot dimmed, red = slope > 50 in the reach edge, yellow = slope > 50 elsewhere, cyan outline = pale
o = a * 0.55
steep = slope > 50
o[steep & edge] = [255, 40, 40]
o[steep & ~edge] = [255, 220, 0]
o[pale & ~steep] = o[pale & ~steep] * 0.3 + np.array([0, 200, 255]) * 0.7
big = Image.fromarray(o.clip(0, 255).astype(np.uint8)).resize((800, 450), Image.NEAREST)
orig = Image.open(shot).convert('RGB').resize((800, 450))
c = Image.new('RGB', (800, 900)); c.paste(orig, (0, 0)); c.paste(big, (0, 450)); c.save(outp)
