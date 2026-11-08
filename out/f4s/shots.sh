#!/bin/bash
# shots.sh : the four valley views and s42-massif (out/f4/views4.txt) from this tree on port 5201 -> out/f4s/shots/<name>-f4s.png,
# with stage 4's own <name>-f4.png copied beside them.
F=/home/roger/github/fs-exp/foundation4-steps; V=$F/out/f4s; S=/home/roger/github/fs-exp/streams3/out/verify3/shot.mjs
mkdir -p $V/shots
while read -r name q; do
  [ -z "$name" ] && continue
  cp -n /home/roger/github/fs-exp/foundation4/out/f4/shots/$name-f4.png $V/shots/ 2>/dev/null
  V2_ROOT=$F V2_PORT=5201 timeout 400 node $S "index.html?$q&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0" "$V/shots/$name-f4s.png" --wait 7000 --timeout 240000 > "$V/shots/$name-f4s.log" 2>&1
  echo "$name-f4s exit $? $(grep -c pageerror $V/shots/$name-f4s.log) pageerrors"
done < $F/out/f4/views4.txt
echo SHOTS-DONE
