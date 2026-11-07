#!/bin/bash
# gates.sh ROOT OUTDIR : run the stage-2 gate probes against the tree at ROOT, logs into OUTDIR (in parallel).
R=$1; O=$2; mkdir -p $O/tree
P="npx vitest run --config scripts/probes/vitest.config.ts"
cd $R
run() { local name=$1; shift; ( env "$@" timeout 3000 $P scripts/probes/$name.test.ts --silent=false --disable-console-intercept > $O/$name${TAG}.log 2>&1; echo "$name exit $?" ) & }
TAG= run treeMeasure TREE_SEEDS=1,42,777777 TREE_OUT=$O/tree
TAG= run plainsRegime PR_SEEDS=1,42,777777
TAG= run gradFloor GF_SEEDS=1,42,777777
TAG= run overGround STREAM_SEEDS=1,42,777777
TAG= run headFeed HF_SEEDS=1,42,777777
TAG= run lakeStats STREAM_SEEDS=1,42,777777
TAG= run lakeKinds LK_SEEDS=1,42,777777
TAG= run lakeKeep LKP_SEEDS=1,42,777777
TAG= run tarnCount STREAM_SEEDS=1,42,777777
TAG= run homeCheck HC_SEEDS=1,7,42,1234,99991,777777,2,5
wait
TAG=-s1 run waterWalls SEED=1
TAG=-s42 run waterWalls SEED=42
TAG=-s777777 run waterWalls SEED=777777
TAG= run edgeScan EDGE_SEEDS=1,42,777777
TAG= run heightExport EXPORT_SEEDS=42 EXPORT_N=-44250 EXPORT_E=6250 EXPORT_HALF=30000 EXPORT_STEP=20 EXPORT_DIR=$O
wait
echo GATES-DONE
