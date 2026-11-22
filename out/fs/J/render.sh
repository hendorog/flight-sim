#!/bin/bash
# render.sh TREE OUTDIR VIEWSFILE [names...]: render cameras from tree TREE (a path) into OUTDIR/<name>.png, one at a
# time, port 5280; skips a picture already there (delete it to re-render). Logs in A4p/logs.
D="$(dirname "$(readlink -f "$0")")"; R=$1; O=$2; V=$3; shift 3; P=5280; mkdir -p $O
names="$@"; [ -z "$names" ] && names=$(grep -v '^#' $V | cut -d' ' -f1)
for N in $names; do
  [ -s $O/$N.png ] && { echo "$N exists in $O"; continue; }
  Q=$(grep "^$N " $V | head -1 | cut -d' ' -f2)
  [ -z "$Q" ] && { echo "$N: no camera"; continue; }
  for try in 1 2; do
    if ss -ltn "sport = :$P" | grep -q LISTEN; then echo "$N: port $P busy, stopped"; exit 1; fi
    L=/home/roger/github/fs-exp/round-v/out/fs/J/logs/$N-$(basename $O).log
    V2_PORT=$P V2_ROOT=$R timeout 400 node /home/roger/github/fs-exp/streams3/out/verify3/shot.mjs "index.html?$Q&ui=0&resume=0&wx=clear" $O/$N.png --wait 9000 --timeout 180000 > $L 2>&1
    ex=$?; bad=$(( $(grep -c 'preload timed out' $L) + $(grep -c ' 504' $L) + $(grep -c 'never set window.__ready' $L) ))
    echo "$N $(basename $O) try$try exit $ex wrote=$(grep -c wrote $L) bad=$bad $(date +%T)"
    [ $bad -eq 0 ] && [ -s $O/$N.png ] && break
    rm -f $O/$N.png
  done
done
echo SHOTS-DONE
