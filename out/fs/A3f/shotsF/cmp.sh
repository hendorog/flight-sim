#!/bin/bash
# cmp.sh VIEW: before (A3r f640d6e: the A3 checker's render, else the A3r implementer's, else A3's for the owner's views)
# | after (F: this fix), each 1600x900 at 50 %, side by side into cmp/VIEW.png; with A3 (09a3bf3) in the middle when
# A3/VIEW.png exists.
D="$(dirname "$(readlink -f "$0")")"; V=$1; B=/home/roger/github/fs-exp/round-v/out/fs
for f in $B/verifyA3/pictures/A/$V.png $B/shotsV/A3r/A3r/$V.png; do [ -s $f ] && { BEF=$f; TAG="A3r f640d6e"; break; }; done
[ -z "$BEF" ] && [ -s $B/shotsV/$V-A3.png ] && { BEF=$B/shotsV/$V-A3.png; TAG="A3 09a3bf3 (A3r same code path)"; }
lab() { magick "$1" -resize 50% -gravity north -fill white -undercolor '#000a' -pointsize 22 -annotate +0+6 "$2" "$3"; }
S=/tmp/claude-1000/-home-roger-github-fs/35202c87-f21f-4b3f-b88c-6985c9c4283f/scratchpad
lab $BEF "$TAG  $V" $S/c1.png
lab $D/F/$V.png "A3 fix  $V" $S/c3.png
if [ -s $D/A3/$V.png ]; then lab $D/A3/$V.png "A3 09a3bf3" $S/c2.png; magick $S/c1.png $S/c2.png $S/c3.png +append $D/cmp/$V.png; else magick $S/c1.png $S/c3.png +append $D/cmp/$V.png; fi
echo $D/cmp/$V.png
