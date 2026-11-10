#!/bin/bash
# render.sh TREE OUTDIR VIEWSFILE [names...]: render each "name query" line of VIEWSFILE (or only the names given) in
# TREE on port 5281, one at a time, into OUTDIR/name.png, logging to OUTDIR/name.log. Re-renders once on a preload
# timeout or a vite 504.
TREE=$(readlink -f $1); OUT=$(readlink -f $2); VIEWS=$(readlink -f $3); shift 3
mkdir -p $OUT
while read -r name q; do
  [ -z "$name" ] && continue; case "$name" in \#*) continue;; esac
  if [ $# -gt 0 ] && ! printf '%s\n' "$@" | grep -qx "$name"; then continue; fi
  for try in 1 2; do
    V2_ROOT=$TREE V2_PORT=5281 timeout 400 node /home/roger/github/fs-exp/streams3/out/verify3/shot.mjs "index.html?$q&ui=0&resume=0&wx=clear" $OUT/$name.png --wait 9000 --timeout 180000 > $OUT/$name.log 2>&1
    if grep -q -E "preload timed out| 504" $OUT/$name.log || [ ! -s $OUT/$name.png ]; then echo "$name: retry ($try)"; continue; fi
    break
  done
  echo "$name: $(tail -1 $OUT/$name.log | cut -c1-120)"
done < $VIEWS
