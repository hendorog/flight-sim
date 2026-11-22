#!/bin/bash
# finalS.sh OUT [suite]: round S battery into out/fs/OUT (gates.sh, gully gates, drawnGate, rillGate, turns, ponds,
# f3 courses moved, seed boxes), then the suite when asked.
cd /home/roger/github/fs-exp/round-w-rs  # the tree this script lives in (out/fs/..)
T=$1; O=$PWD/out/fs/$T; mkdir -p $O
P="npx vitest run --config scripts/probes/vitest.config.ts"
bash out/fs/W/tools/serial/gates.sh $PWD $O > $O/gates.out 2>&1
GG_SEEDS=1,42,777777 GG_PATCHES=30 GG_SINKS=1 timeout 3000 $P scripts/probes/gullyGate.test.ts --silent=false --disable-console-intercept > $O/gullyGate.log 2>&1
GN_SEEDS=1,42,777777 timeout 3000 $P scripts/probes/gullyNet.test.ts --silent=false --disable-console-intercept > $O/gullyNet.log 2>&1
grep "  sinks" $O/gullyNet.log > $O/ponds.log
DG_SEEDS=1,42,777777 timeout 3000 $P scripts/probes/drawnGate.test.ts --silent=false --disable-console-intercept 2>&1 | grep "^seed\|^   " > $O/drawnGate.log
RG_SEEDS=1,42,777777 RG_PATCHES=20 timeout 3000 $P scripts/probes/rillGate.test.ts --silent=false --disable-console-intercept 2>&1 | grep "^seed\|far end" > $O/rillGate.log
for s in 1 42 777777; do TM_GATE=1 TM_SEED=$s timeout 900 $P scripts/probes/turnMap.test.ts --reporter=verbose --silent=false --disable-console-intercept 2>&1 | grep -E "^turnMap|^class" | sed "s/^/seed $s /"; done > $O/turnClass.log
ST_SEEDS=1,42,777777 timeout 900 $P scripts/probes/streamTurns.test.ts --reporter=verbose --silent=false --disable-console-intercept 2>&1 | grep -E "^seed|^   turn" > $O/streamTurns.log
LD_SEEDS=1,42,777777 LD_OUT=out/fs/lines-$T timeout 900 $P scripts/probes/lineDump.test.ts > /dev/null 2>&1
python3 out/fs/tools2/moved.py out/fs/lines-f3 out/fs/lines-$T > $O/moved.log
(cd out/fs && timeout 1800 ./validate.sh $O $T > $T/validate.log 2>&1)
echo BATTERY-DONE >> $O/gates.out
if [ "$2" = suite ]; then
  timeout 5400 npx vitest run --no-file-parallelism tests/terrain tests/world tests/era tests/career > $O/suite.log 2>&1
  timeout 2400 npx vitest run tests/career/landmarks.test.ts tests/career/system.test.ts tests/terrain/airfields.test.ts tests/terrain/seededWorld.test.ts tests/terrain/bedrock.test.ts tests/terrain/waterFlow.test.ts tests/terrain/steepWater.test.ts --testTimeout=120000 2>&1 | grep -E "Test Files|Tests  " > $O/suite-longtimeout.log
fi
echo ALL-DONE >> $O/gates.out
