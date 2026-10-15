#!/usr/bin/env python3
"""Build public/sky/stars/bsc5.bin from the Yale Bright Star Catalogue, 5th revised edition (CDS V/50).

    python3 -I scripts/sky/stars-build.py <catalog.gz> <out.bin>

Input: https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz (see public/sky/stars/SOURCE.md). Byte positions follow
the catalogue's ReadMe (1-based, inclusive): RA J2000 h/m/s 76-77/78-79/80-83, Dec sign/d/m/s 84/85-86/87-88/89-90,
Vmag 103-107, B-V 110-114.

Output (little endian), read by src/render/sky/starCatalog.ts:
    header  16 bytes: magic 'BSC5', uint32 version (1), uint32 record count (9110), uint32 epoch year (2000)
    record  12 bytes per HR number 1..N, in HR order:
            float32 RA (rad, J2000), float32 Dec (rad, J2000), int16 round(Vmag*100), int16 round((B-V)*1000)
    The 14 HR numbers without data (novae and extragalactic objects kept for the numbering) carry Vmag = 32767;
    a missing B-V is 32767.
Positions are the catalogue's J2000 positions at epoch 2000; proper motion to the sky's 2016 epoch is skipped
(< 0.05 deg over 16 years even for the fastest stars here).
"""

import gzip
import math
import struct
import sys

MISSING = 32767


def field(line: str, a: int, b: int) -> str:
    """Bytes a..b of the ReadMe (1-based, inclusive)."""
    return line[a - 1 : b]


def main(src: str, out: str) -> None:
    with gzip.open(src, 'rt', encoding='ascii') as f:
        lines = [l.rstrip('\n').ljust(197) for l in f]
    records = []
    valid = 0
    for n, line in enumerate(lines, start=1):
        hr = int(field(line, 1, 4))
        if hr != n:
            raise SystemExit(f'HR {hr} out of order at line {n}')
        ra_h = field(line, 76, 77).strip()
        vmag = field(line, 103, 107).strip()
        if not ra_h or not vmag:
            records.append(struct.pack('<ffhh', 0.0, 0.0, MISSING, MISSING))
            continue
        ra = (int(ra_h) + int(field(line, 78, 79)) / 60 + float(field(line, 80, 83)) / 3600) * 15
        dec = int(field(line, 85, 86)) + int(field(line, 87, 88)) / 60 + int(field(line, 89, 90)) / 3600
        if field(line, 84, 84) == '-':
            dec = -dec
        bv = field(line, 110, 114).strip()
        records.append(
            struct.pack(
                '<ffhh',
                math.radians(ra),
                math.radians(dec),
                round(float(vmag) * 100),
                round(float(bv) * 1000) if bv else MISSING,
            )
        )
        valid += 1
    with open(out, 'wb') as f:
        f.write(b'BSC5' + struct.pack('<III', 1, len(records), 2000))
        f.write(b''.join(records))
    print(f'{len(records)} records, {valid} stars -> {out}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
