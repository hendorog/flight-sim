#!/bin/bash
# shots.sh [LIST] : out/f3/views.txt (stage 2's views, stage 4's, stage 3's new ones) from this tree on port 5203 ->
# out/f3/shots/<name>-f3.png, with the f4s / f4 / f2 shot of the same view copied beside it where one exists.
F=/home/roger/github/fs-exp/foundation3; V=$F/out/f3; S=/home/roger/github/fs-exp/streams3/out/verify3/shot.mjs; L=${1:-$V/views.txt}
mkdir -p $V/shots
while read -r name q; do
  [ -z "$name" ] && continue
  for p in /home/roger/github/fs-exp/foundation4-steps/out/f4s/shots/$name-f4s.png /home/roger/github/fs-exp/foundation4/out/f4/shots/$name-f4.png; do [ -f $p ] && cp -n $p $V/shots/; done
  V2_ROOT=$F V2_PORT=5203 timeout 400 node $S "index.html?$q&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0" "$V/shots/$name-f3.png" --wait 7000 --timeout 240000 > "$V/shots/$name-f3.log" 2>&1
  echo "$name-f3 exit $? $(grep -c pageerror $V/shots/$name-f3.log) pageerrors"
done < $L
echo SHOTS-DONE
