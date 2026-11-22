#!/bin/bash
# battery.sh: Round W S's final battery on this worktree, every probe one at a time (the brief: the machine is shared),
# logs in out/fs/W/S/VW and out/fs/W/S/chk. The stage scripts are serial copies (out/fs/W/tools/serial).
cd /home/roger/github/fs-exp/round-w-rs
T=W/S/VW; G=$PWD/out/fs/$T; J=$PWD/out/fs/W/S/chk; mkdir -p $G $J
S=out/fs/W/tools/serial
P="npx vitest run --config scripts/probes/vitest.config.ts"
stamp() { echo "$1 $(date +%T) $(cut -d' ' -f1-3 /proc/loadavg)" >> $J/stages.txt; }
git log --oneline -1 > $J/head.txt
stamp start
# Quiet build time first (load stated): joinTimes, three seeds.
( JT2_SEEDS=1,42,777777 timeout 900 $P scripts/probes/joinTimes.test.ts --silent=false --disable-console-intercept > $J/joinTimes.log 2>&1; uptime >> $J/joinTimes.log )
stamp joinTimes
bash $S/finalS.sh $T suite > $J/finalS.out 2>&1
stamp finalS
bash $S/extrasR2.sh $T > $J/extras.out 2>&1
stamp extras
bash $S/probesV.sh $T > $J/probes.out 2>&1
bash out/fs/sum.sh $G > $J/sum.txt 2>&1
stamp probesV
run() { local name=$1 log=$2; shift 2; [ -f scripts/probes/$name.test.ts ] || { echo "$log missing"; return; }; env "$@" timeout 3000 $P scripts/probes/$name.test.ts --silent=false --disable-console-intercept > $J/$log.log 2>&1; echo "$log exit $?"; }
run flatRuns flatRuns FR_SEEDS=1,42,777777,7
run poolMatch poolMatch PM_SEEDS=1,42,777777,7 PM_OUT=$J/pools
run filledPonds filledPonds FP_SEEDS=1,42,777777,7
run organicMap organicMap OM_SEEDS=1,42,777777 OM_OUT=$J/om
run formStats formStats FS2_SEEDS=1,42,777777
run netCheck netCheck NC_SEEDS=1,7,42,1234,99991
run selfCross selfCross SC_SEEDS=1,7,42,1234,99991,777777
run formNaN formNaN FN_SEEDS=1,42,777777,7
run overLines overLines OL_SEEDS=1,42,777777 OL_TOP=40
run endsGate endsGate7 IG_SEEDS=7 IG_MIN=10
run chkPitch chkPitch CK_SEEDS=1,42,777777
run chkBanks chkBanks CK_SEEDS=1,42,777777
run chkWetArea chkWetArea CK_SEEDS=1,42,777777
run chkFields chkFields CK_SEEDS=1,42,777777,7
run widthWhy widthWhy WW_SEEDS=1,42,777777
run ruleFiresW ruleFiresW RW_SEEDS=1,42,777777
stamp chk
mkdir -p $J/lowline
( LL_SEEDS=1,42,777777 LL_TREE=S LL_OUT=$PWD/work/lowline/S timeout 3000 $P scripts/probes/lowLine.test.ts --silent=false --disable-console-intercept > $J/lowLine.log 2>&1 )
stamp lowLine
timeout 900 npx vitest run tests/era/presentGuard.test.ts > $J/presentGuard.log 2>&1
for c in river stream chain; do
  CLS=$c python3 -I out/fs/W/tools/lawStats.py $J/om 1 42 777777 > $J/lawStats-$c.txt 2>&1
done
AMIN=2000 python3 -I out/fs/W/tools/lawStats.py $J/om 1 42 777777 > $J/lawStats-trunk.txt 2>&1
stamp end
echo CHK-BATTERY-DONE >> $J/stages.txt
# Round W S additions: the build with the model handed over, the head rule's counts, sidebyside / parallel on the dump.
HB_SEEDS=1,42,777777 timeout 1800 $P scripts/probes/handedBuild.test.ts --silent=false --disable-console-intercept > $J/handedBuild.log 2>&1
RC_SEED=1,42,777777 timeout 1800 $P scripts/probes/routeCost.test.ts --silent=false --disable-console-intercept > $J/routeCost.log 2>&1
python3 -I /home/roger/github/fs-exp/round-v/out/fs/verifyA4p/gates/tools/sidebyside400.py $PWD/out/fs/lines-W/S/VW 1,42,777777 > $J/sidebyside400.txt 2>&1
python3 -I /home/roger/github/fs-exp/round-v/out/fs/tools2/parallel.py $PWD/out/fs/lines-W/S/VW 1,42,777777 > $J/parallel.txt 2>&1
stamp extra
echo S-BATTERY-DONE >> $J/stages.txt
