#!/bin/bash
# phaseU.sh: phaseTimes alone, 3 runs each, interleaved: base (64b3c61, code a26ee71), as handed in (1ac0dc9), final
# (09bd446); seeds 42,1,777777 as gates.sh; logs the other vitest processes running at each start. Into out/fs/UF/phase.
G=/home/roger/github/fs-exp/foundation-streams/out/fs/UF/phase
V=/home/roger/github/fs-exp/foundation-streams/out/fs/verifyT1/gates
L=$G/phase-alone.log; : > $L
for r in 1 2 3; do
  for t in $V/base $V/tree-final $G/tree-U; do
    n=$(pgrep -fc "node.*vitest" || true)
    echo "run $r $(basename $t): other vitest node processes before start: $n $(date +%T)" >> $L
    (cd $t && PH_SEEDS=42,1,777777 timeout 900 npx vitest run --config scripts/probes/vitest.config.ts scripts/probes/phaseTimes.test.ts --silent=false --disable-console-intercept 2>&1 | grep "^PHASES" | sed "s/^/$(basename $t) r$r /") >> $L
  done
done
echo PHASE-DONE >> $L
