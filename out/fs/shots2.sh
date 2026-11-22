#!/bin/bash
# shots2.sh: the report's pictures from the final code (fs) and f3 (out/fs/base), port 5204, one at a time.
cd /home/roger/github/fs-exp/foundation-streams
B=$PWD/out/fs/base
for v in s777777-junction2 s777777-junction2-hi s42-junction3 s42-junction3-hi s42-valley1 s777777-strike40; do
  ./out/fs/shot.sh $PWD $v fs; [ -s out/fs/shots/$v-f3.png ] && [ $v != s42-valley1 ] || ./out/fs/shot.sh $B $v f3
done
for v in s777777-junction2-close s42-junction2-close s42-path-A0.4 s42-path-A1.5 s42-path-A5 s42-path-A20 s42-path-A200 s42-path-A2000 s42-path-A1000000000; do ./out/fs/shot.sh $PWD $v fs; done
echo SHOTS-DONE
