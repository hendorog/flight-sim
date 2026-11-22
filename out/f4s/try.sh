#!/bin/bash
# try.sh TAG [SEED] [BOX]: build this tree with SLOPE_PARAMS (env, JSON), export the box at 20 m, validate.py, gate numbers.
T=$1; S=${2:-42}; B=${3:--44250,6250,30000}
W=/home/roger/github/fs-exp/foundation4-steps
cd $W
SLOPE_SEEDS=$S SLOPE_PARAMS="${SLOPE_PARAMS:-{\}}" SLOPE_BOX="$B" SLOPE_DIR=out/f4s/data/seeded SLOPE_TAG=-$T timeout 900 npx vitest run --config scripts/probes/vitest.config.ts slopeTry --silent=false --disable-console-intercept 2>&1 | grep -E "seed|box|Error|error" | head -5
IFS=, read -r cn ce h <<< "$B"
cd out/f4s && ~/github/fs/out/landforms/.venv/bin/python tools/validate.py grid s$S-$T data/seeded/seed${S}_${cn}_${ce}-$T.f32 > data/validate-s$S-$T.log 2>&1
python3 tools/gate.py s$S-$T | tail -1
