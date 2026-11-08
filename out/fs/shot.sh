#!/bin/bash
# shot.sh ROOT NAME TAG [views file]: render one view of out/fs/views.txt from tree ROOT as out/fs/shots/NAME-TAG.png (port 5204).
R=$1; N=$2; T=$3; V=${4:-/home/roger/github/fs-exp/foundation-streams/out/fs/views.txt}
Q=$(grep "^$N " $V | cut -d' ' -f2)
mkdir -p /home/roger/github/fs-exp/foundation-streams/out/fs/shots
V2_PORT=${SHOT_PORT:-5204} V2_ROOT=$R timeout 600 node /home/roger/github/fs-exp/streams3/out/verify3/shot.mjs "index.html?$Q&scenario=runway&tod=10&wx=clear&ui=0&cover=0&clock=0" /home/roger/github/fs-exp/foundation-streams/out/fs/shots/$N-$T.png --wait ${WAIT:-30000} --timeout 240000 2>&1 | grep -i "wrote\|pageerror\|fps\]\|gpu\]"
