#!/bin/bash
# sumA3r.sh DIR: Round V A3r's report numbers from a battery directory (finalS.sh + extrasR2.sh + probesV.sh), one block
# per measure, seeds 1 / 42 / 777777 (and 7 where the gate runs it).
D=$1
echo "== W2 (wallsGate class 4: water > 10 m over its own centre ground)"; sed -n '/^4 /p' $D/group.txt
echo "== underLake"; grep -h "^seed" $D/underLake.log | sed 's/; line water > 3 m under the lake surface inside it:/ | inside:/' | cut -c1-330
echo "== riverZero"; grep "^seed .*lines with" $D/riverZero.log
echo "== overGround > 10 m"; grep "^seed" $D/overGround.log | sed 's/: \([0-9]*\) points; over 2 m \([0-9]*\).*over 10 m \([0-9]*\):.*/: over 2 m \2, over 10 m \3/'
echo "== junction step-ups"; grep "^seed" $D/junctionGate.log
echo "== endsGate dead ends (DRY / join-gap / touches)"; grep -c "^  DRY\|^  join-gap\|^  touches" $D/endsGate.log; grep "^  DRY\|^  join-gap\|^  touches" $D/endsGate.log | cut -c1-200 | head -5; grep "streams ending 'sink'" $D/endsGate.log
echo "== outletLoops"; grep "^seed" $D/outletLoops.log
echo "== cycles"; grep "^seed" $D/cycles.log
echo "== homeCheck ok"; grep -c ": ok" $D/homeCheck.log
echo "== drawnGate (i)/(ii)"; grep "^seed .* (i)\|^seed .* (ii)" $D/drawnGate.log | sed 's/drawn width.*within x0.6-1.6/within x0.6-1.6/'
echo "== lakes"; grep "^seed" $D/lakeStats.log | cut -c1-200
echo "== steps (2 km grid)"; grep "^seed" $D/stepScan.log | sed 's/; worst \([0-9]* m at [^,]*,[^,]*\), .*/; worst \1/'
echo "== dryNear"; grep "TOTAL" $D/dryNear.log
echo "== fieldFaces"; grep "^seed" $D/fieldFaces.log
echo "== fieldBanks"; grep "^seed" $D/fieldBanks.log | cut -c1-250
echo "== heldOver"; grep -A1 "fieldHeld" $D/heldOver.log | cut -c1-200
echo "== suite"; grep -E "Test Files|Tests  " $D/suite.log; cat $D/suite-longtimeout.log 2>/dev/null
echo "== worstN totals"; grep -h "TOTAL" $D/worstN-s*.log 2>/dev/null | cut -c1-260
echo "== beltOut"; grep "^BO seed" $D/beltOut.log 2>/dev/null
