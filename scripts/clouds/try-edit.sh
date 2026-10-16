#!/bin/bash
# Measure a temporary cloud shader edit, then put the sources back.
#   scripts/clouds/try-edit.sh <name> [file old new]...   env: SCN (scenarios, default base,close,tops)
# Results go to work/<name>-*; see measure.mjs for the metrics.
cd "$(dirname "$0")/../.." || exit 1
name=$1; shift
mkdir -p work
files="marchShader.ts cloudModel.ts resolveShaders.ts CloudsEffect.ts"
for f in $files; do cp src/render/clouds/$f work/$f.bak; done
restore() { for f in $files; do cp work/$f.bak src/render/clouds/$f; done; }
trap restore EXIT
[ $# -gt 0 ] && { python3 scripts/clouds/apply-edit.py "$@" || exit 1; }
echo "== $name"; timeout 600 node scripts/clouds/measure.mjs work/$name ${SCN:-base,close,tops} 2>&1
