#!/bin/bash
# compare.sh A B : key lines of the gate logs in two gates.sh output folders.
A=$1; B=$2
show() { echo "== $1"; echo "-- $(basename $A)"; grep -h -E "$2" $A/$1.log | cut -c1-260; echo "-- $(basename $B)"; grep -h -E "$2" $B/$1.log | cut -c1-260; }
show riverZero "^seed [0-9]+:"
show lakeStats "^seed"
show lakeKinds "^seed|lakes"
show tarnCount "^seed|tarn"
show homeCheck "^seed"
show headFeed "^seed|unfed|dry"
show overGround "^seed"
show edgeScan "^seed"
show coverShare "^seed"
show heightCost "us/sample"
show costMountain "COSTMTN"
show phaseTimes "PHASES"
for s in s1 s42 s777777; do show waterWalls-$s "SCAN|river bank"; done
