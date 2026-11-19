#!/bin/bash
# quick.sh OUT: the gates that tell a stream rule's worth quickly, one probe at a time, seeds 1 / 42 / 777777.
cd /home/roger/github/fs-exp/round-w-rs
O=$1; mkdir -p $O
P="npx vitest run --config scripts/probes/vitest.config.ts"
run() { local name=$1 log=$2; shift 2; env "$@" timeout 3000 $P scripts/probes/$name.test.ts --silent=false --disable-console-intercept > $O/$log.log 2>&1; echo "$log exit $? $(date +%T) $(cut -d' ' -f1 /proc/loadavg)"; }
run routeCost routeCost RC_SEED=1,42,777777
run endsGate endsGate IG_SEEDS=1,42,777777,7 IG_MIN=10
run headFeed headFeed HF_SEEDS=1,42,777777
run feedCount feedCount FC_SEEDS=1,42,777777 FC_OUT=$O/feed
run lowLine lowLine LL_SEEDS=1,42,777777 LL_TREE=S LL_OUT=$O/lowline LL_ONEKIND=1
run selfCross selfCross SC_SEEDS=1,42,777777
run outletLoops outletLoops OL_SEEDS=1,42,777777,7
echo QUICK-DONE
