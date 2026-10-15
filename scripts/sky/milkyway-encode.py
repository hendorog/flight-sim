#!/usr/bin/env python3
"""Encode the NASA SVS Milky Way map (linear float RGB) into the 8-bit file the sky dome samples, and report the
constants src/render/sky/glsl/milkyWay.ts needs.

    python3 -I scripts/sky/milkyway-encode.py <raw.f32> <width> <height> <out.webp|out.jpg> [quality]

<raw.f32>: the EXR as little-endian float32 RGB, top row first (scripts/sky/milkyway-build.sh makes it with
ImageMagick). The map is plate carree in J2000 RA/Dec, "centered at 0h right ascension, and r.a. increases to the
left" (SVS page 4851): column u = (c + 0.5) / W has RA = (0.5 - u) * 360 deg (mod 360), the top row is Dec +90.

Encoding (agent choice): v = sRGB_OETF(clamp(rgb / L_REF, 0, 1)) per channel, L_REF = the 99.99th percentile of
the map's luminance, so only single bright pixels clip and the bulge keeps its structure. The texture is loaded as
SRGBColorSpace, so the GPU decodes it (and filters its mipmaps) in linear light; the shader multiplies by L_REF.

Reported (computed on the DECODED 8-bit file, so they match what the shader sees):
    PEAK_2DEG   the maximum of the map's luminance smoothed with a 2 deg (sigma) Gaussian, linear map units,
                and where it is (row from top, column, RA/Dec by the convention above)
    MEAN        the map's mean luminance over the sphere (solid-angle weighted)
    POLE        the pole of the great circle best fitting the bright band (smallest-eigenvalue axis of the
                luminance-weighted scatter of directions brighter than the median), RA/Dec
    BAND/HIGH   mean luminance at |b| < 3 deg vs |b| > 30 deg, b from the EQ_TO_GAL matrix of milkyWay.ts
"""

import io
import math
import sys

import numpy as np
from PIL import Image

# J2000 equatorial -> galactic (Hipparcos; ESA 1997), rows = galactic x, y, z axes (the same numbers as the
# column-major mat3 in milkyWay.ts).
EQ_TO_GAL = np.array(
    [
        [-0.0548755604, -0.8734370902, -0.4838350155],
        [0.4941094279, -0.4448296300, 0.7469822445],
        [-0.8676661490, -0.1980763734, 0.4559837762],
    ]
)


def srgb_oetf(x):
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(np.maximum(x, 0.0031308), 1 / 2.4) - 0.055)


def srgb_eotf(v):
    return np.where(v <= 0.04045, v / 12.92, np.power((v + 0.055) / 1.055, 2.4))


def lum(rgb):
    return rgb @ np.array([0.2126, 0.7152, 0.0722])


def blur_sphere(img, sigma_deg):
    """Gaussian blur of an equirect map with sigma in degrees on the sky (rows: plain; columns: / cos dec)."""
    h, w = img.shape
    px = 180 / h
    s = sigma_deg / px
    k = np.arange(-int(4 * s) - 1, int(4 * s) + 2)
    g = np.exp(-0.5 * (k / s) ** 2)
    g /= g.sum()
    pad = len(k) // 2
    p = np.pad(img, ((pad, pad), (0, 0)), mode='edge')
    out = np.zeros_like(img)
    for i, gi in enumerate(g):
        out += gi * p[i : i + h]
    res = np.empty_like(out)
    for r in range(h):
        dec = 90 - (r + 0.5) * px
        sh = min(s / max(math.cos(math.radians(dec)), 0.02), w / 10)
        kk = np.arange(-int(4 * sh) - 1, int(4 * sh) + 2)
        gg = np.exp(-0.5 * (kk / sh) ** 2)
        gg /= gg.sum()
        f = np.fft.rfft(np.roll(np.pad(gg, (0, w - len(gg))), -(len(kk) // 2)))
        res[r] = np.fft.irfft(np.fft.rfft(out[r]) * f, w)
    return res


def directions(h, w):
    u = (np.arange(w) + 0.5) / w
    ra = np.radians(((0.5 - u) * 360) % 360)
    dec = np.radians(90 - (np.arange(h) + 0.5) / h * 180)
    ra, dec = np.meshgrid(ra, dec)
    return np.stack([np.cos(dec) * np.cos(ra), np.cos(dec) * np.sin(ra), np.sin(dec)], -1), dec


def main(raw, w, h, out, quality):
    a = np.fromfile(raw, dtype='<f4').reshape(h, w, 3).astype(np.float64)
    l_ref = float(np.percentile(lum(a), 99.99))
    enc = np.round(srgb_oetf(np.clip(a / l_ref, 0, 1)) * 255).astype(np.uint8)
    im = Image.fromarray(enc, 'RGB')
    buf = io.BytesIO()
    if out.endswith('.webp'):
        im.save(buf, 'WEBP', quality=quality, method=6)
    else:
        im.save(buf, 'JPEG', quality=quality, optimize=True, progressive=True, subsampling='4:2:0')
    with open(out, 'wb') as f:
        f.write(buf.getvalue())
    buf.seek(0)
    dec8 = np.asarray(Image.open(buf).convert('RGB')).astype(np.float64) / 255
    L = lum(srgb_eotf(dec8)) * l_ref

    # Work at 1024x512 (0.35 deg pixels) for the statistics.
    f = w // 1024
    Ls = L.reshape(h // f, f, w // f, f).mean(axis=(1, 3))
    hs, ws = Ls.shape
    dirs, dec = directions(hs, ws)
    weight = np.cos(dec)
    sm = blur_sphere(Ls, 2.0)
    r, c = np.unravel_index(np.argmax(sm), sm.shape)
    peak_u, peak_row = (c + 0.5) / ws, (r + 0.5) / hs
    peak_ra = ((0.5 - peak_u) * 360) % 360
    peak_dec = 90 - peak_row * 180
    mean = float((Ls * weight).sum() / weight.sum())

    bright = Ls > np.median(Ls)
    wv = (Ls * weight * bright)[..., None]
    d = dirs.reshape(-1, 3)
    m = (d * wv.reshape(-1, 1)).T @ d
    evals, evecs = np.linalg.eigh(m)
    pole = evecs[:, 0] * (1 if evecs[2, 0] > 0 else -1)
    pole_ra = math.degrees(math.atan2(pole[1], pole[0])) % 360
    pole_dec = math.degrees(math.asin(pole[2]))

    gal = dirs @ EQ_TO_GAL.T
    b = np.degrees(np.arcsin(np.clip(gal[..., 2], -1, 1)))
    band = float((Ls * weight)[np.abs(b) < 3].sum() / weight[np.abs(b) < 3].sum())
    high = float((Ls * weight)[np.abs(b) > 30].sum() / weight[np.abs(b) > 30].sum())

    print(f'wrote {out}: {w}x{h}, {len(buf.getvalue())} bytes, quality {quality}')
    print(f'L_REF = {l_ref:.6g}')
    print(f'PEAK_2DEG = {sm[r, c]:.6g} at row {peak_row:.6f} (from top), u {peak_u:.6f}: RA {peak_ra:.3f} Dec {peak_dec:.3f}')
    print(f'MEAN = {mean:.6g}')
    print(f'POLE RA {pole_ra:.3f} Dec {pole_dec:.3f}')
    print(f'BAND (|b|<3) = {band:.6g}, HIGH (|b|>30) = {high:.6g}, ratio {band / high:.2f}')


if __name__ == '__main__':
    if len(sys.argv) not in (5, 6):
        raise SystemExit(__doc__)
    main(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], int(sys.argv[5]) if len(sys.argv) == 6 else 80)
