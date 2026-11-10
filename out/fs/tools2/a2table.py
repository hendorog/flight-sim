#!/usr/bin/env python3
"""a2table.py DIR [variants]: Round V A2's per-site tables from DIR/<v>/tr.log (a2Attrib.test.ts): (a)'s bands with each
part's share of the band and of its steepest step, and per variant the steepest step within 150 m of (a)'s band and the
transect's lowest drawn ground. Markdown."""
import re, sys
D = sys.argv[1]; VS = sys.argv[2:] or ['a', 'b', 'c', 'c2', 'd', 'e', 'f']
def parse(v):
    T = {}; cur = None
    for line in open(f'{D}/{v}/tr.log'):
        m = re.match(r'TR (\S+) ', line)
        if m: cur = T.setdefault(m.group(1), {'rows': [], 'bands': []}); continue
        if cur is None: continue
        m = re.match(r'\s+(\d+)\s+(-?\d+)\s+([\d.]+) \|.*\| +(nan|-?\d+) +(-?[\d.]+)$', line)
        if m: cur['rows'].append((float(m.group(1)), float(m.group(2)), float(m.group(3)), max(float(m.group(2)), float(m.group(4)) if m.group(4) != 'nan' else -1e9))); continue
        m = re.match(r'\s+BAND \S+ (\d+)-(\d+) m: drawn (-?\d+) -> (-?\d+) \((-?\d+) m over (\d+) m, mean ([\d.]+) deg, steepest ([\d.]+) deg at (\d+) m\)', line)
        if m: cur['bands'].append({'a': float(m.group(1)), 'b': float(m.group(2)), 'dz': float(m.group(5)), 'mean': float(m.group(7)), 'steep': float(m.group(8)), 'at': float(m.group(9))}); continue
        m = re.match(r'\s+shares of the band: (.*)', line)
        if m: cur['bands'][-1]['share'] = dict((k, int(x)) for k, x in re.findall(r'(\w+) (-?\d+)%', m.group(1))); continue
        m = re.match(r'\s+shares of its steepest step \((-?[\d.]+) m\): (.*)', line)
        if m: cur['bands'][-1]['sshare'] = dict((k, int(x)) for k, x in re.findall(r'(\w+) (-?\d+)%', m.group(2))); continue
    return T
P = {v: parse(v) for v in VS}
TERMS = ['noise', 'dR', 'corner', 'carve', 'resid', 'hs', 'blend', 'gul', 'valley', 'chan']
for site in P['a']:
    A = P['a'][site]
    print(f'\n#### {site}\n')
    low = {v: min(r[3] for r in P[v][site]['rows']) for v in VS}  # the surface (terrainHeight: ground or the river's water)
    if not A['bands']:
        print(f'No step over 40 degrees in (a); steepest {max(r[2] for r in A["rows"]):.1f} deg. Lowest surface: ' + ', '.join(f'({v}) {low[v]:.0f}' for v in VS) + ' m.')
        continue
    print('| (a) band | drawn change | mean / steepest slope | ' + ' | '.join(TERMS) + ' |')
    print('|---|---|---|' + '---|' * len(TERMS))
    for b in A['bands']:
        print(f'| {b["a"]:.0f}-{b["b"]:.0f} m, band | {b["dz"]:+.0f} m | {b["mean"]:.1f} / {b["steep"]:.1f} deg | ' + ' | '.join(f'{b["share"].get(t, 0)} %' for t in TERMS) + ' |')
        print(f'| steepest step at {b["at"]:.0f} m | | {b["steep"]:.1f} deg | ' + ' | '.join(f'{b["sshare"].get(t, 0)} %' for t in TERMS) + ' |')
    print('\n| variant | ' + ' | '.join(f'steepest within 150 m of {b["a"]:.0f}-{b["b"]:.0f} m' for b in A['bands']) + ' | lowest surface |')
    print('|---|' + '---|' * len(A['bands']) + '---|')
    for v in VS:
        R = P[v][site]['rows']; cells = []
        for b in A['bands']:
            s = max((r[2] for r in R if b['a'] - 150 <= r[0] <= b['b'] + 150), default=0)
            cells.append(f'{"**" if s > 40 else ""}{s:.1f} deg{"**" if s > 40 else ""}')
        print(f'| ({v}) | ' + ' | '.join(cells) + f' | {low[v]:.0f} m ({low[v] - low["a"]:+.0f}) |')
