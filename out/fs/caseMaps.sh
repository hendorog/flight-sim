#!/bin/bash
# caseMaps.sh ROOT TAG: turnMap pictures (4 km, traced lines cyan, painted blue) about each named dead end of round S.
R=$1; T=$2; O=/home/roger/github/fs-exp/foundation-streams/out/fs/shots/cases; mkdir -p $O
cd $R
for c in 1:433:127750,156000 1:434:-131250,-147250 1:602:36250,41000 1:1265:25250,-98750 1:1414:-43000,-64500 42:450:110250,-29000 42:728:-138750,-118500 777777:789:-83250,-52750 777777:818:-16500,-9000; do
  IFS=: read s l at <<< "$c"
  TM_SEED=$s TM_AT=$at TM_PATCHES=2 TM_OUT=$O/s$s-$l-$T.png timeout 600 npx vitest run --config scripts/probes/vitest.config.ts turnMap > /dev/null 2>&1
  echo "$s $l $at done"
done
