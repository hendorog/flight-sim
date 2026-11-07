#!/usr/bin/env python3
"""Landform study fetch tool: LINZ open aerial imagery + lidar DEM (CC BY 4.0, "Sourced from LINZ").

Learning only: what we measure here becomes rules, size ranges and looks for the seeded generator; no NZ terrain or
imagery goes into the sim.

Data: public S3 buckets nz-imagery / nz-elevation (STAC catalogues, Cloud-Optimised GeoTIFFs in NZTM EPSG:2193).
Only the windows we need are read, at the overview level that matches the requested resolution.

  lf.py catalog                         index every collection (cached in cache/catalog.json)
  lf.py fetch NAME --center LAT,LON --size W[xH] --res R --layer ortho|dem|dsm|sat [--hillshade]
  lf.py river NAME "Rakaia River"       OSM river line (Overpass), ordered downstream, saved as GeoJSON (NZTM)

Python API (used by the study scripts): read_layer(layer, bounds_nztm, res) -> (array, transform)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

os.environ.setdefault("AWS_NO_SIGN_REQUEST", "YES")
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tiff,.tif")
os.environ.setdefault("GDAL_HTTP_MULTIPLEX", "YES")
os.environ.setdefault("GDAL_HTTP_VERSION", "2")
os.environ.setdefault("VSI_CACHE", "TRUE")
os.environ.setdefault("GDAL_CACHEMAX", "512")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "4")
os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "1")

import numpy as np
import rasterio
import requests
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.windows import from_bounds

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "cache"
DATA = ROOT / "data"
UA = {"User-Agent": "fs-landform-study/0.1 (research script)"}
BUCKETS = {"nz-imagery": "https://nz-imagery.s3-ap-southeast-2.amazonaws.com",
           "nz-elevation": "https://nz-elevation.s3-ap-southeast-2.amazonaws.com"}
TO_NZTM = Transformer.from_crs(4326, 2193, always_xy=True)
TO_WGS = Transformer.from_crs(2193, 4326, always_xy=True)
SESSION = requests.Session()
SESSION.headers.update(UA)


def get_json(url: str, retries: int = 4):
    for i in range(retries):
        try:
            r = SESSION.get(url, timeout=60)
            r.raise_for_status()
            return r.json()
        except Exception:
            if i == retries - 1:
                raise
            time.sleep(1.5 * (i + 1))


# ---------------------------------------------------------------- catalogue

def catalog(refresh: bool = False) -> list[dict]:
    path = CACHE / "catalog.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    CACHE.mkdir(parents=True, exist_ok=True)
    jobs = []
    for bucket, base in BUCKETS.items():
        root = get_json(f"{base}/catalog.json")
        for l in root["links"]:
            if l["rel"] == "child":
                jobs.append((bucket, base, l["href"].lstrip("./")))

    def one(job):
        bucket, base, rel = job
        try:
            c = get_json(f"{base}/{rel}")
        except Exception as e:  # noqa: BLE001
            return {"bucket": bucket, "path": rel, "error": str(e)}
        d = rel.rsplit("/", 1)[0]
        ext = c.get("extent", {})
        bbox = ext.get("spatial", {}).get("bbox", [[None] * 4])[0]
        interval = ext.get("temporal", {}).get("interval", [[None, None]])[0]
        years = [int(t[:4]) for t in interval if t]
        return {"bucket": bucket, "dir": d, "title": c.get("title"), "gsd": c.get("gsd"),
                "bbox": bbox, "years": years, "kind": d.split("/")[-2] if "/" in d else "",
                "items": [l["href"].lstrip("./") for l in c["links"] if l["rel"] == "item"]}

    with ThreadPoolExecutor(32) as ex:
        out = [r for r in ex.map(one, jobs)]
    path.write_text(json.dumps(out))
    print(f"catalogue: {len(out)} collections ({sum('error' in o for o in out)} failed)")
    return out


def items(coll: dict) -> list[dict]:
    """Item footprints (NZTM bounds from the WGS84 bbox, padded) of a collection, cached."""
    key = re.sub(r"[^a-zA-Z0-9]+", "_", coll["bucket"] + "_" + coll["dir"])
    path = CACHE / "items" / f"{key}.json"
    if path.exists():
        return json.loads(path.read_text())
    path.parent.mkdir(parents=True, exist_ok=True)
    base = f"{BUCKETS[coll['bucket']]}/{coll['dir']}"

    def one(href):
        it = get_json(f"{base}/{href}")
        asset = next(iter(it["assets"].values()))["href"].lstrip("./")
        return {"bbox": it["bbox"], "href": f"{base}/{asset}"}

    with ThreadPoolExecutor(32) as ex:
        out = list(ex.map(one, coll["items"]))
    path.write_text(json.dumps(out))
    return out


def wgs_bbox_of(bounds):
    x0, y0, x1, y1 = bounds
    xs, ys = TO_WGS.transform([x0, x1, x0, x1], [y0, y0, y1, y1])
    return min(xs), min(ys), max(xs), max(ys)


def overlaps(a, b):
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def collections_for(layer: str, bounds) -> list[dict]:
    """Collections to mosaic for a layer, best first (newest, then finest)."""
    cat = [c for c in catalog() if "error" not in c and c.get("bbox") and c["bbox"][0] is not None]
    wb = wgs_bbox_of(bounds)
    if layer in ("dem", "dsm"):
        # National lidar composite first; the 8 m contour-derived DEM fills what the lidar has not covered.
        want = [f"new-zealand/new-zealand/{layer}_1m/2193", "new-zealand/new-zealand-contour/dem_8m/2193"]
        return [c for w in want for c in cat if c["bucket"] == "nz-elevation" and c["dir"] == w]
    if layer == "sat":
        sats = [c for c in cat if c["bucket"] == "nz-imagery" and re.search(r"new-zealand_\d{4}-\d{4}_10m/rgb", c["dir"])]
        return sorted(sats, key=lambda c: -max(c["years"] or [0]))[:2]
    if layer == "ortho":
        cands = []
        for c in cat:
            if c["bucket"] != "nz-imagery" or "/rgb/" not in c["dir"] + "/":
                continue
            if re.search(r"_sn|snc\d|new-zealand_|north-island_|nearshore", c["dir"]):
                continue  # historic survey runs and the 10 m mosaics
            if not c["years"] or max(c["years"]) < 2015 or (c["gsd"] or 9) > 0.5:
                continue
            if overlaps(c["bbox"], wb):
                cands.append(c)
        # Newest first; among equals the coarser (rural) set first, it is the one that covers whole areas.
        return sorted(cands, key=lambda c: (-max(c["years"]), -(c["gsd"] or 0)))
    raise ValueError(layer)


# ---------------------------------------------------------------- reading

def read_layer(layer: str, bounds, res: float, max_collections: int = 4):
    """Mosaic of `layer` over NZTM bounds (x0, y0, x1, y1) at `res` m. Returns (array, transform).
    ortho/sat: uint8 (H, W, 4) RGBA (alpha 0 = no data); dem/dsm: float32 (H, W), NaN = no data."""
    x0, y0, x1, y1 = bounds
    w = int(round((x1 - x0) / res))
    h = int(round((y1 - y0) / res))
    tr = from_origin(x0, y1, res, res)
    rgb = layer in ("ortho", "sat")
    out = np.zeros((h, w, 4), np.uint8) if rgb else np.full((h, w), np.nan, np.float32)
    wb = wgs_bbox_of(bounds)
    used = 0
    colls = collections_for(layer, bounds)
    if layer == "ortho":
        colls = sorted(colls, key=lambda c: -int(_coverage(c, wb) > 0.98))  # stable: newest full cover first
    for coll in colls:
        hits = [it for it in items(coll) if overlaps(it["bbox"], wb)]
        if not hits:
            continue
        used += 1
        for it in hits:
            _paint(it["href"], bounds, res, out, rgb)
        if (rgb and out[..., 3].min() > 0) or (not rgb and not np.isnan(out).any()):
            break
        if used >= max_collections:
            break
    return out, tr


def _coverage(coll, wb, n=40):
    """Fraction of the WGS84 box wb covered by a collection's item footprints (coarse raster of item bboxes)."""
    xs = np.linspace(wb[0], wb[2], n)
    ys = np.linspace(wb[1], wb[3], n)
    X, Y = np.meshgrid(xs, ys)
    cov = np.zeros(X.shape, bool)
    for it in items(coll):
        b = it["bbox"]
        if overlaps(b, wb):
            cov |= (X >= b[0]) & (X <= b[2]) & (Y >= b[1]) & (Y <= b[3])
    return cov.mean()


