#!/bin/bash
cd /home/roger/github/fs-exp/round-w-rs
for cfg in "30 1" "10 0" "5 0" "10 1"; do set -- $cfg; lw=$1; st=$2
  LW_LOWLAND=$lw LW_STEM=$st LL_DRYONLY=1 LL_SEEDS=1,42,777777 LL_TREE=low$lw-$st LL_OUT=$PWD/work/s/dry timeout 3000 npx vitest run --config scripts/probes/vitest.config.ts scripts/probes/lowLine.test.ts --silent=false --disable-console-intercept 2>&1 | grep -E "dry drawn|rror" > work/s/dry-$lw-$st.log
  RC_LOWLAND=$lw RC_STEM=$st RC_SEED=1,42,777777 timeout 3000 npx vitest run --config scripts/probes/vitest.config.ts scripts/probes/routeCost.test.ts --silent=false --disable-console-intercept 2>&1 | grep -E "^RC.*build" | sed 's/form {[^}]*}//' | cut -c1-260 >> work/s/dry-$lw-$st.log
  HF_STEM=$st HF_LOWLAND=$lw HF_SEEDS=1,42,777777 timeout 3000 npx vitest run --config scripts/probes/vitest.config.ts scripts/probes/headFeed.test.ts --silent=false --disable-console-intercept 2>&1 | grep -E "dry heads" | cut -c1-120 >> work/s/dry-$lw-$st.log
done
echo DRY-DONE
