#!/bin/bash
# phaseR.sh: phaseTimes alone, 3 runs each, interleaved: before (out/fs/trees/R0 = 3f9d795) and after (R3 = d2e6c40);
# seeds 42,1,777777 as gates.sh; the other vitest processes at each start logged. Into out/fs/R/phase.log.
L=/home/roger/github/fs-exp/foundation-streams/out/fs/R/phase.log; : > $L
T=/home/roger/github/fs-exp/foundation-streams/out/fs/trees
for r in 1 2 3; do
  for t in R0 R3; do
    n=$(pgrep -fc "node.*vitest" || true)
    echo "run $r $t: other vitest node processes before start: $n $(date +%T) load $(cut -d' ' -f1 /proc/loadavg)" >> $L
    (cd $T/$t && PH_SEEDS=42,1,777777 timeout 900 npx vitest run --config scripts/probes/vitest.config.ts scripts/probes/phaseTimes.test.ts --silent=false --disable-console-intercept 2>&1 | grep "^PHASES" | sed "s/^/$t r$r /") >> $L
  done
done
echo PHASE-DONE >> $L
