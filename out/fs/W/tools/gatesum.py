"""gatesum.py VDIR CHKDIR: one line per gate of the Round W R table from a battery's logs (finalS + extrasR2 in VDIR,
the later probes in CHKDIR), seeds 1 / 42 / 777777 unless said."""
import re, sys, os, glob
V, C = sys.argv[1], sys.argv[2]
def rd(p):
    try: return open(p).read()
    except OSError: return ''
def seeds(txt, pat, cast=float, order=('1', '42', '777777')):
    d = {}
    for m in re.finditer(pat, txt):
        d[m.group(1)] = m.group(2)
    return ' / '.join(str(d.get(s, '-')) for s in order)
out = []
w = {s: rd(f'{V}/wallsGate-s{s}.log') for s in ('1', '42', '777777')}
def walls(t):
    m = re.search(r'valley > 10 m \(km\): river ([\d.]+) stream ([\d.]+) chain ([\d.]+); > 30 m: river ([\d.]+) stream ([\d.]+) chain ([\d.]+)', t)
    return f'{float(m.group(5)) + float(m.group(6)):.1f}' if m else '-'
out.append('wallsGate stream+chain valley > 30 m km: ' + ' / '.join(walls(w[s]) for s in ('1', '42', '777777')))
g = rd(f'{V}/group.txt')
for k in ('2', '3', '5'):
    m = re.search(rf'^{k} .*', g, re.M)
    out.append(f'group class {k}: ' + (m.group(0)[:150] if m else '-'))
dg = rd(f'{V}/drawnGate.log')
out.append('drawnGate (i) corr: ' + seeds(dg, r'seed (\d+) \(i\):.*corr\(log width, log A\) ([\d.-]+)'))
out.append('drawnGate (ii) thin: ' + seeds(dg, r'seed (\d+) \(ii\):.*joining line.s: (\d+)'))
cw = rd(f'{C}/chkWetArea.log')
out.append('chkWetArea: ' + ' | '.join(l.strip()[:160] for l in cw.splitlines() if l.startswith('seed')))
eg = rd(f'{V}/endsGate.log')
out.append('endsGate sinks now: ' + ' '.join(re.findall(r"streams ending 'sink'/'stuck' now \(any A\): (\d+)", eg)) + '; seed 7: ' + ' '.join(re.findall(r"streams ending 'sink'/'stuck' now \(any A\): (\d+)", rd(f'{C}/endsGate7.log'))))
out.append('endsGate DRY/dead lines: ' + ' | '.join(l.strip()[:120] for l in eg.splitlines() if 'DRY' in l or 'dead' in l.lower())[:400])
out.append('outletLoops: ' + ' | '.join(l.strip() for l in rd(f'{V}/outletLoops.log').splitlines() if l.startswith('seed')))
out.append('cycles: ' + ' | '.join(l.strip() for l in rd(f'{V}/cycles.log').splitlines() if l.startswith('seed')))
out.append('selfCross: ' + ' | '.join(l.strip()[:90] for l in rd(f'{C}/selfCross.log').splitlines() if l.startswith('seed') or 'cross' in l)[:600])
hf = rd(f'{V}/headFeed.log')
out.append('headFeed dry heads: ' + seeds(hf, r'seed (\d+):.*dry heads with no feeder at all (\d+)'))
pf = rd(f'{C}/chkPitch.log')
out.append('chkPitch: ' + ' | '.join(l.strip()[:120] for l in pf.splitlines() if l.startswith('seed')))
fb = rd(f'{V}/fieldBanks.log')
out.append('fieldBanks >2.5/>4 m: ' + seeds(fb, r'seed (\d+):.*lower bank at hw\+3 over the water > 2.5 m (\d+ m, > 4 m \d+) m'))
ho = rd(f'{V}/heldOver.log')
out.append('heldOver in reach >3 / >5: ' + ' | '.join(f'{a}: {b} / {c}' for a, b, c in re.findall(r'seed (\d+):[^\n]*\n\s+in airfield reach: water over both banks >1 \d+\s+>3 (\d+)\s+>5 (\d+)', ho)))
dn = rd(f'{V}/dryNear.log')
tot = {}
for m in re.finditer(r'seed (\d+) line \d+ kind \d field \w+: in reach \d+ m, hidden (\d+) m', dn):
    tot[m.group(1)] = tot.get(m.group(1), 0) + int(m.group(2))
out.append('dryNear hidden m: ' + ' / '.join(str(tot.get(s, 0)) for s in ('1', '42', '777777')))
og = rd(f'{V}/overGround.log')
out.append('overGround >10 m points: ' + seeds(og, r'seed (\d+):.*over 10 m (\d+):'))
ww = {s: rd(f'{V}/waterWalls-s{s}.log') for s in ('1', '42', '777777')}
out.append('waterWalls >2 m %: ' + ' / '.join((re.search(r'river over dry neighbour >2 m \d+ \(([\d.]+) %\)', ww[s]) or [None, '-'])[1] for s in ('1', '42', '777777')))
st = rd(f'{V}/stepScan.log')
out.append('stepScan >100 m: ' + seeds(st, r'seed (\d+):.*over 100 m (\d+)'))
ls = rd(f'{V}/lakeStats.log')
out.append('lakeStats: ' + ' | '.join(l.strip()[:110] for l in ls.splitlines() if l.startswith('seed')))
out.append('homeCheck ok: ' + str(rd(f'{V}/homeCheck.log').count(': ok')))
rz = rd(f'{V}/riverZero.log')
out.append('riverZero: ' + seeds(rz, r'seed (\d+): (\d+) lines'))
for s in ('1', '42', '777777'):
    wn = rd(f'{V}/worstN-s{s}.log')
    out.append(f'worstN s{s}: ' + ' | '.join(l.strip()[:150] for l in wn.splitlines() if re.search(r'falls|pool|step|>\s*100|summary', l, re.I))[:700])
fc = rd(f'{V}/probes/feedCount.log')
out.append('feedCount: ' + ' | '.join(l.strip()[:150] for l in fc.splitlines() if 'mouth' in l or 'per 10' in l)[:700])
tr = rd(f'{V}/probes/tr-owner.log')
out.append('tr-owner: ' + ' | '.join(l.strip()[:150] for l in tr.splitlines() if 'low' in l.lower())[:500])
bo = rd(f'{V}/beltOut.log')
out.append('beltOut: ' + ' | '.join(l.strip()[:130] for l in bo.splitlines() if l.startswith('BO seed')))
ff = rd(f'{V}/fieldFaces.log')
out.append('fieldFaces: ' + ' | '.join(l.strip()[:130] for l in ff.splitlines() if l.startswith('seed')))
ul = rd(f'{V}/underLake.log')
out.append('underLake: ' + ' | '.join(l.strip()[:130] for l in ul.splitlines() if l.startswith('seed')))
pg = rd(f'{C}/presentGuard.log')
out.append('presentGuard: ' + ' '.join(re.findall(r'Tests\s+(.*)', pg)))
sl = rd(f'{V}/suite.log')
out.append('suite: ' + ' '.join(re.findall(r'Tests\s+(.*)', sl)))
out.append('suite long: ' + rd(f'{V}/suite-longtimeout.log').replace('\n', ' '))
fl = rd(f'{C}/chkFields.log')
out.append('fields: ' + str(len([l for l in fl.splitlines() if l.startswith('seed')])) + ' lines')
print('\n'.join(out))