def _paint(href, bounds, res, out, rgb):
    x0, y0, x1, y1 = bounds
    with rasterio.open("/vsicurl/" + href) as src:
        b = src.bounds
        ix0, iy0, ix1, iy1 = max(x0, b.left), max(y0, b.bottom), min(x1, b.right), min(y1, b.top)
        if ix0 >= ix1 or iy0 >= iy1:
            return
        c0 = int(round((ix0 - x0) / res)); c1 = int(round((ix1 - x0) / res))
        r0 = int(round((y1 - iy1) / res)); r1 = int(round((y1 - iy0) / res))
        if c1 <= c0 or r1 <= r0:
            return
        win = from_bounds(ix0, iy0, ix1, iy1, src.transform)
        shape = (r1 - r0, c1 - c0)
        if rgb:
            a = src.read(out_shape=(src.count,) + shape, window=win, resampling=Resampling.average)
            a = np.moveaxis(a, 0, -1)
            if a.shape[-1] == 3:
                a = np.concatenate([a, np.full(shape + (1,), 255, np.uint8)], -1)
            dst = out[r0:r1, c0:c1]
            fill = (dst[..., 3] == 0) & (a[..., 3] > 0)
            dst[fill] = a[fill]
        else:
            a = src.read(1, out_shape=shape, window=win, resampling=Resampling.average).astype(np.float32)
            nd = src.nodata
            if nd is not None:
                a[a <= nd + 1] = np.nan
            dst = out[r0:r1, c0:c1]
            fill = np.isnan(dst) & ~np.isnan(a)
            dst[fill] = a[fill]


