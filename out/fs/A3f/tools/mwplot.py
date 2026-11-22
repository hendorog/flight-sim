# Plot a mapWin.test.ts window: drawn, route, route-model, slope-model, m/fw, with lines and slope-pass floor nodes and dir.
import json, sys
import numpy as np
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
d = json.load(open(sys.argv[1])); out = sys.argv[2]
k = d['k']; n0, e0, st = d['n0'], d['e0'], d['step']
G = {a: np.array(v, float).reshape(k, k) for a, v in d['g'].items()}
ext = [e0, e0 + (k - 1) * st, n0, n0 + (k - 1) * st]
panels = [('drawn', G['drawn'], 'terrain'), ('route (streams)', G['route'], 'terrain'), ('route - model', G['route'] - G['model'], 'RdBu_r'), ('slope - model', G['slope'] - G['model'], 'RdBu_r'), ('m', G['m'], 'viridis'), ('fw (floor draw)', G['fw'], 'viridis')]
fig, ax = plt.subplots(2, 3, figsize=(21, 14))
DI = [-1, -1, -1, 0, 0, 1, 1, 1]; DJ = [-1, 0, 1, -1, 1, -1, 0, 1]
for a, (t, z, cm) in zip(ax.flat, panels):
    if cm == 'RdBu_r':
        im = a.imshow(z, origin='lower', extent=ext, cmap=cm, vmin=-80, vmax=80)
    else:
        im = a.imshow(z, origin='lower', extent=ext, cmap=cm)
    if t.startswith('drawn') or t.startswith('route ('):
        a.contour(np.linspace(ext[0], ext[1], k), np.linspace(ext[2], ext[3], k), z, levels=np.arange(np.nanmin(z) // 10 * 10, np.nanmax(z) + 10, 10), colors='k', linewidths=0.3)
    plt.colorbar(im, ax=a, fraction=0.04)
    a.set_title(t)
    for L in d['lines']:
        p = np.array(L['pts'])
        a.plot(p[:, 1], p[:, 0], '-', color='b' if L['kind'] == 0 else 'c', lw=1.2)
        a.text(p[len(p) // 2, 1], p[len(p) // 2, 0], str(L['li']), fontsize=7, color='navy')
    for nd in d['nodes']:
        n, e, h, w, fl, di, ar = nd
        if fl: a.plot(e, n, 's', ms=3, color='orange')
        if di and t.startswith('m'):
            a.annotate('', xy=(e + DJ[di - 1] * 200, n + DI[di - 1] * 200), xytext=(e, n), arrowprops=dict(arrowstyle='->', lw=0.6 + min(2, ar / 10), color='w'))
    a.set_xlim(ext[0], ext[1]); a.set_ylim(ext[2], ext[3])
plt.tight_layout(); plt.savefig(out, dpi=70)
