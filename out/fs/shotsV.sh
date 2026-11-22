#!/bin/bash
# shotsV.sh TAG [names...]: Round V pictures - viewsV.txt (cameras from design-V/model-rivers, one-network and
# chk-one-network views.txt) rendered from this tree into out/fs/shotsV/<name>-TAG.png, one at a time, with the shot
# tool's own vite on port 5280 (PORT to override; never 5173-5178, 5202-5205, 5222-5250, 5260-5272).
D="$(dirname "$(readlink -f "$0")")"; R="$(cd "$D/../.." && pwd)"; T=$1; shift
P=${PORT:-5280}; mkdir -p $D/shotsV/logs
names="$@"; [ -z "$names" ] && names=$(cut -d' ' -f1 $D/viewsV.txt)
for N in $names; do
  Q=$(grep "^$N " $D/viewsV.txt | cut -d' ' -f2)
  if ss -ltn "sport = :$P" | grep -q LISTEN; then echo "$N: port $P busy, stopped"; exit 1; fi
  L=$D/shotsV/logs/$N-$T.log
  V2_PORT=$P V2_ROOT=$R timeout 400 node /home/roger/github/fs-exp/streams3/out/verify3/shot.mjs "index.html?$Q&ui=0&resume=0&wx=clear" $D/shotsV/$N-$T.png --wait ${WAIT:-9000} --timeout 180000 > $L 2>&1
  echo "$N exit $? wrote=$(grep -c wrote $L) preloadTO=$(grep -c 'preload timed out' $L) $(date +%T)"
done
echo SHOTS-DONE
