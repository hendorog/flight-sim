#!/usr/bin/env python3
"""slopemap.py OUT.png DIR [DIR ...] [--seed 42] [--step 25]: the onSlope probe's box (slope-s<seed>.u8: degrees x 4,
slope-s<seed>.f64: the drawn ground, N x N, row 0 the south edge) as a north-up map: hillshade, orange over 35 deg, red
over 40 deg, 2x; several DIRs side by side (e.g. V0 | A1). Prints each DIR's area over 35 / 40 deg, km2 (step m cells)."""
import sys, math
import numpy as np
from PIL import Image
args = sys.argv[1:]
seed = '42'; step = 25.0
if '--seed' in args: i = args.index('--seed'); seed = args[i + 1]; del args[i:i + 2]
if '--step' in args: i = args.index('--step'); step = float(args[i + 1]); del args[i:i + 2]
out, dirs = args[0], args[1:]
tiles = []
for d in dirs:
    deg = np.fromfile(f'{d}/slope-s{seed}.u8', dtype=np.uint8)
    n = int(round(math.sqrt(deg.size))); deg = deg.reshape(n, n) / 4.0
    h = np.fromfile(f'{d}/slope-s{seed}.f64', dtype=np.float64).reshape(n, n)
    gy, gx = np.gradient(h, step)
    # light from the north-west, 45 deg up
    nx, ny, nz = -gx, -gy, np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    lx, ly, lz = -0.5, 0.5, math.sqrt(0.5)
    shade = np.clip((nx * lx + ny * ly + nz * lz) / ln, 0, 1)
    rgb = np.stack([60 + 160 * shade] * 3, axis=-1)
    rgb[deg > 35] = (230, 130, 60)
    rgb[deg > 40] = (205, 40, 35)
    inner = deg[1:-1, 1:-1]  # the probe leaves the edge row and column at 0 (as onSlope's own shares)
    a35 = (inner > 35).sum() * step * step / 1e6; a40 = (inner > 40).sum() * step * step / 1e6
    print(f'{d}: seed {seed} box {n}x{n} at {step:.0f} m: over 35 deg {a35:.2f} km2 ({100 * (inner > 35).mean():.1f} %), over 40 deg {a40:.2f} km2 ({100 * (inner > 40).mean():.1f} %)')
    tiles.append(np.flipud(rgb).astype(np.uint8))
gap = np.full((tiles[0].shape[0], 6, 3), 255, np.uint8)
row = tiles[0]
for t in tiles[1:]: row = np.concatenate([row, gap, t], axis=1)
im = Image.fromarray(row)
im.resize((im.width * 2, im.height * 2), Image.NEAREST).save(out)
