#!/bin/bash
# mktree.sh NAME COMMIT: src and scripts/probes of COMMIT as out/fs/trees/NAME (the rest linked to the worktree), for
# rendering a commit's pictures while work goes on (round T repairs).
D=/home/roger/github/fs-exp/foundation-streams; T=$D/out/fs/trees/$1; rm -rf $T; mkdir -p $T
for x in dev public tests index.html package.json package-lock.json tsconfig.json vite.config.ts node_modules; do ln -s $D/$x $T/$x; done
(cd $D && git archive $2 src scripts/probes | tar -x -C $T)
echo $T
