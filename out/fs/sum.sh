#!/bin/bash
# sum.sh DIR: the gate lines of a battery directory.
D=$1
echo "-- riverZero"; grep "^seed .*lines with" $D/riverZero.log
echo "-- steps"; grep "^seed" $D/stepScan.log | sed 's/; worst \([0-9]* m at [^,]*,[^,]*\), .*/; worst \1/'
echo "-- lakes"; grep "^seed" $D/lakeStats.log | cut -c1-60
echo "-- edge"; grep "^seed" $D/edgeScan.log
echo "-- overGround"; grep "^seed" $D/overGround.log | cut -c1-200
echo "-- waterWalls"; for s in 1 42 777777; do grep "river bank edges" $D/waterWalls-s$s.log; done
echo "-- homeCheck"; grep -c ": ok" $D/homeCheck.log
echo "-- headFeed"; grep "^seed" $D/headFeed.log | cut -c1-130; grep "streams [0-9]" $D/headFeed.log | cut -c1-160
