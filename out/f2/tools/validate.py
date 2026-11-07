#!/usr/bin/env python3
"""Landscape validation measures, computed the same way on NZ ground (LINZ DEM) and on seeded-world heightmaps.

  validate.py region NAME --bbox LAT0,LON0,LAT1,LON1 [--res 20] [--lakes]   NZ region (DEM from LINZ)
  validate.py grid NAME FILE.f32                                           heightExport probe output (+ .json header)
  validate.py compare NAME [NAME ...]                                      combined plots + table

Measures (all from a D8 flow model on the priority-flooded surface; cells whose catchment reaches the map edge are left
out of catchment-based statistics):
  - slope-area (Flint): S = k A^-theta, fitted for channels 1..1000 km2; the slope-area plot shows the hillslope/channel
    transition;
  - Hack: mainstream length L = c A^h;
  - drainage density at channel-head thresholds 0.1 / 0.5 / 1 km2;
  - hypsometry and slope histogram of the land;
  - valley cross-sections: power-law fit z = a x^b of each half-section (b ~ 1 V, ~ 2 U), floor widths, depth;
  - closed hollows left in the ground (depressions > 2 m deep), by altitude;
  - lakes (OSM natural=water, NZ only) by altitude;
  - fans: unconfined run-out of side streams onto a trunk floor (length, slope, convexity) against side catchment.
Learning only: NZ numbers become targets for the seeded generator.
"""
from __future__ import annotations

import argparse
import heapq
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
from numba import njit
from scipy.ndimage import map_coordinates

sys.path.insert(0, str(Path(__file__).parent))
import lf  # noqa: E402

OUT = lf.DATA / "validate"
FLOW_CACHE: dict = {}
NB8 = np.array([(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)], np.int64)
ND8 = np.array([math.sqrt(2), 1, math.sqrt(2), 1, 1, math.sqrt(2), 1, math.sqrt(2)])


# ---------------------------------------------------------------- flow model (numba)

@njit(cache=True)
def _flood(z):
    h, w = z.shape
    f = z.copy()
    closed = np.zeros((h, w), np.bool_)
    heap = [(0.0, np.int64(0))]
    heap.pop()
    for r in range(h):
        for c in range(w):
            if np.isnan(z[r, c]):
                closed[r, c] = True
    for r in range(h):
        for c in range(w):
            if closed[r, c]:
                continue
            seed = r == 0 or c == 0 or r == h - 1 or c == w - 1
            if not seed:
                for k in range(8):
                    rr = r + NB8[k, 0]
                    cc = c + NB8[k, 1]
                    if np.isnan(z[rr, cc]):
                        seed = True
                        break
            if seed:
                closed[r, c] = True
                heapq.heappush(heap, (f[r, c], np.int64(r * w + c)))
    while len(heap) > 0:
        e, i = heapq.heappop(heap)
        r = i // w
        c = i % w
        for k in range(8):
            rr = r + NB8[k, 0]
            cc = c + NB8[k, 1]
            if rr < 0 or cc < 0 or rr >= h or cc >= w or closed[rr, cc]:
                continue
            closed[rr, cc] = True
            if f[rr, cc] <= e:
                f[rr, cc] = e + 1e-5
            heapq.heappush(heap, (f[rr, cc], np.int64(rr * w + cc)))
    return f


@njit(cache=True)
def _receivers(f, res):
    h, w = f.shape
    rec = np.full(h * w, -1, np.int64)
    for r in range(h):
        for c in range(w):
            if np.isnan(f[r, c]):
                continue
            best = 0.0
            for k in range(8):
                rr = r + NB8[k, 0]
                cc = c + NB8[k, 1]
                if rr < 0 or cc < 0 or rr >= h or cc >= w:
                    continue
                if np.isnan(f[rr, cc]):
                    continue
                drop = (f[r, c] - f[rr, cc]) / (ND8[k] * res)
                if drop > best:
                    best = drop
                    rec[r * w + c] = rr * w + cc
    return rec


