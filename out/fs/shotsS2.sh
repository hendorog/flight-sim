#!/bin/bash
# shotsS2.sh TAG ROOT VIEWS...: views of out/fs/viewsS.txt as out/fs/shots/<view>-TAG.png from tree ROOT, port 5205.
T=$1; R=$2; shift 2
for v in "$@"; do SHOT_PORT=5205 WAIT=${WAIT:-30000} /home/roger/github/fs-exp/foundation-streams/out/fs/shot.sh $R $v $T /home/roger/github/fs-exp/foundation-streams/out/fs/viewsS.txt; done
