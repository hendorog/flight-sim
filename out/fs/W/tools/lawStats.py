"""lawStats.py DIR SEED [SEED ...]: the design's section-7 numbers for the rivers (kind 0 lines, the prototype's scope)
from organicMap.test.ts dumps (lines-/stations-/reaches-s<seed>.json). Rows are pooled over seeds, length-weighted by reach.

  wet W CV/km       CV of the visible wet width (stations every 10 m) within each 1 km reach, p50 over reaches
  bed W CV/5km      CV of the bed width (bedR + bedL; before: 2 hw) over 5 km windows of each line, p50
  edge rough/W      std of each wet edge's offset from its 200 m running mean, over the wet width W, p50 over reaches
  wet share         visible wet width / bed width, p50 over stations
  kinks R<W /10km   radius through three points one W apart (W = bed width; before 2 hw) < W, runs per 10 km
  Rc p10 / W        10th percentile of that radius over W
  sinuosity 1 km    arc / chord of 1 km windows every 250 m, p50
  lambda CV         bend lengths along a line: the arc between inflections of its heading (smoothed over 2 W, bends
                    shorter than 2 W merged), full bends (two half-bends), their CV per line of 8 or more, p50 (Round W)
  sharp bed corners the bed's edge line (the line offset by bedR / bedL), resampled every W/4: runs where the radius
                    through three points W/2 apart is under W/2, per 10 km of line (Round W: "no corner sharper than
                    about 1 W" drawn)
(Round W: the floor centring row is deleted - the owner's decision of 2026-11-11.)
  white (S < 0.02)  share of samples (S over 1 km < 0.02) drawn as rapids (steepness >= 0.5) / with any running-water look
                    (>= 0.2, water.ts FLOW_FROM: ripples and riffle streaks)
  straight / W p95  longest run within +-W/4 of its chord, over W, p95 over lines >= 2 km
"""
import os
CLS = set(os.environ.get('CLS', 'river').split(','))
import json, math, sys
import numpy as np

def pct(x, q):
    x = np.asarray([v for v in x if np.isfinite(v)], float)
    return float(np.percentile(x, q)) if len(x) else float('nan')

