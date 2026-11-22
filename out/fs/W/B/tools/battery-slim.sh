#!/bin/bash
# battery-slim.sh TREE [JOBS]: the gates REQUIREMENTS.md and the braid brief ask for, and only those, JOBS (default 6) at
# a time on TREE (a git-archive copy of the commit under test, node_modules linked). Each probe is single-threaded and
# builds each seed's world itself (about 20 s a seed), so running them side by side cuts the wall time about fivefold;
# S's serial battery (battery.sh) also ran some 20 diagnostics no gate reads (slope tries, cost and height timings, tree
# measures, edge scans, validate.py, stream turns, moved lines, the Round V probes) and took 2 h 50 min; this is about
# 35-45 min, most of it the full suite. A log already present is not run again (a resumed run).
# Logs: TREE/out/fs/W/B/slim/<name>.log; the suite's in suite.log and suite-longtimeout.log.
T=$1; J=${2:-6}; cd "$T" || exit 1
O=$PWD/out/fs/W/B/slim; mkdir -p $O
P="npx vitest run --config scripts/probes/vitest.config.ts"
jobs() {
cat <<EOF
endsGate IG_SEEDS=1,42,777777,7 IG_MIN=10
outletLoops OL_SEEDS=1,42,777777,7
selfCross SC_SEEDS=1,7,42,1234,99991,777777
drawnGate DG_SEEDS=1,42,777777
chkWetArea CK_SEEDS=1,42,777777
lakeStats STREAM_SEEDS=1,42,777777
stepScan SC_SEEDS=1,42,777777
worstN:s1 WN_SEEDS=1 WN_OUT=$O/worstN-s1
worstN:s42 WN_SEEDS=42 WN_OUT=$O/worstN-s42
worstN:s777777 WN_SEEDS=777777 WN_OUT=$O/worstN-s777777
wallsGate:s1 SEED=1 SKIP_SCAN=1 OUT=$O/walls-s1.json
wallsGate:s42 SEED=42 SKIP_SCAN=1 OUT=$O/walls-s42.json
wallsGate:s777777 SEED=777777 SKIP_SCAN=1 OUT=$O/walls-s777777.json
headFeed HF_SEEDS=1,42,777777
feedCount FC_SEEDS=1,42,777777 FC_OUT=$O/feed
chkPitch CK_SEEDS=1,42,777777
chkBanks CK_SEEDS=1,42,777777
chkFields CK_SEEDS=1,42,777777,7
ruleFiresW RW_SEEDS=1,42,777777
lowLine LL_SEEDS=1,42,777777 LL_OUT=$O/lowline
braidStats BS2_SEEDS=1,42,777777,7 BS2_OUT=$O/stats
braidGpu BG_SEEDS=1,42,777777,7 BG_EVERY=5
EOF
}
run() {
  local key=$1; shift; local name=${key%%:*}; local log=$O/${key/:/-}.log
  [ -s "$log" ] && grep -q "Test Files" "$log" && return 0
  [ -f scripts/probes/$name.test.ts ] || { echo "$key missing" > "$log"; return 0; }
  env "$@" timeout 3000 $P scripts/probes/$name.test.ts --silent=false --disable-console-intercept > "$log" 2>&1
  echo "$key exit $? $(date +%T)" >> $O/stages.txt
}
export -f run; export O P
echo "start $(date +%T) jobs $J load $(cut -d' ' -f1 /proc/loadavg)" >> $O/stages.txt
# The suite (about 28 min, its own workers) beside the probes; the long-timeout tests after it.
( [ -s $O/suite.log ] || timeout 5400 npx vitest run --no-file-parallelism tests/terrain tests/world tests/era tests/career > $O/suite.log 2>&1
  [ -s $O/suite-longtimeout.log ] || timeout 2400 npx vitest run tests/career/landmarks.test.ts tests/career/system.test.ts tests/terrain/airfields.test.ts tests/terrain/seededWorld.test.ts tests/terrain/bedrock.test.ts tests/terrain/waterFlow.test.ts tests/terrain/steepWater.test.ts --testTimeout=120000 2>&1 | grep -E "Test Files|Tests  " > $O/suite-longtimeout.log
  timeout 900 npx vitest run tests/era/presentGuard.test.ts > $O/presentGuard.log 2>&1 ) &
jobs | xargs -P "$J" -L 1 bash -c 'run "$@"' _
wait
# Heldover, cycles, dry-near and field banks come from older probe sets with their own configs.
for x in "verifyT1/code heldOver" "verifyT1/code cycles" "R dryNear DN_SEEDS=777777,42,1" "R2 fieldBanks"; do
  set -- $x; d=$1; n=$2; shift 2
  [ -s $O/$n.log ] || env "$@" timeout 1800 npx vitest run --config out/fs/$d/probes/vitest.config.ts out/fs/$d/probes/$n.test.ts --silent=false --disable-console-intercept > $O/$n.log 2>&1 &
done
wait
python3 -I out/fs/tools2/group.py $O/walls-s1.json $O/walls-s42.json $O/walls-s777777.json > $O/group.txt 2>&1
echo "SLIM-DONE $(date +%T)" >> $O/stages.txt
