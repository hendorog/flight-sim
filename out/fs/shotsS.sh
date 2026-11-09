#!/bin/bash
# shotsS.sh TAG [ROOT]: the owner's three seed-42 views (out/fs/viewsS.txt) as out/fs/shots/<view>-TAG.png, port 5205.
T=$1; R=${2:-/home/roger/github/fs-exp/foundation-streams}
for v in floor wind face; do SHOT_PORT=5205 WAIT=${WAIT:-30000} /home/roger/github/fs-exp/foundation-streams/out/fs/shot.sh $R $v $T /home/roger/github/fs-exp/foundation-streams/out/fs/viewsS.txt; done