# ---------------------------------------------------------------- helpers

def hillshade(z: np.ndarray, res: float, az: float = 315, alt: float = 40, exag: float = 1.0) -> np.ndarray:
    zz = np.where(np.isnan(z), np.nanmean(z), z) * exag
    gy, gx = np.gradient(zz, res)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    a, e = np.radians(az), np.radians(alt)
    hs = np.sin(e) * np.cos(slope) + np.cos(e) * np.sin(slope) * np.cos(a - aspect)
    hs = np.clip(hs, 0, 1)
    hs[np.isnan(z)] = 0
    return (hs * 255).astype(np.uint8)


def save_png(arr, path):
    from PIL import Image
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr).save(path)


def save_tif(arr, tr, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    if arr.ndim == 3:
        a = np.moveaxis(arr, -1, 0)
        prof = dict(driver="GTiff", height=a.shape[1], width=a.shape[2], count=a.shape[0], dtype="uint8",
                    crs="EPSG:2193", transform=tr, compress="deflate")
    else:
        a = arr[None]
        prof = dict(driver="GTiff", height=a.shape[1], width=a.shape[2], count=1, dtype="float32",
                    crs="EPSG:2193", transform=tr, compress="deflate", nodata=np.nan)
    with rasterio.open(path, "w", **prof) as d:
        d.write(a)


def center_bounds(lat, lon, w, h):
    x, y = TO_NZTM.transform(lon, lat)
    return (x - w / 2, y - h / 2, x + w / 2, y + h / 2)


# ---------------------------------------------------------------- rivers (OSM line, learning only)

def river_line(name: str, refresh: bool = False):
    """Downstream-ordered NZTM polyline of a named NZ river from OpenStreetMap (ODbL), longest connected chain."""
    key = re.sub(r"[^a-zA-Z0-9]+", "_", name)
    path = CACHE / "rivers" / f"{key}.json"
    if path.exists() and not refresh:
        return np.array(json.loads(path.read_text()))
    sel = f'["name"~"{name[1:]}"]' if name.startswith("~") else f'["name"="{name}"]'
    q = f'[out:json][timeout:120];area["ISO3166-1"="NZ"]->.nz;way["waterway"="river"]{sel}(area.nz);out geom;'
    for attempt in range(5):
        try:
            r = SESSION.post("https://overpass-api.de/api/interpreter", data={"data": q}, timeout=180)
            r.raise_for_status()
            break
        except Exception:  # noqa: BLE001
            if attempt == 4:
                raise
            time.sleep(20 * (attempt + 1))
    ways = [[(p["lon"], p["lat"]) for p in e["geometry"]] for e in r.json()["elements"] if e.get("geometry")]
    if not ways:
        raise SystemExit(f"no OSM ways named {name!r}")
    # OSM waterways point downstream. Chain ways whose end meets another's start; keep the longest chain.
    starts = {}
    for i, w in enumerate(ways):
        starts.setdefault(w[0], []).append(i)
    ends = {w[-1] for w in ways}

    def length(pts):
        a = np.array(TO_NZTM.transform(*zip(*pts))).T
        return float(np.hypot(*np.diff(a, axis=0).T).sum())

    best, best_len = None, -1
    for i, w in enumerate(ways):
        if w[0] in ends:
            continue  # not a head
        chain, used, cur = list(w), {i}, w
        while True:
            nxt = [j for j in starts.get(cur[-1], []) if j not in used]
            if not nxt:
                break
            j = max(nxt, key=lambda k: length(ways[k]))
            used.add(j)
            chain += ways[j][1:]
            cur = ways[j]
        L = length(chain)
        if L > best_len:
            best, best_len = chain, L
    xy = np.array(TO_NZTM.transform(*zip(*best))).T
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(xy.round(1).tolist()))
    return xy


