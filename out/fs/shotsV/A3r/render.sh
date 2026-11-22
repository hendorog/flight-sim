#!/bin/bash
# render.sh TAG(A1|A3r) VIEWS [names...]: render VIEWS cameras from the A1 archive tree or round-v into shotsV/A3r/TAG/<name>.png,
# one at a time, port 5280; skips a picture already there.
D="$(dirname "$(readlink -f "$0")")"; T=$1; V=$2; shift 2; P=5280
case $T in A1) R=$HOME/github/fs-exp/round-v/out/fs/verifyA1/pictures/trees/A;; A3r) R=$HOME/github/fs-exp/round-v;; esac
names="$@"; [ -z "$names" ] && names=$(grep -v '^#' $V | cut -d' ' -f1)
for N in $names; do
  [ -s $D/$T/$N.png ] && { echo "$N $T exists"; continue; }
  Q=$(grep "^$N " $V | head -1 | cut -d' ' -f2)
  [ -z "$Q" ] && { echo "$N: no camera"; continue; }
  if ss -ltn "sport = :$P" | grep -q LISTEN; then echo "$N: port $P busy, stopped"; exit 1; fi
  L=$D/logs/$N-$T.log
  V2_PORT=$P V2_ROOT=$R timeout 400 node /home/roger/github/fs-exp/streams3/out/verify3/shot.mjs "index.html?$Q&ui=0&resume=0&wx=clear" $D/$T/$N.png --wait 9000 --timeout 180000 > $L 2>&1
  echo "$N $T exit $? wrote=$(grep -c wrote $L) preloadTO=$(grep -c 'preload timed out' $L) $(date +%T)"
done
echo SHOTS-DONE
