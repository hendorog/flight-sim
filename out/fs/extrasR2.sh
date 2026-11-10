#!/bin/bash
# extrasR2.sh [OUT]: round T repairs 2 - extrasR.sh's gates (round T's standalone gates) into out/fs/OUT (default
# finalR2), after finalS.sh OUT suite; plus the junction gate (scripts/probes/junctionGate), the round's under-lake, dry-near and
# field-bank probes (out/fs/R and out/fs/R2 probes). Round V A3r: dryNear, fieldFaces, fieldBanks and heldOver measure every
# line of every kind at every generated field (the fields follow the terrain); worstN and beltOut are the world-wide gates.
cd "$(dirname "$(readlink -f "$0")")/../.."  # the tree this script lives in (out/fs/..)
G=$PWD/out/fs/${1:-finalR2}; mkdir -p $G
P="npx vitest run --config scripts/probes/vitest.config.ts"
C="npx vitest run --config out/fs/verifyT1/code/probes/vitest.config.ts"
R="npx vitest run --config out/fs/R/probes/vitest.config.ts"
R2="npx vitest run --config out/fs/R2/probes/vitest.config.ts"
run() { local name=$1 log=$2; shift 2; ( env "$@" timeout 3000 $P scripts/probes/$name.test.ts --silent=false --disable-console-intercept > $G/$log.log 2>&1; echo "$log exit $?" ) & }
run endsGate endsGate IG_SEEDS=1,42,777777,7 IG_MIN=10
run outletLoops outletLoops OL_SEEDS=1,42,777777,7
run cornerGate cornerGate JT_SEEDS=1,42,777777
run creaseGate creaseGate CG_SEEDS=1,42,777777
run paintedLoops paintedLoops JV_SEEDS=1,42,777777
run junctionGate junctionGate JN_SEEDS=1,42,777777,7,1234,99991
for s in 1 42 777777; do run wallsGate wallsGate-s$s SEED=$s SKIP_SCAN=1 OUT=$G/walls-s$s.json; done
# Round V A3r: the world-wide gates and their worst sites (no site named): worstN per seed, and the rivers' channels
# against their valleys' floors (beltOut).
for s in 1 42 777777; do run worstN worstN-s$s WN_SEEDS=$s WN_OUT=$G/worstN-views-s$s; done
run beltOut beltOut BO_SEEDS=1,42,777777
( timeout 1800 $C out/fs/verifyT1/code/probes/heldOver.test.ts --silent=false --disable-console-intercept > $G/heldOver.log 2>&1; echo "heldOver exit $?" ) &
( timeout 1800 $C out/fs/verifyT1/code/probes/cycles.test.ts --silent=false --disable-console-intercept > $G/cycles.log 2>&1; echo "cycles exit $?" ) &
wait
( UL_SEEDS=1,42,777777,7 timeout 1800 $R underLake --silent=false --disable-console-intercept > $G/underLake.log 2>&1; echo "underLake exit $?" ) &
( DN_SEEDS=777777,42,1 timeout 1800 $R dryNear --silent=false --disable-console-intercept > $G/dryNear.log 2>&1; echo "dryNear exit $?" ) &
( timeout 1800 $R2 fieldFaces --silent=false --disable-console-intercept > $G/fieldFaces.log 2>&1; echo "fieldFaces exit $?" ) &
( timeout 1800 $R2 fieldBanks --silent=false --disable-console-intercept > $G/fieldBanks.log 2>&1; echo "fieldBanks exit $?" ) &
wait
python3 -I out/fs/tools2/group.py $G/walls-s1.json $G/walls-s42.json $G/walls-s777777.json > $G/group.txt 2>&1
echo EXTRAS-DONE
