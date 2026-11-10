#!/bin/bash
# a2.sh STAGE [variants]: Round V A2 (PLAN-V A2) - scripts/probes/a2Attrib.test.ts per build variant into out/fs/A2/<v>.
#   tr: the six band sites' transects and the owner's three cross-valley transects (seed 42), and the owner box at 25 m;
#   box: the three 60 km landform boxes at 20 m (seed 42's with the corner-lowered cells and core-taper nodes dumped).
cd "$(dirname "$(readlink -f "$0")")/../.."  # the tree this script lives in (out/fs/..)
S=$1; shift; VS="${@:-a b c c2 d e f}"
P="npx vitest run --config scripts/probes/vitest.config.ts"
SITES='windL=-13157,-39823:-11271,-41926;windR=-11050,-42365:-12943,-40236;floor=-14376,-40820:-12803,-42719;V141=-22339,-26000:-20627,-27733;ext1=-8553,-39900:-10300,-38136;ext2=-13980,-44563:-15155,-42384'
OWNER='own1=-12000,-43000:-13500,-41500;own2=-11300,-42400:-12700,-41000;own3=-12700,-43400:-14000,-42100'
run() { local log=$1; shift; ( env "$@" timeout 3000 $P scripts/probes/a2Attrib.test.ts --silent=false --disable-console-intercept > $log 2>&1; echo "$log exit $?" ) & }
for v in $VS; do
  O=out/fs/A2/$v; mkdir -p $O
  if [ $S = tr ]; then run $O/tr.log A2_VAR=$v A2_SEED=42 A2_TR="$SITES;$OWNER" A2_OUT=$O A2_BOX=-12200,-41300,3000; fi
  if [ $S = box ]; then
    run $O/box-s42.log A2_VAR=$v A2_SEED=42 A2_OUT=$O A2_EXPORT=-44250,6250,30000 A2_DUMP=1
    run $O/box-s1.log A2_VAR=$v A2_SEED=1 A2_OUT=$O A2_EXPORT=1000,109000,30000
    run $O/box-s777777.log A2_VAR=$v A2_SEED=777777 A2_OUT=$O A2_EXPORT=-13000,1000,30000
  fi
done
wait
echo A2-$S-DONE
