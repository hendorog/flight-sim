#!/bin/bash
# shotsU.sh TREE TAG [names...]: render cameras of out/fs/viewsU.txt (the checker's B720 / 716 / fly cameras and round T's
# fixes' own) from tree TREE as out/fs/shotsU/<name>-TAG.png, port 5222 (the shot tool's own vite, per shot).
R=$1; T=$2; shift 2
D=/home/roger/github/fs-exp/foundation-streams/out/fs; mkdir -p $D/shotsU
names="$@"; [ -z "$names" ] && names=$(cut -d' ' -f1 $D/viewsU.txt)
for N in $names; do
  Q=$(grep "^$N " $D/viewsU.txt | cut -d' ' -f2)
  V2_PORT=5222 V2_ROOT=$R timeout 400 node /home/roger/github/fs-exp/streams3/out/verify3/shot.mjs "index.html?$Q&wx=clear&ui=0&cover=0&clock=0&resume=0" $D/shotsU/$N-$T.png --wait ${WAIT:-9000} --timeout 180000 > $D/shotsU/$N-$T.log 2>&1
  echo "$N $? $(grep -c wrote $D/shotsU/$N-$T.log)"
done
echo SHOTS-DONE
