# cat.py stepWhy.log : the steps over 50 m by kind (stepWhy's ALL rows).
import re, sys, collections
rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.startswith('ALL')]
cat = collections.Counter()
for r in rows:
    seed = r[0].split()[1]
    m = re.findall(r'L(\d+) d(\d+) f(\d+) I(\d+) lv(-?\d+)', r[6])
    aj = float(re.search(r'arcJump (\d+)', r[5]).group(1))
    nat = [float(x) for x in re.findall(r'-?\d+\.?\d*', r[4].split('natural ')[1].replace('->', ' '))]
    gr = [float(x) for x in re.findall(r'-?\d+\.?\d*', r[3].split('ground ')[1].replace('->', ' '))]
    chans = r[7] if len(r) > 7 else ''
    riverch = re.search(r'C\d+r d(\d+)', chans)
    stream_br = re.search(r'C\d+s d\d+ w[\d.]+ lv-?\d+ br', chans)
    natj = abs(nat[1] - nat[0]) > 0.6 * abs(gr[1] - gr[0])
    if natj: c = 'natural'
    elif not m: c = 'stream-breach' if stream_br else 'novalley'
    elif aj > 150: c = 'switch'
    elif riverch: c = 'river-channel'
    elif stream_br: c = 'stream-breach'
    else:
        t, I = max(((float(d) - float(f)) / float(I), float(I)) for L, d, f, I, lv in m)
        c = ('floor' if t < 0 else 'wall' if t < 0.75 else 'edge') + ('-big' if I > 1000 else '-small')
    cat[(seed, c)] += 1
for s in ['1', '42', '777777']:
    tot = sum(v for k, v in cat.items() if k[0] == s)
    print(s, tot, dict(sorted({k[1]: v for k, v in cat.items() if k[0] == s}.items())))