def run(d, seeds, label):
    wetcv, bedcv, rough, share, kinks, rcs, sinu, white, straight, flowlook, lamcv = [], [], [], [], [], [], [], [], [], [], []
    sharp = 0
    km = 0.0
    nk = 0
    for seed in seeds:
        LD = json.load(open(f'{d}/lines-s{seed}.json'))
        lines = LD['lines']
        ST = {x['li']: np.array(x['st'], float) for x in json.load(open(f'{d}/stations-s{seed}.json'))}
        RC = json.load(open(f'{d}/reaches-s{seed}.json'))
        river = {L['li'] for L in lines if L['cls'] in CLS}
        for L in lines:
            if L['cls'] not in CLS or len(L['s']) < 3:
                continue
            s = np.array(L['s'], float); n = np.array(L['n'], float); e = np.array(L['e'], float)
            hw = np.array(L['hw'], float)
            bed = (np.array(L['bR'], float) + np.array(L['bL'], float)) if L.get('bR') else 2 * hw
            total = s[-1]
            km += total / 1000
            # wet width per station and edge roughness
            st = ST.get(L['li'])
            if st is not None and len(st) > 5:
                sv = st[:, 0]; eR = st[:, 1]; eL = st[:, 5]
                ok = (eR > 0) & (eL > 0)
                w = np.where(ok, eR + eL, np.nan)
                bw = np.interp(sv, s, bed)
                for k0 in np.arange(0, total, 1000.0):
                    m = (sv >= k0) & (sv < k0 + 1000) & ok
                    if m.sum() >= 20:
                        wetcv.append(np.nanstd(w[m]) / max(1e-6, np.nanmean(w[m])))
                share.extend(list((w[ok] / np.maximum(1e-6, bw[ok]))[::5]))
                for col in (1, 5):
                    ed = st[:, col]
                    if ok.sum() > 30:
                        x = np.where(ok, ed, np.nan)
                        k = 10
                        rm = np.array([np.nanmean(x[max(0, i - k):i + k + 1]) if np.isfinite(x[max(0, i - k):i + k + 1]).any() else np.nan for i in range(len(x))])
                        dev = x - rm
                        for k0 in np.arange(0, total, 1000.0):
                            m = (sv >= k0) & (sv < k0 + 1000) & ok
                            if m.sum() >= 20:
                                rough.append(np.nanstd(dev[m]) / max(1e-6, np.nanmean(w[m])))
            # bed width CV over 5 km windows
            if total >= 2500:
                for k0 in np.arange(0, max(1.0, total - 2500), 5000.0):
                    m = (s >= k0) & (s < k0 + 5000)
                    if m.sum() >= 10:
                        bedcv.append(np.std(bed[m]) / max(1e-6, np.mean(bed[m])))
            # kinks on a resampled line, three points one W apart
            Wm = max(4.0, float(np.median(bed)))
            step = max(1.0, Wm / 6)
            g = np.arange(0, total, step)
            X = np.interp(g, s, n); Y = np.interp(g, s, e); Wg = np.maximum(4.0, np.interp(g, s, bed))
            kk = max(1, int(round(Wm / step)))
            if len(g) > 2 * kk + 2:
                a = np.stack([X[:-2 * kk], Y[:-2 * kk]]); b = np.stack([X[kk:-kk], Y[kk:-kk]]); c = np.stack([X[2 * kk:], Y[2 * kk:]])
                ab = np.hypot(*(a - b)); bc = np.hypot(*(b - c)); ca = np.hypot(*(c - a))
                cr = np.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
                R = ab * bc * ca / np.maximum(1e-9, 2 * cr)
                Wb = Wg[kk:-kk]
                tight = R < Wb
                nk += int(np.sum(tight[1:] & ~tight[:-1]) + (1 if tight[0] else 0))
                rcs.extend(list((R / Wb)[::3]))
            # bend lengths (lambda CV)
            Wl = max(4.0, float(np.median(bed)))
            stl = max(2.0, Wl / 2)
            gl = np.arange(0, total, stl)
            if len(gl) > 20:
                Xl = np.interp(gl, s, n); Yl = np.interp(gl, s, e)
                hd = np.unwrap(np.arctan2(np.diff(Yl), np.diff(Xl)))
                kw = max(1, int(round(2 * Wl / stl)))
                if len(hd) > 2 * kw + 2:
                    hs = np.convolve(hd, np.ones(2 * kw + 1) / (2 * kw + 1), mode='valid')
                    cv = np.sign(np.diff(hs))
                    halves = []; run0 = 0
                    for q in range(1, len(cv)):
                        if cv[q] != cv[q - 1] and cv[q] != 0:
                            ln = (q - run0) * stl
                            if ln < 2 * Wl and halves:
                                halves[-1] += ln
                            else:
                                halves.append(ln)
                            run0 = q
                    full = [halves[q] + halves[q + 1] for q in range(0, len(halves) - 1, 2)]
                    if len(full) >= 8:
                        lamcv.append(np.std(full) / max(1e-6, np.mean(full)))
            # sharp corners on the bed's edges
            if L.get('bR') and total > 4 * Wl:
                bR = np.array(L['bR'], float); bL = np.array(L['bL'], float)
                tn = np.gradient(n, s, edge_order=1) if len(s) > 2 else np.zeros_like(n)
                te = np.gradient(e, s, edge_order=1) if len(s) > 2 else np.zeros_like(e)
                tl = np.maximum(1e-9, np.hypot(tn, te)); tn /= tl; te /= tl
                for off, sg in ((bR, 1), (bL, -1)):
                    En = n - te * off * sg; Ee = e + tn * off * sg
                    st4 = max(1.0, Wl / 4)
                    g4 = np.arange(0, total, st4)
                    X4 = np.interp(g4, s, En); Y4 = np.interp(g4, s, Ee); W4 = np.maximum(4.0, np.interp(g4, s, bed))
                    k4 = 2
                    if len(g4) > 2 * k4 + 2:
                        a = np.stack([X4[:-2 * k4], Y4[:-2 * k4]]); b = np.stack([X4[k4:-k4], Y4[k4:-k4]]); c = np.stack([X4[2 * k4:], Y4[2 * k4:]])
                        ab = np.hypot(*(a - b)); bc = np.hypot(*(b - c)); ca = np.hypot(*(c - a))
                        cr = np.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
                        R = ab * bc * ca / np.maximum(1e-9, 2 * cr)
                        tight = R < 0.5 * W4[k4:-k4]
                        sharp += int(np.sum(tight[1:] & ~tight[:-1]) + (1 if tight[0] else 0))
            # sinuosity at 1 km
            if total >= 1000:
                for v in np.arange(0, total - 1000, 250.0):
                    an, ae = np.interp(v, s, n), np.interp(v, s, e)
                    bn, be = np.interp(v + 1000, s, n), np.interp(v + 1000, s, e)
                    sinu.append(1000 / max(1e-6, math.hypot(bn - an, be - ae)))
            # white on gentle reaches
            if L.get('st'):
                stp = np.array(L['st'], float)
                lv = np.array(L['lv'], float)
                for i in range(0, len(s), 3):
                    j0 = np.searchsorted(s, s[i] - 500); j1 = min(len(s) - 1, np.searchsorted(s, s[i] + 500))
                    S = (lv[j0] - lv[j1]) / max(1.0, s[j1] - s[j0])
                    if S < 0.02:
                        white.append(stp[i] >= 0.5)
                        flowlook.append(stp[i] >= 0.2)
            # longest straight run (within W/4 of the chord), over W
            if total >= 2000:
                stp2 = max(2.0, Wm / 2)
                g2 = np.arange(0, total, stp2); X2 = np.interp(g2, s, n); Y2 = np.interp(g2, s, e)
                best = 0; i = 0
                while i < len(g2) - 1:
                    j = i + 1
                    while j < len(g2):
                        dx, dy = X2[j] - X2[i], Y2[j] - Y2[i]; Lc = math.hypot(dx, dy) or 1
                        dev = np.max(np.abs((X2[i:j + 1] - X2[i]) * dy - (Y2[i:j + 1] - Y2[i]) * dx) / Lc)
                        if dev > Wm / 4:
                            break
                        j += 1
                    best = max(best, (j - 1 - i) * stp2)
                    i += max(1, (j - i) // 2)
                straight.append(best / Wm)
    print(f"{label}: rivers {km:.0f} km")
    print(f"  wet W CV per km p50            {pct(wetcv, 50):.3f}")
    print(f"  bed W CV per 5 km p50          {pct(bedcv, 50):.3f}")
    print(f"  edge roughness / W p50         {pct(rough, 50):.3f}")
    print(f"  wet share p50 (p10-p90)        {pct(share, 50):.2f} ({pct(share, 10):.2f}-{pct(share, 90):.2f})")
    print(f"  kinks R<W per 10 km            {nk / max(1e-9, km / 10):.2f}")
    print(f"  Rc p10 / W                     {pct(rcs, 10):.2f}")
    print(f"  sinuosity 1 km p50 (p90)       {pct(sinu, 50):.3f} ({pct(sinu, 90):.3f})")
    print(f"  lambda CV along a line p50     {pct(lamcv, 50):.3f} ({len(lamcv)} lines)")
    print(f"  sharp bed corners per 10 km    {sharp / max(1e-9, km / 10):.2f}")
    print(f"  white (steepness >= 0.5, rapids) on S < 0.02   {100 * np.mean(white) if white else float('nan'):.1f} %")
    print(f"  running-water look (>= 0.2) on S < 0.02        {100 * np.mean(flowlook) if flowlook else float('nan'):.1f} %")
    print(f"  longest straight / W p50 (p95) {pct(straight, 50):.1f} ({pct(straight, 95):.1f})")

if __name__ == '__main__':
    run(sys.argv[1], sys.argv[2:], sys.argv[1])
