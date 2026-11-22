import re, sys, math
lines = open(sys.argv[1]).read().splitlines()
pat = re.compile(r"mtn h p50/p90/max (\d+)/(\d+)/(\d+) relief5 p50 (\d+) slope p50 ([\d.]+)° \| hill h p50/p90/max (\d+)/(\d+)/(\d+) relief5 p50 (\d+) slope p50 ([\d.]+)° \| plain h p50/p90/max (\d+)/(\d+)/(\d+) relief5 p50 (\d+) slope p50 ([\d.]+)° \| above noise (\d+) % \| relief classes m/h/p (\d+)/(\d+)/(\d+)")
today = None; rows = []
for l in lines:
    m = pat.search(l)
    if not m: continue
    v = list(map(float, m.groups()))
    if 'today eroded' in l: today = v
    elif 'ss ridge' in l: rows.append((l.split(':')[0].strip(), v))
def score(v):
    s = 0
    for k in [0,1,3, 5,6,8, 10,11,13]: s += abs(math.log(max(v[k],1)/max(today[k],1)))
    s += 0.5*abs(math.log(v[2]/today[2]))
    for k in [16,17,18]: s += abs(v[k]-today[k])/20
    return s
rows.sort(key=lambda r: score(r[1]))
print('today', today)
for name, v in rows[:int(sys.argv[2]) if len(sys.argv)>2 else 15]:
    print(f"{score(v):.2f} {name}: mtn {v[0]:.0f}/{v[1]:.0f}/{v[2]:.0f} r{v[3]:.0f} | hill {v[5]:.0f}/{v[6]:.0f}/{v[7]:.0f} r{v[8]:.0f} | plain {v[10]:.0f}/{v[11]:.0f} r{v[13]:.0f} | above {v[15]:.0f}% rc {v[16]:.0f}/{v[17]:.0f}/{v[18]:.0f}")
