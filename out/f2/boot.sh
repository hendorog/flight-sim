#!/bin/bash
# boot.sh ROUNDS : seed 42 runway boot time (second load, navigation to window.__ready) at 1x and 4x CPU throttle on
# port 5198: stage 2 with the cache (warm: the first load fills it) and without (cold: modelcache=0, the model worker),
# and stage 1 (cbaeee4, out/f2/s1) warm for comparison.
F=/home/roger/github/fs-exp/foundation2; V=$F/out/f2; S=/home/roger/github/fs-exp/streams3/out/verify3/shot.mjs
Q="index.html?seed=42&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0"
mkdir -p $V/logs
for r in $(seq ${2:-1} $1); do for thr in 1 4; do for t in s1 warm cold; do
  R=$F; q=$Q; [ $t = s1 ] && R=$V/s1; [ $t = cold ] && q="$Q&modelcache=0"
  E="--eval JSON.stringify(window.__terrainModel)"
  V2_ROOT=$R V2_PORT=5198 timeout 900 node $S "$q" $V/logs/boot.png --wait 300 --timeout 600000 --cpu-throttle $thr --boot $E > $V/logs/boot-$t-$thr-$r.log 2>&1
  echo "BOOT r$r x$thr $t $(grep '\[boot\]' $V/logs/boot-$t-$thr-$r.log) $(grep '\[eval\]' $V/logs/boot-$t-$thr-$r.log)"
done; done; done
echo BOOT-DONE
