#!/bin/bash
# shot.sh TREE NAME QUERY: one render on port 5321 of tree TREE (before|after|<dir under the scratchpad trees>) into
# out/fs/W/B/pics/TREE/NAME.png, its log beside it; retried up to three times on a preload timeout, a vite 504 or a page
# never ready (such a render is not picture evidence). One render at a time: waits while another holds the lock.
B=/home/roger/github/fs-exp/round-w-braid/out/fs/W/B; SP=/tmp/claude-1000/-home-roger-github-fs/35202c87-f21f-4b3f-b88c-6985c9c4283f/scratchpad
T=$1; N=$2; Q=$3; O=$B/pics/$T; mkdir -p $O
exec 9>$SP/shot5321.lock; flock 9
for try in 1 2 3; do
  while [ $(awk '{print int($1)}' /proc/loadavg) -gt 20 ]; do sleep 20; done
  if ss -ltn "sport = :5321" | grep -q LISTEN; then echo "$N $T: port 5321 busy, stopped"; exit 1; fi
  l0=$(cut -d' ' -f1 /proc/loadavg); t0=$(date +%s)
  V2_CACHE=$SP/vite-5321-$T V2_ROOT=$SP/trees/$T V2_PORT=5321 timeout 600 node /home/roger/github/fs-exp/round-v/out/fs/tools/shot.mjs "index.html?$Q&ui=0&resume=0&wx=clear" $O/$N.png --wait 9000 --timeout 300000 > $O/$N.txt 2>&1
  ex=$?; bad=$(( $(grep -c 'preload timed out' $O/$N.txt) + $(grep -c ' 504' $O/$N.txt) + $(grep -c 'never set window.__ready' $O/$N.txt) ))
  echo "$N $T exit $ex bad $bad try $try $(date +%T) took $(( $(date +%s) - t0 ))s load $l0..$(cut -d' ' -f1 /proc/loadavg)" | tee -a $B/logs/renders.txt
  [ $bad -eq 0 ] && [ $ex -eq 0 ] && [ -s $O/$N.png ] && break
  mv -f $O/$N.png $O/$N-bad$try.png 2>/dev/null
done
exit 0
