#!/usr/bin/env bash
# Build public/sky/stars/milkyway_4k.webp from NASA SVS "Deep Star Maps 2020" milkyway_2020_4k.exr (see
# public/sky/stars/SOURCE.md for the source, licence and checksums).
#
#   scripts/sky/milkyway-build.sh <milkyway_2020_4k.exr> [quality=85] [sigma=1.0]
#
# sigma: the pre-filter (texels on the sky; see milkyway-encode.py).
#
# ImageMagick 7 dumps the half-float EXR as linear float32 RGB (top row first, values 0..1, no gamma change:
# the dump's mean and maximum match three's EXRLoader); scripts/sky/milkyway-encode.py encodes it and prints the
# constants that src/render/sky/glsl/milkyWay.ts records. Run it from the repository root.
set -euo pipefail
SRC=$1
Q=${2:-85}
SIGMA=${3:-1.0}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
magick -version | head -1
python3 -I -c 'import numpy, PIL, sys; print("python", sys.version.split()[0], "numpy", numpy.__version__, "Pillow", PIL.__version__)'
read -r W H < <(magick identify -format '%w %h\n' "$SRC")
magick "$SRC" -depth 32 -define quantum:format=floating-point "rgb:$TMP/map.f32"
python3 -I "$ROOT/scripts/sky/milkyway-encode.py" "$TMP/map.f32" "$W" "$H" "$ROOT/public/sky/stars/milkyway_4k.webp" "$Q" "$SIGMA"
sha256sum "$SRC" "$ROOT/public/sky/stars/milkyway_4k.webp"
