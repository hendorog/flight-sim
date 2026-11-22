#!/bin/bash
# chainR.sh: the item 2 and item 3 renders, after suite run 3 (no other load of this round's).
cd /home/roger/github/fs-exp/foundation-streams/out/fs/R
T=/home/roger/github/fs-exp/foundation-streams/out/fs/trees
./shots.sh R2 $T/R2 views.txt x602-face2 x602-1853 x602-mouth s1-602 x2157-pond85 x1265-pond87 x567-pond26 x729-shore
./shots.sh R0 $T/R0 views.txt x567-pond26 x729-shore x2157-pond85 x1265-pond87
./shots.sh R3 $T/R3 views.txt 777777-B720 xR720 xR720-low xB720-high xR734 xR692 fly7-abeam fly7-final
./shots.sh R0 $T/R0 views.txt xR720-low xB720-high
echo CHAIN-DONE
