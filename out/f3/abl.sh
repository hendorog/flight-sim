#!/bin/bash
# abl.sh TAG 'STRUCT_PARAMS json' : stepScan, riverZero and the seed-42 box (slopeTry + validate.py) for one structure variant -> out/f3/abl/TAG
T=$1; J=$2; R=/home/roger/github/fs-exp/foundation3; O=$R/out/f3/abl/$T; mkdir -p $O; cd $R
P="npx vitest run --config scripts/probes/vitest.config.ts"
export STRUCT_PARAMS="$J"
( SC_SEEDS=1,42,777777 timeout 3000 $P scripts/probes/stepScan.test.ts --silent=false --disable-console-intercept > $O/stepScan.log 2>&1 ) &
( RZ_SEEDS=1,42,777777 timeout 3000 $P scripts/probes/riverZero.test.ts --silent=false --disable-console-intercept > $O/riverZero.log 2>&1 ) &
( SLOPE_SEEDS=42 SLOPE_BOX=-44250,6250,30000 SLOPE_DIR=$O timeout 3000 $P scripts/probes/slopeTry.test.ts --silent=false --disable-console-intercept > $O/slopeTry.log 2>&1;
  cd out/f3 && ~/github/fs/out/landforms/.venv/bin/python tools/validate.py grid s42-$T $O/seed42_-44250_6250.f32 > $O/validate.log 2>&1 ) &
wait
cd $R/out/f3; echo "== $T $J"; grep -E "^seed [0-9]+: [0-9]+ lines" $O/riverZero.log; grep -oE "^seed [0-9]+: .*over 100 m [0-9]+" $O/stepScan.log | sed 's/samples; //'; python3 tools/gate.py s42-$T | tail -1
