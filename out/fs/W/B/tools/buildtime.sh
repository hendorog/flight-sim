#!/bin/bash
# buildtime.sh ROUNDS: the hydrology build per seed (joinTimes, seeds 1, 42, 777777), before (1d7825d) and after (the
# frozen battery tree) in turn, ROUNDS times; the load before each run is logged. The least per seed and tree is the
# quiet build time.
SP=/tmp/claude-1000/-home-roger-github-fs/35202c87-f21f-4b3f-b88c-6985c9c4283f/scratchpad
O=/home/roger/github/fs-exp/round-w-braid/out/fs/W/B/buildtime.log
for r in $(seq 1 ${1:-3}); do
  for t in before bat; do
    echo "round $r tree $t load $(cut -d' ' -f1-3 /proc/loadavg) $(date +%T)" >> $O
    (cd $SP/trees/$t && JT2_SEEDS=1,42,777777 timeout 900 npx vitest run --config scripts/probes/vitest.config.ts scripts/probes/joinTimes.test.ts --silent=false --disable-console-intercept 2>&1 | grep "^JT" | sed "s/^/$t /") >> $O
  done
done
echo BUILDTIME-DONE >> $O
