"""cmp.py NAME...: A1 | A3r side by side (each 960x540, labelled) into shotsV/cmpA3r/NAME.png."""
import sys, os
from PIL import Image, ImageDraw
D = os.path.dirname(os.path.abspath(__file__))
for n in sys.argv[1:]:
    ims = []
    for t in ('A1', 'A3r'):
        p = f'{D}/{t}/{n}.png'
        im = Image.open(p).convert('RGB').resize((960, 540)) if os.path.exists(p) else Image.new('RGB', (960, 540), (40, 40, 40))
        d = ImageDraw.Draw(im)
        d.rectangle([0, 0, 260, 28], fill=(0, 0, 0))
        d.text((6, 6), f'{t}  {n}', fill=(255, 255, 0))
        ims.append(im)
    out = Image.new('RGB', (1930, 540), (255, 255, 255))
    out.paste(ims[0], (0, 0)); out.paste(ims[1], (970, 0))
    out.save(f'{D}/../cmpA3r/{n}.png')
    print('wrote', n)