@njit(cache=True)
def _accumulate(order, rec, land, h, w, res):
    n = h * w
    acc = np.zeros(n)
    length = np.zeros(n)          # longest flow path upstream, m
    edge = np.zeros(n, np.bool_)  # catchment reaches the map edge
    for i in range(n):
        if land[i]:
            acc[i] = 1.0
            r = i // w
            c = i % w
            if r == 0 or c == 0 or r == h - 1 or c == w - 1:
                edge[i] = True
    main = np.full(n, -1, np.int64)
    best = np.zeros(n)
    for t in range(n):
        i = order[t]
        if not land[i]:
            continue
        j = rec[i]
        if j < 0:
            continue
        acc[j] += acc[i]
        dr = abs(i // w - j // w)
        dc = abs(i % w - j % w)
        d = res * (1.4142135 if dr and dc else 1.0)
        if length[i] + d > length[j]:
            length[j] = length[i] + d
        if edge[i]:
            edge[j] = True
        if acc[i] > best[j]:
            best[j] = acc[i]
            main[j] = i
    return acc, length, edge, main


@njit(cache=True)
def _down_slope(z, rec, w, res, reach):
    """Slope over ~reach metres downstream along the flow path (original ground), and the cell reached."""
    n = rec.shape[0]
    s = np.full(n, np.nan)
    to = np.full(n, -1, np.int64)
    zf = z.ravel()
    for i in range(n):
        if np.isnan(zf[i]):
            continue
        j = i
        d = 0.0
        while d < reach:
            k = rec[j]
            if k < 0:
                break
            dr = abs(j // w - k // w)
            dc = abs(j % w - k % w)
            d += res * (1.4142135 if dr and dc else 1.0)
            j = k
        if d > 0:
            s[i] = (zf[i] - zf[j]) / d
            to[i] = j
    return s, to


class Flow:
    def __init__(self, z, res):
        t = time.time()
        self.z = z.astype(np.float64)
        self.res = res
        self.h, self.w = z.shape
        self.f = _flood(self.z)
        self.rec = _receivers(self.f, res)
        land = ~np.isnan(self.z.ravel())
        order = np.argsort(-np.where(land, self.f.ravel(), -1e18), kind="stable")
        acc, self.length, self.edge, self.main = _accumulate(order, self.rec, land, self.h, self.w, res)
        self.area = acc * (res / 1000) ** 2  # km2
        self.slope, self.down = _down_slope(self.z, self.rec, self.w, res, 300.0)
        self.land = land
        print(f"  flow model {self.h}x{self.w} in {time.time() - t:.1f}s")

    def xy(self, i):
        return i % self.w, i // self.w  # col, row


# ---------------------------------------------------------------- measures

def fit_loglog(x, y):
    m = (x > 0) & (y > 0) & np.isfinite(x) & np.isfinite(y)
    if m.sum() < 10:
        return np.nan, np.nan
    b, a = np.polyfit(np.log10(x[m]), np.log10(y[m]), 1)
    return b, 10 ** a


def binned(x, y, lo, hi, n=24):
    edges = np.logspace(np.log10(lo), np.log10(hi), n + 1)
    mids, med = [], []
    for a, b in zip(edges[:-1], edges[1:]):
        m = (x >= a) & (x < b) & np.isfinite(y)
        if m.sum() >= 20:
            mids.append(math.sqrt(a * b))
            med.append(float(np.median(y[m])))
    return np.array(mids), np.array(med)


def measures(F: Flow, name, lakes=None, sample_seed=1):
    res = F.res
    A, S, inner, land = F.area, F.slope, ~F.edge & F.land, F.land
    out = {"name": name, "res_m": res, "land_km2": float(land.sum() * (res / 1000) ** 2)}

    # Slope-area.
    ch = inner & (A >= 1) & (A <= 1000) & (S > 1e-4)
    theta, ks = fit_loglog(A[ch], S[ch])
    out["flint_theta"] = -theta
    out["flint_ks"] = ks
    sa_x, sa_y = binned(A[inner & (S > 0)], S[inner & (S > 0)], (res / 1000) ** 2 * 2, max(A[inner].max(), 1))
    out["slope_area_bins"] = [sa_x.tolist(), sa_y.tolist()]

    # Hack.
    hk = inner & (A >= 1)
    h, c = fit_loglog(A[hk], F.length[hk] / 1000)
    out["hack_h"], out["hack_c"] = h, c

    # Drainage density (interior land only).
    inner_km2 = inner.sum() * (res / 1000) ** 2
    seg = np.where(F.rec >= 0, res * np.where((np.abs(np.arange(len(A)) // F.w - F.rec // F.w) > 0)
                                               & (np.abs(np.arange(len(A)) % F.w - F.rec % F.w) > 0), 1.4142, 1.0), 0)
    out["drainage_density_km_per_km2"] = {str(ac): float((seg[inner & (A >= ac)]).sum() / 1000 / max(inner_km2, 1e-9))
                                          for ac in (0.1, 0.5, 1.0)}

    # Hypsometry and slopes (land).
    z = F.z
    gy, gx = np.gradient(np.where(np.isnan(z), np.nanmean(z), z), res)
    sdeg = np.degrees(np.arctan(np.hypot(gx, gy))).ravel()
    zl = z.ravel()[land]
    out["elev_pct"] = {str(p): float(np.percentile(zl, p)) for p in (5, 25, 50, 75, 95, 99)}
    out["slope_deg_pct"] = {str(p): float(np.percentile(sdeg[land], p)) for p in (10, 25, 50, 75, 90, 99)}
    out["slope_hist"] = np.histogram(sdeg[land], bins=np.arange(0, 71, 2.5))[0].tolist()
    # Local relief: max - min in 1 km and 5 km windows (median over the land).
    from scipy.ndimage import maximum_filter, minimum_filter
    zz = np.where(np.isnan(z), np.nanmin(z), z)
    for km in (1, 5):
        k = max(3, int(km * 1000 / res) | 1)
        rel = (maximum_filter(zz, k) - minimum_filter(zz, k)).ravel()[land]
        out[f"relief_{km}km_median_m"] = float(np.median(rel))

    # Closed hollows in the ground (depth > 2 m), counted by connected region, by altitude.
    from scipy.ndimage import label
    dep = (F.f - F.z) > 2.0
    lab, n = label(dep)
    hollows = []
    if n:
        idx = np.arange(1, n + 1)
        from scipy.ndimage import maximum as nd_max, mean as nd_mean, sum as nd_sum
        depth = nd_max(F.f - F.z, lab, idx)
        size = nd_sum(np.ones_like(z), lab, idx) * (res / 1000) ** 2
        elev = nd_mean(F.f, lab, idx)
        hollows = [(float(e), float(s), float(d)) for e, s, d in zip(elev, size, depth) if s >= 2 * (res / 1000) ** 2]
    out["hollows"] = hollows
    out["hollows_per_100km2"] = len(hollows) / max(out["land_km2"], 1e-9) * 100

    # Lakes by altitude (NZ only).
    if lakes is not None:
        out["lakes"] = lakes
    # Valley cross-sections.
    out["valleys"] = valley_sections(F, sample_seed)
    # Fans.
    out["fans"] = fans(F)
    return out


def valley_sections(F: Flow, seed, per_bin=60):
    rng = np.random.default_rng(seed)
    res, A = F.res, F.area
    rows = []
    bins = [(1, 10), (10, 100), (100, 1000), (1000, 1e7)]
    taken = []
    for lo, hi in bins:
        cand = np.nonzero(F.land & (A >= lo) & (A < hi) & (F.down >= 0))[0]
        rng.shuffle(cand)
        got = 0
        for i in cand:
            if got >= per_bin:
                break
            c0, r0 = F.xy(i)
            x0, y0 = c0 * res, r0 * res
            if any((x0 - a) ** 2 + (y0 - b) ** 2 < 3000 ** 2 for a, b in taken):
                continue
            j = F.down[i]
            c1, r1 = F.xy(j)
            t = np.array([c1 - c0, r1 - r0], float)
            if np.hypot(*t) == 0:
                continue
            t /= np.hypot(*t)
            n = np.array([-t[1], t[0]])
            half = 3000.0
            off = np.arange(-half, half + res / 2, res / 2)
            cc = c0 + off / res * n[0]
            rr = r0 + off / res * n[1]
            if cc.min() < 0 or rr.min() < 0 or cc.max() > F.w - 1 or rr.max() > F.h - 1:
                continue
            zp = map_coordinates(F.z, [rr, cc], order=1, cval=np.nan)
            if np.isnan(zp).any():
                continue
            mid = len(off) // 2
            near = np.abs(off) <= 90
            k0 = np.nonzero(near)[0][np.argmin(zp[near])]
            floor = zp[k0]
            fits = []
            for side in (-1, 1):
                idx = np.arange(k0, len(off)) if side > 0 else np.arange(k0, -1, -1)
                prof = zp[idx] - floor
                x = np.abs(off[idx] - off[k0])
                top = np.argmax(prof)  # the side's highest point within 3 km
                if prof[top] < 30 or top < 4:
                    fits = None
                    break
                m = (prof[:top + 1] > 2) & (prof[:top + 1] < 0.9 * prof[top]) & (x[:top + 1] > 0)
                if m.sum() < 4:
                    fits = None
                    break
                b, a = np.polyfit(np.log(x[:top + 1][m]), np.log(prof[:top + 1][m]), 1)
                fits.append((b, prof[top]))
            if not fits:
                continue
            depth = min(fits[0][1], fits[1][1])

            def width_at(hh):
                m = zp <= floor + hh
                lo_ = k0
                while lo_ > 0 and m[lo_ - 1]:
                    lo_ -= 1
                hi_ = k0
                while hi_ < len(m) - 1 and m[hi_ + 1]:
                    hi_ += 1
                return (hi_ - lo_ + 1) * res / 2

            rows.append(dict(area_km2=float(A[i]), floor_m=float(floor), depth_m=float(depth),
                             b=float(np.mean([f[0] for f in fits])), b_min=float(min(f[0] for f in fits)),
                             floor5_m=width_at(5), floor20_m=width_at(20), width_half_depth_m=width_at(0.5 * depth),
                             slope=float(F.slope[i]), inner=bool(~F.edge[i])))
            taken.append((x0, y0))
            got += 1
    return rows


def _lateral(F, cell, nrm, offs):
    c0, r0 = cell % F.w, cell // F.w
    cc = c0 + np.asarray(offs) / F.res * nrm[0]
    rr = r0 + np.asarray(offs) / F.res * nrm[1]
    return map_coordinates(F.z, [rr, cc], order=1, cval=np.nan)


def _dir(F, cell):
    j = F.down[cell]
    if j < 0:
        return None
    t = np.array([j % F.w - cell % F.w, j // F.w - cell // F.w], float)
    L = np.hypot(*t)
    return None if L == 0 else np.array([-t[1], t[0]]) / L


def fans(F: Flow, a_min=0.05, a_max=200.0):
    """Fans: where a channel leaves its own valley (apex: walls >= 15 m at 250 m either side upstream, none just below),
    follow the flow down while the ground across the path is convex (a cone; the incised channel itself is ignored).
    The toe is where the convexity ends, the stream joins one 3x its size, or the slope falls under 0.4 %."""
    res, A, w = F.res, F.area, F.w
    zf = F.z.ravel()
    ch = np.nonzero(F.land & (A >= a_min) & (A <= a_max) & (F.down >= 0))[0]
    rows, used = [], np.zeros(len(A), bool)
    lat_conf = np.array([-250.0, 250.0])
    lat_cone = np.r_[-np.arange(400, 59, -40), np.arange(60, 401, 40)].astype(float)
    for i in ch:
        if used[i]:
            continue
        n = _dir(F, i)
        if n is None:
            continue
        side = _lateral(F, i, n, lat_conf)
        if np.isnan(side).any() or np.min(side) - zf[i] < 15:
            continue  # not confined here
        j = F.down[i]  # ~300 m downstream
        nj = _dir(F, j)
        if nj is None:
            continue
        sj = _lateral(F, j, nj, lat_conf)
        if np.isnan(sj).any() or np.max(sj) - zf[j] > 10:
            continue  # still in a valley 300 m on
        # Walk down from the apex while the cross-profile stays convex.
        a0 = A[i]
        k, dist, last_conv, path = i, 0.0, 0.0, []
        bad = 0
        while True:
            # step ~100 m
            d = 0.0
            while d < 100:
                r = F.rec[k]
                if r < 0:
                    break
                dr = abs(r // w - k // w)
                dc = abs(r % w - k % w)
                d += res * (1.4142 if dr and dc else 1.0)
                k = r
            if d == 0 or A[k] > 3 * a0 + 1 or F.rec[k] < 0:
                break
            dist += d
            nk = _dir(F, k)
            if nk is None:
                break
            prof = _lateral(F, k, nk, lat_cone)
            if np.isnan(prof).any():
                break
            x = lat_cone
            curv = np.polyfit(x / 1000, prof - zf[k], 2)[0]  # m per km^2; negative = convex across
            if curv < -1:
                bad = 0
                last_conv = dist
                path.append(k)
            else:
                bad += 1
                if bad >= 2:
                    break
            if F.slope[k] < 0.004 or dist > 15000:
                break
        if last_conv < 200 or len(path) < 2:
            continue
        toe = path[-1]
        L = last_conv
        drop = zf[i] - zf[toe]
        if drop <= 0:
            continue
        for q in path:
            used[q] = True
        rows.append(dict(trib_area_km2=float(a0), runout_m=float(L), fan_slope=float(drop / L),
                         apex_elev_m=float(zf[i]), apex=[int(i % w), int(i // w)], toe=[int(toe % w), int(toe // w)]))
    # One fan per apex region: keep the longest of apices within 500 m of each other.
    rows.sort(key=lambda r: -r["runout_m"])
    keep = []
    for r in rows:
        if all((r["apex"][0] - q["apex"][0]) ** 2 + (r["apex"][1] - q["apex"][1]) ** 2 > (500 / res) ** 2 for q in keep):
            keep.append(r)
    return keep


def fan_map(F, fl, path):
    from PIL import Image, ImageDraw
    hs = lf.hillshade(F.z, F.res, exag=1.5)
    im = Image.fromarray(np.repeat(hs[..., None], 3, -1))
    d = ImageDraw.Draw(im)
    for r in fl:
        d.line([tuple(r["apex"]), tuple(r["toe"])], fill=(255, 60, 30), width=5)
        d.ellipse([r["apex"][0] - 8, r["apex"][1] - 8, r["apex"][0] + 8, r["apex"][1] + 8], outline=(255, 220, 0), width=3)
    im.thumbnail((2400, 2400))
    im.save(path, quality=85)


# ---------------------------------------------------------------- lakes (OSM, NZ only)

def osm_lakes(bounds_nztm, z, tr):
    x0, y0, x1, y1 = bounds_nztm
    lon0, lat0 = lf.TO_WGS.transform(x0, y0)
    lon1, lat1 = lf.TO_WGS.transform(x1, y1)
    q = (f'[out:json][timeout:180];(way["natural"="water"]({lat0},{lon0},{lat1},{lon1});'
         f'relation["natural"="water"]({lat0},{lon0},{lat1},{lon1}););out geom;')
    for attempt in range(5):
        try:
            r = lf.SESSION.post("https://overpass-api.de/api/interpreter", data={"data": q}, timeout=240)
            r.raise_for_status()
            break
        except Exception:  # noqa: BLE001  (Overpass is busy at times)
            if attempt == 4:
                raise
            time.sleep(20 * (attempt + 1))
    lakes = []
    for e in r.json()["elements"]:
        tags = e.get("tags", {})
        if tags.get("water") in ("river", "stream", "canal", "ditch", "drain", "wastewater"):
            continue
        rings = []
        if e["type"] == "way" and e.get("geometry"):
            rings.append(e["geometry"])
        elif e["type"] == "relation":
            for m in e.get("members", []):
                if m.get("role") == "outer" and m.get("geometry"):
                    rings.append(m["geometry"])
        for g in rings:
            if len(g) < 4 or (g[0]["lat"], g[0]["lon"]) != (g[-1]["lat"], g[-1]["lon"]):
                continue
            xs, ys = lf.TO_NZTM.transform([p["lon"] for p in g], [p["lat"] for p in g])
            xs, ys = np.array(xs), np.array(ys)
            area = 0.5 * abs(np.dot(xs, np.roll(ys, 1)) - np.dot(ys, np.roll(xs, 1))) / 1e6
            if area < 0.0005:
                continue
            col = (xs - tr.c) / tr.a - 0.5
            row = (ys - tr.f) / tr.e - 0.5
            zs = map_coordinates(z, [row, col], order=1, cval=np.nan)
            if np.isnan(zs).all():
                continue
            lakes.append(dict(area_km2=float(area), elev_m=float(np.nanmedian(zs)),
                              kind=tags.get("water", "lake"), name=tags.get("name", "")))
    return lakes


# ---------------------------------------------------------------- plots

def plot_region(m, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(2, 3, figsize=(16, 9.5))
    x, y = m["slope_area_bins"]
    ax[0, 0].loglog(x, y, "o-")
    ax[0, 0].set_xlabel("catchment km2"); ax[0, 0].set_ylabel("median slope")
    ax[0, 0].set_title(f"slope-area: theta {m['flint_theta']:.2f}, ks {m['flint_ks']:.3f}")
    ax[0, 1].bar(np.arange(0, 70, 2.5), m["slope_hist"], width=2.4, align="edge")
    ax[0, 1].set_xlabel("slope deg"); ax[0, 1].set_title("slope histogram (land)")
    v = m["valleys"]
    if v:
        sc = ax[0, 2].scatter([r["floor_m"] for r in v], [r["b"] for r in v], c=np.log10([r["area_km2"] for r in v]),
                              s=14, cmap="viridis")
        fig.colorbar(sc, ax=ax[0, 2], label="log10 catchment km2")
        ax[0, 2].axhline(1, color="0.7"); ax[0, 2].axhline(2, color="0.7")
        ax[0, 2].set_xlabel("valley floor elevation m"); ax[0, 2].set_ylabel("cross-section exponent b")
        ax[0, 2].set_title("valley shape: b~1 V, b~2 U")
        ax[1, 0].loglog([r["area_km2"] for r in v], [max(r["floor20_m"], 1) for r in v], ".", label="floor within +20 m")
        ax[1, 0].loglog([r["area_km2"] for r in v], [max(r["width_half_depth_m"], 1) for r in v], ".",
                        label="width at half depth")
        ax[1, 0].set_xlabel("catchment km2"); ax[1, 0].set_ylabel("m"); ax[1, 0].legend()
        ax[1, 0].set_title("valley widths")
    bands = np.arange(0, 3001, 250)
    hol = m["hollows"]
    ax[1, 1].hist([h[0] for h in hol], bins=bands, alpha=0.6, label=f"dry closed hollows ({len(hol)})")
    if m.get("lakes"):
        ax[1, 1].hist([l["elev_m"] for l in m["lakes"]], bins=bands, alpha=0.6, label=f"OSM lakes ({len(m['lakes'])})")
    ax[1, 1].set_xlabel("elevation m"); ax[1, 1].legend(); ax[1, 1].set_title("hollows and lakes by altitude")
    f = m["fans"]
    if f:
        ax[1, 2].loglog([r["trib_area_km2"] for r in f], [r["runout_m"] for r in f], ".")
        b, a = fit_loglog(np.array([r["trib_area_km2"] for r in f]), np.array([r["runout_m"] for r in f]))
        ax[1, 2].set_title(f"fans: {len(f)}, run-out ~ A^{b:.2f}")
        ax[1, 2].set_xlabel("side catchment km2"); ax[1, 2].set_ylabel("run-out m")
    fig.suptitle(f"{m['name']}  (res {m['res_m']:.0f} m, land {m['land_km2']:.0f} km2, Hack h {m['hack_h']:.2f}, "
                 f"Dd(0.5 km2) {m['drainage_density_km_per_km2']['0.5']:.2f} km/km2)")
    fig.tight_layout()
    fig.savefig(path, dpi=80)
    plt.close(fig)


def summary_row(m):
    v = m["valleys"]
    def vb(lo, hi, key="b"):
        s = [r[key] for r in v if lo <= r["area_km2"] < hi]
        return f"{np.median(s):.2f} ({len(s)})" if s else "-"
    f = m["fans"]
    lakes = m.get("lakes") or []
    high = [l for l in lakes if l["elev_m"] >= 1000]
    return {
        "region": m["name"],
        "land km2": f"{m['land_km2']:.0f}",
        "elev p50/p95 m": f"{m['elev_pct']['50']:.0f}/{m['elev_pct']['95']:.0f}",
        "slope p50/p90 deg": f"{m['slope_deg_pct']['50']:.0f}/{m['slope_deg_pct']['90']:.0f}",
        "relief 1/5 km m": f"{m['relief_1km_median_m']:.0f}/{m['relief_5km_median_m']:.0f}",
        "Flint theta": f"{m['flint_theta']:.2f}",
        "Hack h": f"{m['hack_h']:.2f}",
        "Dd 0.1/0.5/1 km/km2": "/".join(f"{m['drainage_density_km_per_km2'][k]:.2f}" for k in ("0.1", "0.5", "1.0")),
        "valley b A 1-10/10-100/100-1000/>1000": " ".join(vb(lo, hi) for lo, hi in
                                                         [(1, 10), (10, 100), (100, 1000), (1000, 1e9)]),
        "dry hollows /100 km2": f"{m['hollows_per_100km2']:.1f}",
        "lakes (>=1000 m)": f"{len(lakes)} ({len(high)})" if m.get("lakes") is not None else "-",
        "fans /100 km2": (f"{100 * len(f) / max(m['land_km2'], 1):.1f}, run-out med {np.median([r['runout_m'] for r in f]):.0f} m, "
                          f"slope med {100 * np.median([r['fan_slope'] for r in f]):.1f} %") if f else "0",
    }


# ---------------------------------------------------------------- CLI

def save(m, name):
    d = OUT / name
    d.mkdir(parents=True, exist_ok=True)
    (d / "metrics.json").write_text(json.dumps(m, default=float))
    plot_region(m, d / "metrics.png")
    if FLOW_CACHE.get(name) is not None:
        fan_map(FLOW_CACHE[name], m["fans"], d / "fans.jpg")
    print(json.dumps(summary_row(m), indent=1))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("region")
    r.add_argument("name")
    r.add_argument("--bbox", required=True, help="LAT0,LON0,LAT1,LON1")
    r.add_argument("--res", type=float, default=20.0)
    r.add_argument("--lakes", action="store_true")
    g = sub.add_parser("grid")
    g.add_argument("name")
    g.add_argument("file")
    c = sub.add_parser("compare")
    c.add_argument("names", nargs="+")
    a = ap.parse_args()

    if a.cmd == "region":
        lat0, lon0, lat1, lon1 = map(float, a.bbox.split(","))
        xa, ya = lf.TO_NZTM.transform([lon0, lon1, lon0, lon1], [lat0, lat0, lat1, lat1])
        b = (min(xa), min(ya), max(xa), max(ya))
        t = time.time()
        z, tr = lf.read_layer("dem", b, a.res)
        print(f"{a.name}: DEM {z.shape} in {time.time() - t:.0f}s, land {100 * (~np.isnan(z)).mean():.0f}%")
        lakes = None
        if a.lakes:
            lakes = osm_lakes(b, z, tr)
            print(f"  {len(lakes)} OSM lakes")
        F = Flow(z, a.res)
        FLOW_CACHE[a.name] = F
        m = measures(F, a.name, lakes)
        m["bbox"] = [lat0, lon0, lat1, lon1]
        save(m, a.name)
        print(f"  done in {time.time() - t:.0f}s")
    elif a.cmd == "grid":
        hdr = json.loads(Path(a.file).with_suffix(".json").read_text())
        z = np.fromfile(a.file, np.float32).reshape(hdr["n"], hdr["n"]).astype(np.float64)
        F = Flow(z, float(hdr["res"]))
        FLOW_CACHE[a.name] = F
        m = measures(F, a.name, None)
        save(m, a.name)
    elif a.cmd == "compare":
        ms = [json.loads((OUT / n / "metrics.json").read_text()) for n in a.names]
        rows = [summary_row(m) for m in ms]
        keys = list(rows[0].keys())
        md = "| " + " | ".join(keys) + " |\n|" + "---|" * len(keys) + "\n"
        md += "\n".join("| " + " | ".join(r[k] for k in keys) + " |" for r in rows) + "\n"
        (OUT / "summary.md").write_text(md)
        print(md)
        compare_plot(ms, OUT / "compare.png")


def compare_plot(ms, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(2, 2, figsize=(14, 10))
    for m in ms:
        x, y = m["slope_area_bins"]
        ax[0, 0].loglog(x, y, "o-", ms=3, label=m["name"])
        sl = np.array(m["slope_hist"], float)
        ax[0, 1].plot(np.arange(0, 70, 2.5) + 1.25, sl / sl.sum(), label=m["name"])
        v = m["valleys"]
        if v:
            ax[1, 0].plot([r["floor_m"] for r in v], [r["b"] for r in v], ".", label=m["name"])
        f = m["fans"]
        if f:
            ax[1, 1].loglog([r["trib_area_km2"] for r in f], [r["runout_m"] for r in f], ".", label=m["name"])
    ax[0, 0].set_xlabel("catchment km2"); ax[0, 0].set_ylabel("median slope"); ax[0, 0].legend(); ax[0, 0].set_title("slope-area")
    ax[0, 1].set_xlabel("slope deg"); ax[0, 1].set_title("slope distribution"); ax[0, 1].legend()
    ax[1, 0].set_xlabel("valley floor elevation m"); ax[1, 0].set_ylabel("b"); ax[1, 0].set_title("valley shape (b~1 V, ~2 U)")
    ax[1, 0].legend()
    ax[1, 1].set_xlabel("side catchment km2"); ax[1, 1].set_ylabel("fan run-out m"); ax[1, 1].set_title("fans"); ax[1, 1].legend()
    fig.tight_layout()
    fig.savefig(path, dpi=80)


if __name__ == "__main__":
    main()
