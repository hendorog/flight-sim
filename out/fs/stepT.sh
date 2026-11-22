#!/bin/bash
# stepT.sh TAG: round T's per-step checks into out/fs/TAG (the cheap gates the plan names per step; in parallel).
cd /home/roger/github/fs-exp/foundation-streams
T=$1; O=$PWD/out/fs/$T; mkdir -p $O
P="npx vitest run --config scripts/probes/vitest.config.ts"
run() { local name=$1; shift; ( env "$@" timeout 3000 $P scripts/probes/$name.test.ts --silent=false --disable-console-intercept > $O/$name${TAG}.log 2>&1; echo "$name$TAG exit $?" ) & }
TAG= run endsGate IG_SEEDS=1,42,777777,7 IG_MIN=10
TAG= run outletLoops OL_SEEDS=1,42,777777,7
TAG= run overGround STREAM_SEEDS=1,42,777777
TAG= run stepScan SC_SEEDS=1,42,777777
TAG= run homeCheck HC_SEEDS=1,7,42,1234,99991,777777,2,5
TAG= run riverZero RZ_SEEDS=1,42,777777
TAG= run lakeStats STREAM_SEEDS=1,42,777777
TAG= run headFeed HF_SEEDS=1,42,777777
TAG= run bankHeight BH_ALL=1 BH_SEEDS=1,42,777777
( DG_SEEDS=1,42,777777 timeout 3000 $P scripts/probes/drawnGate.test.ts --silent=false --disable-console-intercept 2>&1 | grep "^seed\|^   " > $O/drawnGate.log; echo drawnGate done ) &
( LD_SEEDS=1,42,777777 LD_OUT=out/fs/lines-$T timeout 1800 $P scripts/probes/lineDump.test.ts > /dev/null 2>&1; python3 -I out/fs/tools2/moved.py out/fs/lines-f3 out/fs/lines-$T > $O/moved.log; python3 -I out/fs/inv/ends/tools/movedwhy.py out/fs/lines-f3 out/fs/inv/ends/proto-runs/dump-base out/fs/lines-$T > $O/movedwhy.log 2>&1; python3 -I out/fs/inv/ends/tools/spot.py out/fs/lines-finalS8 out/fs/lines-$T 42 -15000 -10500 -44000 -39500 > $O/spot.log 2>&1; echo lines done ) &
( timeout 2400 npx vitest run tests/terrain/seededWorld.test.ts --testTimeout=120000 > $O/seededWorld.log 2>&1; echo seededWorld done ) &
( timeout 1200 npx vitest run tests/era/presentGuard.test.ts > $O/presentGuard.log 2>&1; echo presentGuard done ) &
wait
echo STEP-DONE
