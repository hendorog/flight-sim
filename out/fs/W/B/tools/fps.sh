#!/bin/bash
# fps.sh: frame time over a floor-filling braided bed (bp42-M1-low), before and after, one at a time on port 5321.
B=/home/roger/github/fs-exp/round-w-braid/out/fs/W/B; SP=/tmp/claude-1000/-home-roger-github-fs/35202c87-f21f-4b3f-b88c-6985c9c4283f/scratchpad
Q=$(grep "^bp42-M1-low " $B/views-close.txt | cut -d' ' -f2)
exec 9>$SP/shot5321.lock; flock 9
for T in before after; do
  echo "== $T load $(cut -d' ' -f1 /proc/loadavg)"
  V2_CACHE=$SP/vite-5321-$T V2_ROOT=$SP/trees/$T V2_PORT=5321 timeout 900 node /home/roger/github/fs-exp/round-v/out/fs/tools/shot.mjs "index.html?$Q&ui=0&resume=0&wx=clear" $B/pics/fps-$T.png --wait 9000 --timeout 300000 --fps --frames 240 2>&1 | grep -iE "frame|fps|ms|gpu" | head -8
done
