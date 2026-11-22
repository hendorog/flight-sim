#!/bin/bash
# shots.sh: the report's pictures (out/fs/shots/<view>-<f3|fs>.png), port 5204, one at a time.
cd /home/roger/github/fs-exp/foundation-streams
B=$PWD/out/fs/base
for v in s42-junction2 s42-junction2-hi s42-junction2-close s777777-junction3 s777777-junction3-hi s42-valley1 s777777-strike40; do
  ./out/fs/shot.sh $PWD $v fs; ./out/fs/shot.sh $B $v f3
done
for v in s42-path-A0.4 s42-path-A1.5 s42-path-A5 s42-path-A20 s42-path-A200 s42-path-A2000 s42-path-A1000000000 s777777-junction3-close; do ./out/fs/shot.sh $PWD $v fs; done
echo SHOTS-DONE
