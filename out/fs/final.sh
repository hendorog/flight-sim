#!/bin/bash
# final.sh: the gate battery, the gully gates, the hedge census, then the suite (logs in out/fs/final).
cd /home/roger/github/fs-exp/foundation-streams
O=$PWD/out/fs/final3
P="npx vitest run --config scripts/probes/vitest.config.ts"
bash out/fs/gates.sh $PWD $O > $O/gates.out 2>&1
GG_SEEDS=1,42,777777 GG_PATCHES=30 GG_SINKS=1 timeout 3000 $P scripts/probes/gullyGate.test.ts --silent=false --disable-console-intercept > $O/gullyGate.log 2>&1
GN_SEEDS=1,42,777777 timeout 3000 $P scripts/probes/gullyNet.test.ts --silent=false --disable-console-intercept > $O/gullyNet.log 2>&1

echo FINAL-DONE >> $O/gates.out
