#!/bin/bash
# try.sh TAG 'PARAMS-JSON' [SEED] [BOX]: build with the settings, export the box at 20 m, validate.py, gate numbers.
T=$1; P=${2:-{\}}; S=${3:-42}; B=${4:--44250,6250,30000}
cd /home/roger/github/fs-exp/foundation4
SLOPE_SEEDS=$S SLOPE_PARAMS="$P" SLOPE_BOX="$B" SLOPE_DIR=out/f4/data/seeded SLOPE_TAG=-$T timeout 900 npx vitest run --config scripts/probes/vitest.config.ts slopeTry --silent=false --disable-console-intercept 2>&1 | grep -E "seed|box|Error|error" | head -5
IFS=, read -r cn ce h <<< "$B"
cd out/f4 && ~/github/fs/out/landforms/.venv/bin/python tools/validate.py grid s$S-$T data/seeded/seed${S}_${cn}_${ce}-$T.f32 > data/validate-s$S-$T.log 2>&1
python3 tools/gate.py s$S-$T | tail -1
