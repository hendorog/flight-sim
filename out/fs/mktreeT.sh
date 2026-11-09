#!/bin/bash
# mktreeT.sh NAME [sed-expr-on-streams.ts]: a copy of the worktree's src as out/fs/trees/NAME (the rest linked to the
# HEAD copy out/fs/preT), for rendering a step's pictures, or an owner option with a constant switched, while work goes on.
D=/home/roger/github/fs-exp/foundation-streams; T=$D/out/fs/trees/$1; rm -rf $T; mkdir -p $T/scripts
for x in dev public tests index.html package.json package-lock.json tsconfig.json vite.config.ts node_modules; do ln -s $D/out/fs/preT/$x $T/$x; done
cp -r $D/src $T/src; cp -r $D/scripts/probes $T/scripts/probes
[ -n "$2" ] && sed -i "$2" $T/src/world/terrain/streams.ts
[ -n "$3" ] && sed -i "$3" $T/src/world/terrain/riverNetwork.ts
echo $T
