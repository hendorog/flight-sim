#!/bin/bash
# shots3.sh: the report's fs pictures from the final code (port 5204), then frame times.
cd /home/roger/github/fs-exp/foundation-streams
for v in s42-handoff s777777-junction2 s777777-junction2-hi s777777-junction2-close s42-junction3 s42-junction3-hi s42-junction2-close s42-path-A0.4 s42-path-A1.5 s42-path-A5 s42-path-A10 s42-path-A20 s42-path-A200 s42-path-A2000 s42-path-A1000000000 s42-valley1 s777777-strike40; do ./out/fs/shot.sh $PWD $v fs; done
./out/fs/shot.sh $PWD/out/fs/base s42-path-A10 f3
for round in 1 2; do for v in cost-valley cost-massif; do Q=$(grep "^$v " out/fs/views.txt | cut -d' ' -f2); echo "== round $round fs-final $v"; V2_PORT=5204 V2_ROOT=$PWD timeout 600 node /home/roger/github/fs-exp/streams3/out/verify3/shot.mjs "index.html?$Q&scenario=runway&tod=10&wx=clear&ui=0&cover=0&clock=0" out/fs/shots/$v-fs.png --wait 35000 --timeout 240000 --fps --frames 240 2>&1 | grep "fps\]\|gpu\]"; done; done > out/fs/logs/fps-final.log
echo SHOTS-DONE
