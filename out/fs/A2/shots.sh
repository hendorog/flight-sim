#!/bin/bash
# A2/shots.sh ROOT TAG names...: render views (viewsV.txt, then A2/views.txt) from tree ROOT into out/fs/A2/shots/<name>-TAG.png,
# one at a time, port 5280 (the shot tool's own vite).
D="$(dirname "$(readlink -f "$0")")"; R=$1; T=$2; shift 2; mkdir -p $D/shots/logs
for N in "$@"; do
  Q=$(grep -h "^$N " $D/../viewsV.txt $D/views.txt | head -1 | cut -d' ' -f2)
  if ss -ltn "sport = :5280" | grep -q LISTEN; then echo "$N: port 5280 busy, stopped"; exit 1; fi
  L=$D/shots/logs/$N-$T.log
  V2_PORT=5280 V2_ROOT=$R timeout 400 node /home/roger/github/fs-exp/streams3/out/verify3/shot.mjs "index.html?$Q&ui=0&resume=0&wx=clear" $D/shots/$N-$T.png --wait 9000 --timeout 180000 > $L 2>&1
  echo "$N-$T exit $? wrote=$(grep -c wrote $L) preloadTO=$(grep -c 'preload timed out' $L) $(date +%T)"
done
