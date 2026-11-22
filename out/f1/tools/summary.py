# summary.py DIR...: the stage-1 gate numbers from the probe logs in each DIR (gates.sh output), side by side.
import re, sys, json, subprocess
from pathlib import Path
dirs = sys.argv[1:]
def read(d, f):
    p = Path(d) / f
    return p.read_text() if p.exists() else ''
def tree(d, seed):
    t = read(d, f'tree/measure-{seed}.txt') or read(d, 'treeMeasure.log')
    # block for this seed, field classes, lattice after erosion
    m = re.search(rf"seed {seed}: .*?\n(.*?)(?=\nseed \d+: model|\nseed \d+: eroded|\Z)", t, re.S)
    blk = m.group(1) if m else ''
    def sect(name):
        i = blk.find(name)
        return blk[i:i + 3000] if i >= 0 else ''
    out = {}
    for label, name in [('lat', '[field classes] lattice after erosion'), ('drawn', '[field classes] drawn network, rivers (kind 0)')]:
        s = sect(name)
        g = lambda rx: (re.search(rx, s) or [None, '-'])[1]
        out[label] = dict(
            c45in=g(r"confluences both >= 45 km²: \d+;.*?inside the ranges (\d+) %"),
            c45pl=g(r"confluences both >= 45 km²: \d+;.*?plain \d+ \((\d+) %\)"),
            c200=g(r"confluences both >= 200 km²: (\d+)"),
            c200in=g(r"confluences both >= 200 km²: \d+;.*?inside the ranges (\d+) %"),
            c200pl=g(r"confluences both >= 200 km²: \d+;.*?plain \d+ \((\d+) %\)"),
            ex10=g(r"exits >= 10 km²: (\d+)"), ex45=g(r"exits >= 45 km²: (\d+)"),
            ex45nn=g(r"exits >= 45 km²: \d+[^;]*; NN spacing p25/p50/p75 ([\d/]+)"),
            ex45a=g(r"exits >= 45 km²: \d+[^\n]*?area p25/p50/p75/max \d+/(\d+)/\d+/\d+"),
            ex200=g(r"exits >= 200 km²: (\d+)"),
            top3=g(r"top 1/3/5/10 carry \d+/(\d+)/"),
            em=g(r"largest exit / mouth (?:area )?p25/p50/p75 ([\d./]+)"))
    hdr = re.search(rf"seed {seed}: (?:model \S+ \((\d+) ms\)|eroded[^;]*); drawn rivers matching the lattice lines \(index and parent\) (\d+) of (\d+)", t)
    out['match'] = f"{hdr.group(2)}/{hdr.group(3)}" if hdr else '-'
    return out
seeds = ['1', '42', '777777']
print('## Tree measures (field classes; lattice the world routes over / drawn kind-0 rivers)')
keys = ['c45in', 'c45pl', 'c200', 'c200in', 'c200pl', 'ex10', 'ex45', 'ex45nn', 'ex45a', 'ex200', 'top3', 'em']
print('| seed | tree | ' + ' | '.join(keys) + ' | rivers=lines |')
print('|' + '---|' * (len(keys) + 3))
for s in seeds:
    for d in dirs:
        t = tree(d, s)
        for lab in ['lat', 'drawn']:
            print(f"| {s} | {Path(d).name} {lab} | " + ' | '.join(t[lab][k] for k in keys) + f" | {t['match']} |")
print()
print('## Rivers, streams, heads')
for d in dirs:
    for line in read(d, 'riverHeads.log').splitlines():
        if re.match(r'seed \d+: rivers', line): print(f"{Path(d).name}: {line.split(';')[0]}")
    for line in read(d, 'headFeed.log').splitlines():
        if re.match(r'seed \d+: trace', line):
            m = re.search(r"seed (\d+): .*?rivers (\d+) \(head in a lake (\d+)\); dry heads with no feeder at all (\d+)", line)
            print(f"{Path(d).name}: seed {m.group(1)} rivers {m.group(2)}, heads in a lake {m.group(3)}, dry heads unfed {m.group(4)}")
        if 'streams ' in line and 'km; sinks' in line:
            m = re.search(r"streams (\d+) (\d+) km; sinks (\d+)", line)
            fm = None
        if line.strip().startswith('feed {'):
            j = json.loads(line.strip()[5:])
            print(f"    streams {m.group(1)}, {m.group(2)} km, sinks {m.group(3)}; feeders {j['feeders']}, unfed {j['unfed']}")
print()
print('## Lakes')
for d in dirs:
    for line in read(d, 'tarnCount.log').splitlines():
        if re.match(r'seed \d+ \(build', line): print(f"{Path(d).name}: {line[:200]}")
print()
print('## River gradient over 2 km by level band (p50/p90 %)')
for d in dirs:
    for line in read(d, 'plainsRegime.log').splitlines():
        m = re.match(r"seed (\d+) level (\S+) m: .*over 2 km p50/p90 ([\d.]+)/([\d.]+) %", line)
        if m: print(f"{Path(d).name}: seed {m.group(1)} {m.group(2)}: {m.group(3)}/{m.group(4)}")
print()
print('## Water over ground, river over bank, edges')
for d in dirs:
    for line in read(d, 'overGround.log').splitlines():
        if re.match(r'seed \d+', line): print(f"{Path(d).name} overGround: {line[:220]}")
    for s in seeds:
        w = read(d, f'waterWalls-s{s}.log')
        for line in w.splitlines():
            if (line.startswith('SCAN') or 'river over dry' in line) and len(line) < 300: print(f"{Path(d).name} waterWalls s{s}: {line.strip()}")
    for line in read(d, 'edgeScan.log').splitlines():
        if re.match(r'seed \d+:', line): print(f"{Path(d).name} edge: {line}")
