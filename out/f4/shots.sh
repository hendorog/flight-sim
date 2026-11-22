#!/bin/bash
# shots.sh : render stage 2's views (out/f2/views.txt) and the stage-4 views (out/f4/views4.txt) from this tree on port
# 5200 -> out/f4/shots/<name>-f4.png; stage 2's own shots copied beside them (<name>-f2.png from
# ~/github/fs-exp/foundation2/out/f2/shots, the gorge views' <name>-f2s.png from the sea-level fix), and the new views
# rendered from the stage-2 copy (out/f4/base-src, e9997ef) as <name>-f2s.png.
F=/home/roger/github/fs-exp/foundation4; V=$F/out/f4; S=/home/roger/github/fs-exp/streams3/out/verify3/shot.mjs
mkdir -p $V/shots
shot() { # root name query tag
  V2_ROOT=$1 V2_PORT=5200 timeout 400 node $S "index.html?$3&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0" "$V/shots/$2-$4.png" --wait 7000 --timeout 240000 > "$V/shots/$2-$4.log" 2>&1
  echo "$2-$4 exit $? $(grep -c pageerror $V/shots/$2-$4.log) pageerrors"
}
while read -r name q; do
  [ -z "$name" ] && continue
  cp -n /home/roger/github/fs-exp/foundation2/out/f2/shots/$name-f2.png $V/shots/ 2>/dev/null
  cp -n /home/roger/github/fs-exp/foundation2-sealevel/out/f2s/shots/$name-f2s.png $V/shots/ 2>/dev/null
  shot $F $name "$q" f4
done < $V/../f2/views.txt
while read -r name q; do
  [ -z "$name" ] && continue
  shot $F $name "$q" f4
  shot $V/base-src $name "$q" f2s
done < $V/views4.txt
echo SHOTS-DONE
