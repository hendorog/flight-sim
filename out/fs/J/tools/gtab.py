#!/usr/bin/env python3
"""gtab.py NAME=DIR[,OVERRIDE_DIR] ...: Round V's gate numbers from battery directories (finalS.sh + extrasR2.sh +
probesV.sh logs; an override dir - B's quick gates, the join's extra probes - wins where it has the same log), one
column per tree, seeds 1 / 42 / 777777 (/ 7 where the gate has it)."""
import os, re, sys, glob

def rd(dirs, name):
    for d in reversed(dirs):
        p = os.path.join(d, name)
        if os.path.exists(p):
            return open(p, errors='replace').read()
    return ''

def seeds_re(txt, pat, seeds=('1', '42', '777777'), grp=1, prefix='seed '):
    out = []
    for s in seeds:
        m = re.search(prefix + re.escape(s) + r'\b[^\n]*?' + pat, txt)
        out.append(m.group(grp) if m else '-')
    return ' / '.join(out)

def gates(dirs):
    g = {}
    t = rd(dirs, 'probes/tr-owner.log')
    lows = [str(min(int(v) for v in l.split(':', 2)[2].split())) for l in t.splitlines() if l.startswith('TR ')]
    g['owner lows'] = ' / '.join(lows) or '-'
    wn = ''.join(rd(dirs, f'worstN-s{s}.log') for s in ('1', '42', '777777'))
    g['steps>100 world'] = seeds_re(wn, r'TOTAL step:.*?over 100 m (\d+)', prefix='WN seed ')
    g['steps>50 world'] = seeds_re(wn, r'TOTAL step:.*?over 50 m (\d+)', prefix='WN seed ')
    t = rd(dirs, 'stepScan.log')
    g['steps>100 2km'] = seeds_re(t, r'over 100 m (\d+)')
    g['perched>10 km'] = seeds_re(wn, r'TOTAL perched: river water > 10 m over its centre ground ([\d.]+) km', prefix='WN seed ')
    g['riverZero km'] = seeds_re(rd(dirs, 'riverZero.log'), r'> 30 m, ([\d.]+) km', prefix='seed ')
    t = rd(dirs, 'lakeStats.log')
    g['lakes'] = seeds_re(t, r'-> (\d+) lakes')
    g['left dry'] = seeds_re(t, r'\((\d+) left dry')
    g['extra pools'] = seeds_re(t, r'\+ (\d+) extra pools')
    g['water km2'] = seeds_re(t, r'water (\d+) km')
    g['self-cross (worstN)'] = seeds_re(wn, r'TOTAL cross: self-crossings (\d+)', prefix='WN seed ')
    t = rd(dirs, 'endsGate.log')
    g['endsGate DRY/gap/touch'] = str(len(re.findall(r'DRY|JOIN-GAP|TOUCH', t))) if t else '-'
    g['sink ends 1/42/777777/7'] = ' / '.join(re.findall(r"streams ending 'sink'/'stuck' now \(any A\): (\d+)", t)) or '-'
    t = rd(dirs, 'outletLoops.log')
    g['outletLoops loops'] = seeds_re(t, r'loops (\d+)', ('1', '42', '777777', '7'))
    g['cycles'] = seeds_re(rd(dirs, 'cycles.log'), r'cycles (\d+)', ('1', '42', '777777', '7'))
    t = rd(dirs, 'drawnGate.log')
    g['drawnGate (i) %'] = seeds_re(t, r'\(i\):.*?within x0.6-1.6 ([\d.]+) %')
    g['drawnGate (ii)'] = seeds_re(t, r"\(ii\):.*?line's: (\d+)")
    t = rd(dirs, 'homeCheck.log')
    g['homeCheck'] = f"{t.count(': ok')}/8" if t else '-'
    t = rd(dirs, 'suite.log')
    m = re.findall(r'Tests\s+(.*)', t)
    g['suite'] = m[-1].strip() if m else '-'
    t = rd(dirs, 'suite-longtimeout.log')
    m = re.findall(r'Tests\s+(.*)', t)
    g['long-timeout'] = m[-1].strip() if m else '-'
    t = rd(dirs, 'group.txt')
    m = re.search(r'^4 water.*$', t, re.M)
    g['W2 km'] = ' / '.join(re.findall(r'([\d.]+) km', m.group(0))) if m else '-'
    t = rd(dirs, 'junctionGate.log')
    g['step-ups>2 (1/42/777777/7/1234/99991)'] = seeds_re(t, r'outside lakes \d+ / (\d+) /', ('1', '42', '777777', '7', '1234', '99991'))
    t = rd(dirs, 'probes/routeAgree.log')
    m = re.findall(r'drawn channel -> model course x0.5-2 catchment:.*?p50 (\d+) p90 (\d+)', t)
    g['routeAgree p50/p90'] = ' ; '.join(f'{a}/{b}' for a, b in m) or '-'
    g['slots>20 streams km'] = seeds_re(wn, r'TOTAL slot:.*?streams ([\d.]+) /', prefix='WN seed ')
    g['slots>40 streams km'] = seeds_re(wn, r'TOTAL slot:.*?streams [\d.]+ / ([\d.]+)', prefix='WN seed ')
    t = rd(dirs, 'validate.log')
    g['landform b1-100'] = ' / '.join(re.findall(r'^s(?:1|42|777777)-\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+([\d.]+)', t, re.M)) or '-'
    g['pits/100km2 (pit10)'] = ' / '.join(re.findall(r'^s(?:1|42|777777)-\S+(?:\s+\S+){8}\s+([\d.]+)', t, re.M)) or '-'
    t = rd(dirs, 'fieldFaces.log')
    g['fieldFaces blend m'] = seeds_re(t, r"blend (\d+) m")
    g['fieldFaces >0.7 m'] = seeds_re(t, r"over 0.7 (\d+) m")
    t = rd(dirs, 'fieldBanks.log')
    g['fieldBanks >2.5 m'] = seeds_re(t, r'> 2.5 m (\d+) m')
    g['fieldBanks >4 m'] = seeds_re(t, r'> 2.5 m \d+ m, > 4 m (\d+) m')
    t = rd(dirs, 'heldOver.log')
    g['heldOver >3'] = seeds_re(t, r'fieldHeld[\s\S]*?>3 (\d+)')
    g['heldOver >5'] = seeds_re(t, r'fieldHeld[\s\S]*?>5 (\d+)')
    t = rd(dirs, 'dryNear.log')
    g['dryNear hidden m'] = seeds_re(t, r'TOTAL.*?hidden (\d+) m')
    t = rd(dirs, 'underLake.log')
    g['underLake streams>3 km (1/42/777777/7)'] = seeds_re(t, r'streams ([\d.]+) \(', ('1', '42', '777777', '7'))
    g['underLake inside streams km'] = seeds_re(t, r'inside it: rivers [\d.]+ km, streams ([\d.]+) km', ('1', '42', '777777', '7'))
    t = rd(dirs, 'probes/feedCount.log')
    g['feeders /10 river km'] = seeds_re(t, r'([\d.]+) per 10 river km')
    g['gully mouths no stream'] = ' / '.join(re.findall(r'with no drawn stream within 200 m (\d+)', t)) or '-'
    t = rd(dirs, 'headFeed.log')
    g['dry river heads'] = seeds_re(t, r'dry heads with no feeder at all (\d+)')
    t = rd(dirs, 'phaseTimes.log')
    g['build s'] = seeds_re(t, r'total (\d+)', prefix='PHASES seed ')
    t = rd(dirs, 'overGround.log')
    g['overGround>10'] = seeds_re(t, r'over 10 m (\d+)')
    ww = ''.join(rd(dirs, f'waterWalls-s{s}.log') for s in ('1', '42', '777777'))
    m = re.findall(r'river over dry neighbour >2 m \d+ \(([\d.]+) %\)', ww)
    g['waterWalls >2 m %'] = ' / '.join(m) or '-'
    t = rd(dirs, 'probes/chkPoolCut.log') 
    g['poolcut (worstN) falls / p90'] = ' ; '.join(f'{a}/{b}' for a, b in re.findall(r'TOTAL poolcut: (\d+) falls; .*?p90 ([\d.]+)', wn)) or '-'
    t = rd(dirs, 'loopCount.log')
    g['big-river 3km windows>1.5 (1500-)'] = seeds_re(t, r'1500- km.*?over 1.5 (\d+)', prefix='LC seed ')
    t = rd(dirs, 'beltOut.log')
    g['beltOut off floor km'] = seeds_re(t, r'on no valley.s floor\) ([\d.]+) km', prefix='BO seed ')
    t = rd(dirs, 'flatRuns.log')
    g['flatRuns>1km all (1/42/777777/7)'] = seeds_re(t, r'TOTAL flat runs > 1 km[^:]*: (\d+)', ('1', '42', '777777', '7'), prefix='FR seed ') if t else '-'
    g['flatRuns streams (1/42/777777/7)'] = seeds_re(t, r'STREAMS flat runs (\d+)', ('1', '42', '777777', '7'), prefix='FR seed ') if t else '-'
    t = rd(dirs, 'probes/ruleFires.log')
    return g

cols = []
for a in sys.argv[1:]:
    n, ds = a.split('=', 1)
    cols.append((n, gates(ds.split(','))))
keys = list(cols[0][1].keys())
print('| gate | ' + ' | '.join(n for n, _ in cols) + ' |')
print('|---|' + '---|' * len(cols))
for k in keys:
    print(f'| {k} | ' + ' | '.join(c[1].get(k, '-') for c in cols) + ' |')
