#!/bin/bash
# boot.sh ROUNDS : seed 42 runway boot time (second load, navigation to window.__ready) at 1x and 4x CPU throttle on
# port 5203: stage 3 and stage 4s (c6eafff, out/f3/base-src), warm (the cache the first load fills) and cold
# (modelcache=0: the model worker).
F=/home/roger/github/fs-exp/foundation3; V=$F/out/f3; S=/home/roger/github/fs-exp/streams3/out/verify3/shot.mjs
Q="index.html?seed=42&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0"
mkdir -p $V/logs
for r in $(seq ${2:-1} $1); do for thr in 1 4; do for t in base-warm f3-warm base-cold f3-cold; do
  R=$F; q=$Q; case $t in base-*) R=$V/base-src;; esac; case $t in *-cold) q="$Q&modelcache=0";; esac
  E="--eval JSON.stringify(window.__terrainModel)"
  V2_ROOT=$R V2_PORT=5203 timeout 900 node $S "$q" $V/logs/boot.png --wait 300 --timeout 600000 --cpu-throttle $thr --boot $E > $V/logs/boot-$t-$thr-$r.log 2>&1
  echo "BOOT r$r x$thr $t $(grep '\[boot\]' $V/logs/boot-$t-$thr-$r.log) $(grep '\[eval\]' $V/logs/boot-$t-$thr-$r.log)"
done; done; done
echo BOOT-DONE
