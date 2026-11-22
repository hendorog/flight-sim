#!/bin/bash
# Round V A4'+B join: the whole battery on this tree into out/fs/${1:-VJ} (finalS.sh with the suite, extrasR2.sh,
# probesV.sh, sum.sh), then B's probes (flat runs, pools by place, filled ponds, line sources, stream cost, gully
# valleys), A4's form probes (organicMap + section-7 tables, formStats, omBraid, floorWalk, netCheck, selfCross,
# formNaN), presentGuard on its own, and the join's timings.
cd /home/roger/github/fs-exp/round-v
T=${1:-VJ}; G=$PWD/out/fs/$T; J=$PWD/out/fs/J/$T; mkdir -p $G $J
git rev-parse HEAD > $J/commit.txt; git diff HEAD --stat -- src scripts tests >> $J/commit.txt
P="npx vitest run --config scripts/probes/vitest.config.ts"
bash out/fs/finalS.sh $T suite > $J/finalS.out 2>&1
bash out/fs/extrasR2.sh $T > $J/extras.out 2>&1
bash out/fs/probesV.sh $T > $J/probes.out 2>&1
bash out/fs/sum.sh $G > $J/sum.txt 2>&1
run() { local name=$1 log=$2; shift 2; ( env "$@" timeout 3000 $P scripts/probes/$name.test.ts --silent=false --disable-console-intercept > $J/$log.log 2>&1; echo "$log exit $?" ) & }
run flatRuns flatRuns FR_SEEDS=1,42,777777,7
run poolMatch poolMatch PM_SEEDS=1,42,777777,7 PM_OUT=$J/pools
run filledPonds filledPonds FP_SEEDS=1,42,777777,7
run lineSrc lineSrc LS="1:;42:;777777:;7:" LS_SUM=1
run streamCost streamCost SC_SEEDS=1,42,777777,7
run organicMap organicMap OM_SEEDS=1,42,777777 OM_OUT=$J/om
run formStats formStats FS2_SEEDS=1,42,777777
run floorWalk floorWalk FW_SEEDS=1,42,777777
run netCheck netCheck NC_SEEDS=1,7,42,1234,99991
run selfCross selfCross SC_SEEDS=1,7,42,1234,99991,777777
run formNaN formNaN FN_SEEDS=1,42,777777,7
run joinTimes joinTimes JT2_SEEDS=1,42,777777
run overLines overLines OL_SEEDS=1,42,777777 OL_TOP=40
wait
run omBraid omBraid OM_SEEDS=1,42,777777 OM_OUT=$J/om
run gullyValleys gullyValleys GV_SEEDS=1,42,777777 GV_FEED=$G/probes/feed
wait
timeout 900 npx vitest run tests/era/presentGuard.test.ts > $J/presentGuard.log 2>&1
for c in river stream chain; do
  CLS=$c python3 -I out/fs/A4p/tools/lawStats.py $J/om 1 42 777777 > $J/lawStats-$c.txt 2>&1
  CLS=$c python3 -I out/fs/A4p/tools/lawClass.py $J/om 1 42 777777 > $J/lawClass-$c.txt 2>&1
  CLS=$c python3 -I out/fs/A4p/tools/kinkwhere.py $J/om 1 42 777777 > $J/kinkwhere-$c.txt 2>&1
done
echo JOIN-BATTERY-DONE >> $J/finalS.out
