#!/bin/bash
# extrasR.sh: round T repairs - extrasU.sh (round T's standalone gates) into out/fs/finalR, after finalS.sh finalR suite.
cd /home/roger/github/fs-exp/foundation-streams
G=$PWD/out/fs/finalR
P="npx vitest run --config scripts/probes/vitest.config.ts"
C="npx vitest run --config out/fs/verifyT1/code/probes/vitest.config.ts"
run() { local name=$1 log=$2; shift 2; ( env "$@" timeout 3000 $P scripts/probes/$name.test.ts --silent=false --disable-console-intercept > $G/$log.log 2>&1; echo "$log exit $?" ) & }
run endsGate endsGate IG_SEEDS=1,42,777777,7 IG_MIN=10
run outletLoops outletLoops OL_SEEDS=1,42,777777,7
run cornerGate cornerGate JT_SEEDS=1,42,777777
run creaseGate creaseGate CG_SEEDS=1,42,777777
run paintedLoops paintedLoops JV_SEEDS=1,42,777777
for s in 1 42 777777; do run wallsGate wallsGate-s$s SEED=$s SKIP_SCAN=1 OUT=$G/walls-s$s.json; done
( timeout 1800 $C out/fs/verifyT1/code/probes/heldOver.test.ts --silent=false --disable-console-intercept > $G/heldOver.log 2>&1; echo "heldOver exit $?" ) &
( timeout 1800 $C out/fs/verifyT1/code/probes/cycles.test.ts --silent=false --disable-console-intercept > $G/cycles.log 2>&1; echo "cycles exit $?" ) &
wait
python3 -I out/fs/tools2/group.py $G/walls-s1.json $G/walls-s42.json $G/walls-s777777.json > $G/group.txt 2>&1
echo EXTRAS-DONE
