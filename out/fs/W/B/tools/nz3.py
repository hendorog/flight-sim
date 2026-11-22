#!/usr/bin/env python3
# nz3.py OUT NZ.png NZ_MPP BEFORE.png AFTER.png OURS_MPP LABEL: an NZ plan (LINZ) beside our before and after at the
# same metres a pixel (the NZ picture resampled to ours), each cropped to the same window, with 1 km bars.
import sys
from PIL import Image, ImageDraw, ImageFont
out, nz, nzm, bf, af, om, label = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4], sys.argv[5], float(sys.argv[6]), sys.argv[7]
font = ImageFont.truetype('/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf', 22)
N = Image.open(nz).convert('RGB'); N = N.resize((round(N.width * nzm / om), round(N.height * nzm / om)), Image.LANCZOS)
B = Image.open(bf).convert('RGB'); A = Image.open(af).convert('RGB')
w, h = min(N.width, A.width, 900), min(N.height, A.height)
mid = lambda I: I.crop(((I.width - w) // 2, (I.height - h) // 2, (I.width - w) // 2 + w, (I.height - h) // 2 + h))
C = Image.new('RGB', (3 * w + 16, h), (255, 255, 255))
d = ImageDraw.Draw(C); bar = round(1000 / om)
for k, (I, t) in enumerate(((N, 'NZ ' + nz.split('/')[-1].replace('.png', '') + ' (LINZ, CC BY 4.0)'), (B, 'before 1d7825d ' + label), (A, 'after braids ' + label))):
    x0 = k * (w + 8); C.paste(mid(I), (x0, 0))
    d.rectangle((x0 + 6, 6, x0 + 14 + d.textlength(t, font=font), 34), fill=(0, 0, 0)); d.text((x0 + 10, 8), t, fill=(255, 255, 255), font=font)
    d.rectangle((x0 + 10, h - 26, x0 + 10 + bar, h - 18), fill=(255, 255, 255), outline=(0, 0, 0)); d.text((x0 + 14 + bar, h - 34), '1 km', fill=(255, 255, 255), font=font)
C.save(out); print(out, C.size)
