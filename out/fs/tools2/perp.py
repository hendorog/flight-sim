#!/usr/bin/env python3
"""perp.py LINES.json NAME=n,e[,back,beyond] ...: a transect across the valley through each site: along the normal of the
nearest river (kind 0) at its nearest point, from `back` m (default 1500) beyond the site on its side of the river to
`beyond` m (default 800) past the river. Prints NAME=n0,e0:n1,e1 (A2_TR's format), joined by ';', and each site's river."""
import json, math, sys
L = json.load(open(sys.argv[1]))
riv = [(li, l['pts']) for li, l in enumerate(L) if (l.get('kind') or 0) == 0]
out = []
for arg in sys.argv[2:]:
    name, v = arg.split('=')
    p = [float(x) for x in v.split(',')]
    n, e = p[0], p[1]; back = p[2] if len(p) > 2 else 1500; beyond = p[3] if len(p) > 3 else 800
    best = (1e18, None, None)
    for li, pts in riv:
        for i, q in enumerate(pts):
            d = (q[0] - n) ** 2 + (q[1] - e) ** 2
            if d < best[0]: best = (d, li, i)
    d, li, i = best; pts = dict(riv)[li]
    a = pts[max(0, i - 3)]; b = pts[min(len(pts) - 1, i + 3)]
    tn, te = b[0] - a[0], b[1] - a[1]; tl = math.hypot(tn, te); tn /= tl; te /= tl
    q = pts[i]
    # unit normal pointing from the river to the site
    nn, ne = -te, tn
    if (n - q[0]) * nn + (e - q[1]) * ne < 0: nn, ne = -nn, -ne
    ds = (n - q[0]) * nn + (e - q[1]) * ne
    n0, e0 = q[0] + nn * (ds + back), q[1] + ne * (ds + back)
    n1, e1 = q[0] - nn * beyond, q[1] - ne * beyond
    print(f'# {name}: river line {li} point {q[0]},{q[1]} (area {q[2]} km2), site {ds:.0f} m from it, {math.sqrt(d):.0f} m to the point', file=sys.stderr)
    out.append(f'{name}={n0:.0f},{e0:.0f}:{n1:.0f},{e1:.0f}')
print(';'.join(out))
