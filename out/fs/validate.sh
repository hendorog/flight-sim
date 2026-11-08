#!/bin/bash
# validate.sh DIR TAG : validate.py on the three boxes slopeTry exported into DIR, named s<seed>-TAG; then gate.py.
D=$1; T=$2; cd /home/roger/github/fs-exp/foundation-streams/out/fs
for b in 42:-44250_6250 1:1000_109000 777777:-13000_1000; do s=${b%%:*}; f=${b#*:}
  ~/github/fs/out/landforms/.venv/bin/python tools/validate.py grid s$s-$T $D/seed${s}_${f}.f32 > data/validate-s$s-$T.log 2>&1 &
done; wait
python3 tools/gate.py s1-$T s42-$T s777777-$T
