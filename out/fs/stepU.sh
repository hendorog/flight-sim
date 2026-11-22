#!/bin/bash
# stepU.sh TAG: round T's checker fixes - stepT.sh's cheap gates, then wallsGate (SKIP_SCAN) per seed with group.py, the
# checker's heldOver (water over both banks in the airfields' reach) and line 720's profile, into out/fs/TAG.
cd /home/roger/github/fs-exp/foundation-streams
T=$1; O=$PWD/out/fs/$T; mkdir -p $O
P="npx vitest run --config scripts/probes/vitest.config.ts"
C="npx vitest run --config out/fs/verifyT1/code/probes/vitest.config.ts"
bash out/fs/stepT.sh $T > $O/step.out 2>&1
for s in 1 42 777777; do ( SEED=$s SKIP_SCAN=1 OUT=$O/walls-s$s.json timeout 1800 $P scripts/probes/wallsGate.test.ts --silent=false --disable-console-intercept > $O/wallsGate-s$s.log 2>&1 ) & done
( timeout 1800 $C out/fs/verifyT1/code/probes/heldOver.test.ts --silent=false --disable-console-intercept > $O/heldOver.log 2>&1 ) &
( S0=0 S1=4400 timeout 1800 $C out/fs/verifyT1/code/probes/line720.test.ts --silent=false --disable-console-intercept > $O/line720.log 2>&1 ) &
wait
python3 -I out/fs/tools2/group.py $O/walls-s1.json $O/walls-s42.json $O/walls-s777777.json > $O/group.txt 2>&1
echo STEPU-DONE
