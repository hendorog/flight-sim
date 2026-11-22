#!/bin/bash
# renderq.sh TREES LIST [names]: each view of LIST (or only the names given) on each tree, skipping pictures already there.
B=/home/roger/github/fs-exp/round-w-braid/out/fs/W/B; TREES=$1; L=$2; shift 2; ONLY=" $* "
while read -r n q; do [ -z "$n" ] && continue; [[ "$n" == \#* ]] && continue
  [ "$ONLY" != "  " ] && [[ "$ONLY" != *" $n "* ]] && continue
  for T in $TREES; do [ -s $B/pics/$T/$n.png ] || $B/shot.sh $T "$n" "$q" < /dev/null || exit 1; done
done < $L
echo "QUEUE-DONE $TREES $(date +%T)" >> $B/logs/renders.txt
