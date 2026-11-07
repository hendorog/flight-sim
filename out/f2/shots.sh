#!/bin/bash
# shots.sh : render views.txt from the stage-2 tree on port 5198 -> out/f2/shots/<name>-f2.png (stage 1's before/after
# pictures copied beside them from ~/github/fs-exp/foundation/out/f1/shots).
F=/home/roger/github/fs-exp/foundation2; V=$F/out/f2; S=/home/roger/github/fs-exp/streams3/out/verify3/shot.mjs
while read -r name q; do
  [ -z "$name" ] && continue
  V2_ROOT=$F V2_PORT=5198 timeout 400 node $S "index.html?$q&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0" "$V/shots/$name-f2.png" --wait 7000 --timeout 240000 > "$V/shots/$name-f2.log" 2>&1
  echo "$name-f2 exit $? $(grep -c pageerror $V/shots/$name-f2.log) pageerrors"
done < ${VIEWS:-$V/views.txt}
echo SHOTS-DONE
