#!/bin/bash
# shots.sh TAG TREE VIEWFILE [names...]: round T repairs renders from tree TREE into out/fs/R/pictures/<name>-TAG.png,
# port 5222 (the shot tool's own vite, started and stopped per shot, one at a time). Same query suffix as
# out/fs/verifyT2/pictures/shots.sh, so renders compare like-for-like with its -F (HEAD 3f9d795) and -T0 renders.
T=$1; R=$2; VF=$3; shift 3
O=/home/roger/github/fs-exp/foundation-streams/out/fs/R/pictures
names="$@"; [ -z "$names" ] && names=$(grep -v '^#' $VF | cut -d' ' -f1)
for N in $names; do
  Q=$(grep "^$N " $VF | cut -d' ' -f2)
  case "$Q" in *tod=*) X="";; *) X="&tod=10";; esac
  case "$Q" in *scenario=*) S="";; *) S="&scenario=runway";; esac
  V2_PORT=5222 V2_ROOT=$R timeout 400 node /home/roger/github/fs-exp/streams3/out/verify3/shot.mjs "index.html?$Q$X$S&wx=clear&ui=0&cover=0&clock=0&resume=0" $O/$N-$T.png --wait ${WAIT:-9000} --timeout 180000 > $O/$N-$T.log 2>&1
  echo "$N $? $(grep -c wrote $O/$N-$T.log)"
done
echo SHOTS-DONE
