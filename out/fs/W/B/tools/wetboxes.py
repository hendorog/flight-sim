#!/usr/bin/env python3
# wetboxes.py BEFORE.bin AFTER.bin STEP: water area in the boxes before and after (km²), and the after water inside and
# outside the before's painted bed.
import sys, numpy as np
b = np.fromfile(sys.argv[1], dtype=np.uint8); a = np.fromfile(sys.argv[2], dtype=np.uint8); c = float(sys.argv[3]) ** 2 / 1e6
wb, bb, wa = (b & 1) > 0, (b & 2) > 0, (a & 1) > 0
print(f'water before {wb.sum() * c:.2f} km², after {wa.sum() * c:.2f} km² ({100 * (wa.sum() / max(1, wb.sum()) - 1):+.0f} %); after water inside the before bed {(wa & bb).sum() * c:.2f}, outside it {(wa & ~bb).sum() * c:.2f} km²; new water (dry before) {(wa & ~wb).sum() * c:.2f} km², of which outside the before bed {(wa & ~wb & ~bb).sum() * c:.2f} km²; water lost {(wb & ~wa).sum() * c:.2f} km²')
