#!/bin/bash
# shots.sh TAG TREE [names...]: round T repairs 2 renders from tree TREE into out/fs/R2/pictures/<name>-TAG.png, port 5222
# (the shot tool's own vite, started and stopped per shot, one at a time). Same query suffix as verifyR1 / R shots.sh.
# EVAL=js runs that in the page after ready (e.g. a terrain debug view).
T=$1; R=$2; shift 2
VF=/home/roger/github/fs-exp/foundation-streams/out/fs/R2/views.txt
O=/home/roger/github/fs-exp/foundation-streams/out/fs/R2/pictures
names="$@"; [ -z "$names" ] && names=$(grep -v '^#' $VF | cut -d' ' -f1)
for N in $names; do
  Q=$(grep "^$N " $VF | cut -d' ' -f2)
  case "$Q" in *tod=*) X="";; *) X="&tod=10";; esac
  case "$Q" in *scenario=*) S="";; *) S="&scenario=runway";; esac
  if [ -n "$EVAL" ]; then EA=(--eval "$EVAL"); else EA=(); fi
  V2_PORT=5222 V2_ROOT=$R timeout 400 node /home/roger/github/fs-exp/streams3/out/verify3/shot.mjs "index.html?$Q$X$S&wx=clear&ui=0&cover=0&clock=0&resume=0" $O/$N-$T.png --wait ${WAIT:-9000} --timeout 180000 "${EA[@]}" > $O/$N-$T.log 2>&1
  echo "$N $? $(grep -c wrote $O/$N-$T.log) $(grep -c 'preload timed out\|never set' $O/$N-$T.log)"
done
echo SHOTS-DONE
