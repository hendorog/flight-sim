#!/bin/bash
# refpools.sh: poolMatch dumps of the archive trees (V0 af8c95c, A1 de23e20, C13 c130c47) into out/fs/B/pools-<tree>.
cd "$(dirname "$(readlink -f "$0")")/../../.."
for n in V0 A1 C13; do (cd out/fs/B/trees/$n && PM_SEEDS=1,42,777777,7 PM_OUT=$OLDPWD/out/fs/B/pools-$n timeout 1800 npx vitest run --config scripts/probes/vitest.config.ts scripts/probes/poolMatch.test.ts --silent=false --disable-console-intercept > $OLDPWD/out/fs/B/pools-$n.log 2>&1; echo "$n exit $?"); done
