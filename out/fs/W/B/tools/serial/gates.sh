#!/bin/bash
# gates.sh ROOT OUTDIR : stage 3 gate probes (out/f4s/gates.sh) against the tree at ROOT, logs into OUTDIR.
# "base": the stage-2 copy (no slope probes; the boxes exported with heightExport).
R=$1; O=$2; B=$3; mkdir -p $O/tree $O/rivers
P="npx vitest run --config scripts/probes/vitest.config.ts"
cd $R
run() { local name=$1; shift; ( env "$@" timeout 3000 $P scripts/probes/$name.test.ts --silent=false --disable-console-intercept > $O/$name${TAG}.log 2>&1; echo "$name$TAG exit $?" ) ; }
BOXES='42:-44250,6250,30000;1:1000,109000,30000;777777:-13000,1000,30000'
TAG= run treeMeasure TREE_SEEDS=1,42,777777 TREE_OUT=$O/tree
TAG= run overGround STREAM_SEEDS=1,42,777777
TAG= run headFeed HF_SEEDS=1,42,777777
TAG= run lakeStats STREAM_SEEDS=1,42,777777
TAG= run lakeKinds LK_SEEDS=1,42,777777
TAG= run lakeKeep LKP_SEEDS=1,42,777777
TAG= run tarnCount STREAM_SEEDS=1,42,777777
TAG= run homeCheck HC_SEEDS=1,7,42,1234,99991,777777,2,5
TAG= run riverZero RZ_SEEDS=1,42,777777
TAG= run riverDump RD_SEEDS=1,42,777777 RD_OUT=$O/rivers
TAG= run coverShare CS_BOXES=$BOXES
TAG= run gradFloor GF_SEEDS=1,42,777777
TAG= run stepScan SC_SEEDS=1,42,777777
wait
TAG=-s1 run waterWalls SEED=1
TAG=-s42 run waterWalls SEED=42
TAG=-s777777 run waterWalls SEED=777777
TAG= run edgeScan EDGE_SEEDS=1,42,777777
if [ "$B" = base ]; then
  TAG=-s42 run heightExport EXPORT_SEEDS=42 EXPORT_N=-44250 EXPORT_E=6250 EXPORT_HALF=30000 EXPORT_STEP=20 EXPORT_DIR=$O
else
  TAG= run slopeStreams SS_SEEDS=1,42,777777
  TAG=-s42 run slopeTry SLOPE_SEEDS=42 SLOPE_BOX=-44250,6250,30000 SLOPE_DIR=$O
  TAG=-s1 run slopeTry SLOPE_SEEDS=1 SLOPE_BOX=1000,109000,30000 SLOPE_DIR=$O
  TAG=-s777777 run slopeTry SLOPE_SEEDS=777777 SLOPE_BOX=-13000,1000,30000 SLOPE_DIR=$O
fi
wait
TAG= run heightCost
TAG= run costMountain COST_REPS=5
wait
TAG= run phaseTimes PH_SEEDS=42,1,777777
TAG= run bankHeight BH_ALL=1 BH_SEEDS=1,42,777777
wait
echo GATES-DONE
