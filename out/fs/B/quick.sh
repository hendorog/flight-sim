#!/bin/bash
# quick.sh TAG: Round V B's quick gates for a step (ends, loops, cycles, under-lake, junctions, over-ground, flat runs,
# pools by place) into out/fs/B/TAG. Run from anywhere; works in the tree it lives in.
cd "$(dirname "$(readlink -f "$0")")/../../.."
G=$PWD/out/fs/B/$1; mkdir -p $G
P="npx vitest run --config scripts/probes/vitest.config.ts"
C="npx vitest run --config out/fs/verifyT1/code/probes/vitest.config.ts"
R="npx vitest run --config out/fs/R/probes/vitest.config.ts"
run() { local name=$1 log=$2; shift 2; ( env "$@" timeout 3000 $P scripts/probes/$name.test.ts --silent=false --disable-console-intercept > $G/$log.log 2>&1; echo "$log exit $?" ) & }
run endsGate endsGate IG_SEEDS=1,42,777777,7 IG_MIN=10
run outletLoops outletLoops OL_SEEDS=1,42,777777,7
run junctionGate junctionGate JN_SEEDS=1,42,777777,7,1234,99991
wait
run overGround overGround STREAM_SEEDS=1,42,777777
run flatRuns flatRuns FR_SEEDS=1,42,777777,7
( timeout 1800 $C out/fs/verifyT1/code/probes/cycles.test.ts --silent=false --disable-console-intercept > $G/cycles.log 2>&1; echo "cycles exit $?" ) &
wait
( UL_SEEDS=1,42,777777,7 timeout 1800 $R underLake --silent=false --disable-console-intercept > $G/underLake.log 2>&1; echo "underLake exit $?" ) &
run poolMatch poolMatch PM_SEEDS=1,42,777777,7 PM_OUT=$G/pools
wait
echo QUICK-DONE
