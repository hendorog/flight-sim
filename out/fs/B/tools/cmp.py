#!/usr/bin/env python3
"""cmp.py BEFORE_DIR AFTER_DIR OUT_DIR NAME...: before (c130c47) | after (Round V B) side by side, each 960x540 and
labelled, into OUT_DIR/NAME.png."""
import sys, os
from PIL import Image, ImageDraw
b, a, o = sys.argv[1:4]
os.makedirs(o, exist_ok=True)
for n in sys.argv[4:]:
    ims = []
    for t, d in (('before c130c47', b), ('after Round V B', a)):
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
