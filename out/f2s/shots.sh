#!/bin/bash
# shots.sh : render the gorge views from this tree on port 5199 -> out/f2s/shots/<name>-f2s.png (stage 2's own shots of
# the same views, from ~/github/fs-exp/foundation2/out/f2/shots, copied beside them as <name>-before.png).
F=/home/roger/github/fs-exp/foundation2-sealevel; V=$F/out/f2s; S=/home/roger/github/fs-exp/streams3/out/verify3/shot.mjs
grep -E "^(s777777-gorge|s1-gorge) " $F/out/f2/views.txt | while read -r name q; do
  cp -n /home/roger/github/fs-exp/foundation2/out/f2/shots/$name-f2.png $V/shots/$name-before.png
  V2_ROOT=$F V2_PORT=5199 timeout 400 node $S "index.html?$q&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0" "$V/shots/$name-f2s.png" --wait 7000 --timeout 240000 > "$V/shots/$name-f2s.log" 2>&1
  echo "$name-f2s exit $? $(grep -c pageerror $V/shots/$name-f2s.log) pageerrors"
done
echo SHOTS-DONE
