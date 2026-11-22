#!/bin/bash
# shotsT.sh ROOT TAG [names...]: render views of out/fs/viewsT.txt from tree ROOT as out/fs/shotsT/<name>-TAG.png
# (port 5222, the shot tool's own vite). With no names, every view. Each view's camera string is in viewsT.txt.
R=$1; T=$2; shift 2
D=/home/roger/github/fs-exp/foundation-streams/out/fs; mkdir -p $D/shotsT
names="$@"; [ -z "$names" ] && names=$(cut -d' ' -f1 $D/viewsT.txt)
for N in $names; do
  Q=$(grep "^$N " $D/viewsT.txt | cut -d' ' -f2)
  case "$Q" in *tod=*) X="";; *) X="&tod=10";; esac
  V2_PORT=5222 V2_ROOT=$R timeout 400 node /home/roger/github/fs-exp/streams3/out/verify3/shot.mjs "index.html?$Q$X&scenario=runway&wx=clear&ui=0&cover=0&clock=0&resume=0" $D/shotsT/$N-$T.png --wait ${WAIT:-9000} --timeout 180000 > $D/shotsT/$N-$T.log 2>&1
  echo "$N $? $(grep -c wrote $D/shotsT/$N-$T.log)"
done
echo SHOTS-DONE