# ---------------------------------------------------------------- CLI

def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("catalog").add_argument("--refresh", action="store_true")
    f = sub.add_parser("fetch")
    f.add_argument("name")
    f.add_argument("--center", required=True, help="LAT,LON")
    f.add_argument("--size", required=True, help="W or WxH metres")
    f.add_argument("--res", type=float, required=True)
    f.add_argument("--layer", default="ortho", choices=["ortho", "dem", "dsm", "sat"])
    f.add_argument("--hillshade", action="store_true")
    rv = sub.add_parser("river")
    rv.add_argument("name")
    rv.add_argument("osm_name")
    a = ap.parse_args()

    if a.cmd == "catalog":
        cat = catalog(refresh=a.refresh)
        kinds = {}
        for c in cat:
            kinds[(c["bucket"], c.get("kind"))] = kinds.get((c["bucket"], c.get("kind")), 0) + 1
        print(json.dumps({f"{k[0]}:{k[1]}": v for k, v in sorted(kinds.items(), key=str)}, indent=1))
    elif a.cmd == "fetch":
        lat, lon = map(float, a.center.split(","))
        w, h = (map(float, a.size.split("x")) if "x" in a.size else (float(a.size),) * 2)
        b = center_bounds(lat, lon, w, h)
        t = time.time()
        arr, tr = read_layer(a.layer, b, a.res)
        d = DATA / a.name
        save_tif(arr, tr, d / f"{a.layer}.tif")
        if arr.ndim == 3:
            save_png(arr[..., :3], d / f"{a.layer}.png")
            print(f"{a.layer} {arr.shape} coverage {100 * (arr[..., 3] > 0).mean():.1f}% in {time.time() - t:.1f}s -> {d}")
        else:
            if a.hillshade:
                save_png(hillshade(arr, a.res), d / f"{a.layer}_hillshade.png")
            print(f"{a.layer} {arr.shape} {np.nanmin(arr):.1f}..{np.nanmax(arr):.1f} m, "
                  f"coverage {100 * (~np.isnan(arr)).mean():.1f}% in {time.time() - t:.1f}s -> {d}")
    elif a.cmd == "river":
        xy = river_line(a.osm_name, refresh=True)
        L = np.hypot(*np.diff(xy, axis=0).T).sum()
        print(f"{a.osm_name}: {len(xy)} points, {L / 1000:.1f} km, from {xy[0].round()} to {xy[-1].round()}")


if __name__ == "__main__":
    sys.exit(main())
