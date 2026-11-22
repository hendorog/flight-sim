#!/usr/bin/env python3
# nzsheet.py OUT NZ.png NZ_MPP OURS.png OURS_MPP [label]: an NZ plan (LINZ) beside one of ours at the same metres a pixel
# (the NZ picture resampled to ours), each cropped to the same ground window (the smaller of the two), labelled.
import sys
from PIL import Image, ImageDraw, ImageFont
out, nz, nzm, ours, om = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4], float(sys.argv[5])
label = sys.argv[6] if len(sys.argv) > 6 else ''
font = ImageFont.truetype('/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf', 24)
N = Image.open(nz).convert('RGB')
N = N.resize((round(N.width * nzm / om), round(N.height * nzm / om)), Image.LANCZOS)
O = Image.open(ours).convert('RGB')
w, h = min(N.width, O.width), min(N.height, O.height)
def mid(I):
    x, y = (I.width - w) // 2, (I.height - h) // 2
    return I.crop((x, y, x + w, y + h))
N, O = mid(N), mid(O)
C = Image.new('RGB', (2 * w + 8, h), (255, 255, 255))
C.paste(N, (0, 0)); C.paste(O, (w + 8, 0))
d = ImageDraw.Draw(C)
bar = round(1000 / om)
for x0, t in ((0, f'NZ (LINZ, CC BY 4.0) {nz.split("/")[-1]}'), (w + 8, f'ours {label}')):
    d.rectangle((x0 + 6, 6, x0 + 14 + d.textlength(t, font=font), 38), fill=(0, 0, 0))
    d.text((x0 + 10, 8), t, fill=(255, 255, 255), font=font)
    d.rectangle((x0 + 10, h - 30, x0 + 10 + bar, h - 22), fill=(255, 255, 255), outline=(0, 0, 0))
    d.text((x0 + 14 + bar, h - 40), '1 km', fill=(255, 255, 255), font=font)
C.save(out)
print(out, C.size, f'{om:.2f} m/px')
