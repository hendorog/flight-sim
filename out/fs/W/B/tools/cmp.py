#!/usr/bin/env python3
# cmp.py NAME...: before | after composites of out/fs/W/B/pics/{before,after}/NAME.png into pics/cmp/NAME.png (full
# resolution, labelled), skipping a name with either render missing.
import sys, os
from PIL import Image, ImageDraw, ImageFont
P = '/home/roger/github/fs-exp/round-w-braid/out/fs/W/B/pics'
os.makedirs(f'{P}/cmp', exist_ok=True)
try:
    font = ImageFont.truetype('/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf', 28)
except Exception:
    font = ImageFont.load_default()
for n in sys.argv[1:]:
    a, b = f'{P}/before/{n}.png', f'{P}/after/{n}.png'
    if not (os.path.exists(a) and os.path.exists(b)):
        print('skip', n); continue
    A, B = Image.open(a).convert('RGB'), Image.open(b).convert('RGB')
    C = Image.new('RGB', (A.width + B.width + 8, max(A.height, B.height)), (255, 255, 255))
    C.paste(A, (0, 0)); C.paste(B, (A.width + 8, 0))
    d = ImageDraw.Draw(C)
    for x, t in ((10, f'before 1d7825d  {n}'), (A.width + 18, f'after (braids)  {n}')):
        d.rectangle((x - 4, 6, x + 12 + d.textlength(t, font=font), 44), fill=(0, 0, 0))
        d.text((x + 4, 8), t, fill=(255, 255, 255), font=font)
    C.save(f'{P}/cmp/{n}.png')
    print('ok', n)
