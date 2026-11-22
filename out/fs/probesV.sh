#!/bin/bash
# probesV.sh TAG: Round V's probes (PLAN-V step 0: the ported design-V probes plus ruleFires and feedCount) against this
# tree, logs and dumps into out/fs/TAG/probes. Each takes one build per seed (5-10 s); the whole set about a minute.
cd "$(dirname "$(readlink -f "$0")")/../.."  # the tree this script lives in (out/fs/..)
O=out/fs/$1/probes; mkdir -p $O; P="npx vitest run --config scripts/probes/vitest.config.ts"
run() { local name=$1 log=$2; shift 2; ( env "$@" timeout 3000 $P scripts/probes/$name.test.ts --silent=false --disable-console-intercept > $O/$log.log 2>&1; echo "$log exit $?" ) & }
# The owner's valley, seed 42: chk-model-rivers' three cross-valley transects (tr-owner-B), and the third with its terms.
OWNER='-12000,-43000:-13500,-41500;-11300,-42400:-12700,-41000;-12700,-43400:-14000,-42100'
run routeAgree routeAgree RA_SEEDS=1,42,777777 RA_OUT=$O/routeAgree
run mapShelf mapShelf MS_SEEDS=1,42,777777
run formSites formSites FS_SEEDS=42,1 FS_OUT=$O/formSites
run mrTransect tr-owner TR_SEED=42 TR=$OWNER
run mrTransect trparts-owner TR_SEED=42 TR=-12700,-43400:-14000,-42100 TR_PARTS=1
run mrLakes mrLakes ML_SEEDS=1,42,777777 ML_OUT=$O/lakes
run mrForms mrForms MF_SEEDS=1,42,777777 MF_OUT=$O/forms
wait
run mrEdgeSites mrEdgeSites ES_SEEDS=42,1,777777
run onStreams onStreams ON_SEEDS=1,42,777777
run onRoute onRoute OR_SEED=42 OR_OUT=$O/route
run onSlope onSlope OS_SEED=42 OS_OUT=$O/slope
run chkPoolCut chkPoolCut CP_SEEDS=1,42,777777 CP_TOP=40
run ruleFires ruleFires RF_SEEDS=1,42,777777 RF_OUT=$O
run feedCount feedCount FC_SEEDS=1,42,777777 FC_OUT=$O/feed
wait
echo PROBES-DONE
