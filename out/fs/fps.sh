#!/bin/bash
# fps.sh: frame time of the two cost views, f3 (out/fs/base) then fs, alternating, two rounds (port 5204).
V=/home/roger/github/fs-exp/foundation-streams/out/fs/views.txt
for round in 1 2; do for tree in base fs; do
  R=/home/roger/github/fs-exp/foundation-streams; [ $tree = base ] && R=$R/out/fs/base
  for v in cost-valley cost-massif; do
    Q=$(grep "^$v " $V | cut -d' ' -f2)
    echo "== round $round $tree $v"
    V2_PORT=5204 V2_ROOT=$R timeout 600 node /home/roger/github/fs-exp/streams3/out/verify3/shot.mjs "index.html?$Q&scenario=runway&tod=10&wx=clear&ui=0&cover=0&clock=0" /home/roger/github/fs-exp/foundation-streams/out/fs/shots/$v-$tree.png --wait 35000 --timeout 240000 --fps --frames 240 2>&1 | grep "fps\]\|gpu\]"
  done
done; done
