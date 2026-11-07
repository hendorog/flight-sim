#!/bin/bash
# shots.sh TREE(before|after) : render views.txt from that tree on port 5197 -> out/f1/shots/<name>-<tree>.png
F=/home/roger/github/fs-exp/foundation; V=$F/out/f1; S=/home/roger/github/fs-exp/streams3/out/verify3/shot.mjs
case $1 in before) R=$V/base;; after) R=$F;; esac
while read -r name q; do
  [ -z "$name" ] && continue
  V2_ROOT=$R V2_PORT=5197 timeout 400 node $S "index.html?$q&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0" "$V/shots/$name-$1.png" --wait 7000 --timeout 240000 > "$V/shots/$name-$1.log" 2>&1
  echo "$name-$1 exit $? $(grep -c pageerror $V/shots/$name-$1.log) pageerrors"
done < ${VIEWS:-$V/views.txt}
