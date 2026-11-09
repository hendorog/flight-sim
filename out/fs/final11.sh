#!/bin/bash
cd /home/roger/github/fs-exp/foundation-streams
export SHOT_PORT=5205
for v in v1-view owner-box face-close; do ./out/fs/shot.sh $PWD $v R; done
./out/fs/shot.sh $PWD/out/fs/pre owner-box pre
O=out/fs/final11
./out/fs/final.sh >/dev/null 2>&1
P="npx vitest run --config scripts/probes/vitest.config.ts"
DG_SEEDS=1,42,777777 timeout 3000 $P scripts/probes/drawnGate.test.ts --silent=false --disable-console-intercept 2>&1 | grep "^seed\|^   " > $O/drawnGate.log
RG_SEEDS=1,42,777777 RG_PATCHES=20 timeout 3000 $P scripts/probes/rillGate.test.ts --silent=false --disable-console-intercept 2>&1 | grep "^seed\|far end" > $O/rillGate.log
GN_SEEDS=1,42,777777 timeout 1500 $P scripts/probes/gullyNet.test.ts --silent=false --disable-console-intercept 2>&1 | grep "  sinks" > $O/ponds.log
LD_SEEDS=1,42,777777 LD_OUT=out/fs/lines-final11 timeout 900 $P scripts/probes/lineDump.test.ts > /dev/null 2>&1
python3 out/fs/tools2/moved.py out/fs/lines-f3 out/fs/lines-final11 > $O/moved.log
(cd out/fs && timeout 1800 ./validate.sh $PWD/final11 fs11 > final11/validate.log 2>&1)
timeout 5400 npx vitest run --no-file-parallelism tests/terrain tests/world tests/era tests/career > $O/suite.log 2>&1
timeout 2400 npx vitest run tests/career/landmarks.test.ts tests/career/system.test.ts tests/terrain/airfields.test.ts tests/terrain/seededWorld.test.ts tests/terrain/bedrock.test.ts tests/terrain/waterFlow.test.ts --testTimeout=120000 2>&1 | grep -E "Test Files|Tests  " > $O/suite-longtimeout.log
echo ALL-DONE
