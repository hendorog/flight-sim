#!/bin/bash
# renders.sh: S's after renders, one at a time on port 5325 (work/shot.sh), from work/trees/s2 (HEAD with the 120 s preload).
cd /home/roger/github/fs-exp/round-w-rs
W=$PWD/work
$W/renderlist.sh $W/trees/s2 $W/views-owner.txt $W/s/render
$W/renderlist.sh $W/trees/s2 $W/views-checker.txt $W/s/render
echo RENDERS-DONE
