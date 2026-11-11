#!/usr/bin/env python3
"""cmp.py OUT_DIR NAME:BEFORE_DIR ...: c130c47 | joined (Round V A4'+B) side by side, each 960x540 and labelled, into
OUT_DIR/NAME.png. The before dir is given per view (A4''s and B's c130c47 renders); the joined render is out/fs/J/after."""
import sys, os
from PIL import Image, ImageDraw
o = sys.argv[1]
A = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'after')
os.makedirs(o, exist_ok=True)
for arg in sys.argv[2:]:
    n, b = arg.split(':', 1)
    ims = []
    for t, d in (('c130c47', b), ('joined A4\'+B', A)):
        p = f'{d}/{n}.png'
        im = Image.open(p).convert('RGB').resize((960, 540)) if os.path.exists(p) else Image.new('RGB', (960, 540), (40, 40, 40))
        dr = ImageDraw.Draw(im)
        dr.rectangle([0, 0, 330, 28], fill=(0, 0, 0))
        dr.text((6, 6), f'{t}  {n}', fill=(255, 255, 0))
        ims.append(im)
    out = Image.new('RGB', (1930, 540), (255, 255, 255))
    out.paste(ims[0], (0, 0)); out.paste(ims[1], (970, 0))
    out.save(f'{o}/{n}.png')
    print('wrote', n)
