"""sheet.py OUT NAME...: a contact sheet of A1 | A3r pairs (each pair 2 x 480x270, labelled), 2 pairs a row."""
import sys, os
from PIL import Image, ImageDraw
D = os.path.dirname(os.path.abspath(__file__))
out, names = sys.argv[1], sys.argv[2:]
W, H = 480, 270
rows = (len(names) + 1) // 2
sheet = Image.new('RGB', (2 * (2 * W + 10) + 10, rows * (H + 6)), (255, 255, 255))
for k, n in enumerate(names):
    x0 = (k % 2) * (2 * W + 20)
    y0 = (k // 2) * (H + 6)
    for j, t in enumerate(('A1', 'A3r')):
        p = f'{D}/{t}/{n}.png'
        im = Image.open(p).convert('RGB').resize((W, H)) if os.path.exists(p) else Image.new('RGB', (W, H), (40, 40, 40))
        d = ImageDraw.Draw(im)
        d.rectangle([0, 0, 190, 16], fill=(0, 0, 0))
        d.text((4, 3), f'{t} {n}', fill=(255, 255, 0))
        sheet.paste(im, (x0 + j * (W + 2), y0))
sheet.save(out)
print('wrote', out)
