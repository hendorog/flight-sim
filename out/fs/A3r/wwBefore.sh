#!/bin/bash
# wwBefore.sh TREE TAG: the world-wide gates (worstN, beltOut, dryNear, fieldFaces, fieldBanks, heldOver) in an archive
# tree, logs into round-v's out/fs/A3r/ww-TAG.
T=$1; G=$HOME/github/fs-exp/round-v/out/fs/A3r/ww-$2; mkdir -p $G; cd $T
P="npx vitest run --config scripts/probes/vitest.config.ts"
for s in 1 42 777777; do ( WN_SEEDS=$s WN_OUT=$G/worstN-views-s$s timeout 3000 $P scripts/probes/worstN.test.ts --silent=false --disable-console-intercept > $G/worstN-s$s.log 2>&1 ) & done
( BO_SEEDS=1,42,777777 timeout 3000 $P scripts/probes/beltOut.test.ts --silent=false --disable-console-intercept > $G/beltOut.log 2>&1 ) &
wait
( DN_SEEDS=777777,42,1 timeout 1800 npx vitest run --config out/fs/R/probes/vitest.config.ts dryNear --silent=false --disable-console-intercept > $G/dryNear.log 2>&1 ) &
( timeout 1800 npx vitest run --config out/fs/R2/probes/vitest.config.ts fieldFaces --silent=false --disable-console-intercept > $G/fieldFaces.log 2>&1 ) &
( timeout 1800 npx vitest run --config out/fs/R2/probes/vitest.config.ts fieldBanks --silent=false --disable-console-intercept > $G/fieldBanks.log 2>&1 ) &
( timeout 1800 npx vitest run --config out/fs/verifyT1/code/probes/vitest.config.ts out/fs/verifyT1/code/probes/heldOver.test.ts --silent=false --disable-console-intercept > $G/heldOver.log 2>&1 ) &
wait
echo WW-DONE $2
