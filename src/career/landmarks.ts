// Landmarks for the Career (docs/career.md "Build plan", wave 4, 4b): the things a pilot can see and recognise
// from the air in this world, for landmark scenic flights (4a builds them from this list) and for the turning-point
// line of the in-flight strip. Every landmark is read from the world's own pure queries, never from the siting code
// and never by changing world state:
//
// - the town: src/world/airport/valley.ts findTownSite on the live terrain (what TerrainSystem builds the town on);
// - villages: src/world/terrain/roads.ts villageSites() (built up by valley.ts; the present day at seed 0 only, the
//   owner's choice for the road network, so other seeds have none);
// - lakes: hydrology.lakes (src/world/terrain/hydrology.ts), named as the Flight School's navigation route names
//   them (src/training/content/syllabus/route.ts: Valley Lake, Foothill Lake; the alpine tarn and the glacial lake);
// - oxbow lakes: hydrology.oxbows (the crescent lakes the meandering river has cut off);
// - river bends: the river channel's horseshoe loops (hydrology.river), where the channel runs RIVER_BEND.arcM
//   round a neck no wider than arcM / RIVER_BEND.minSinuosity; the point is the middle of the loop;
// - road bridges: riverCrossings() (src/world/airport/bridges.ts builds a bridge at each; seed 0 only, as villages);
// - summits: tops of terrainHeight found on a SUMMIT.gridM grid out to SUMMIT.reachM from the home field, standing
//   at least SUMMIT.minProminenceM above the lowest ground SUMMIT.windowCells cells round them, climbed to the top.
//
// Every landmark is at least BOARD_RULES.scenicFieldClearM (2 NM) from every field passed in, clear of the ATZs and
// the AI circuits. An area feature whose centre is closer (the town at seeds 0 and 7 lies 3.4 km from Fable
// Regional) is moved straight away from the nearest field by the least distance that clears it, when that stays over
// the feature (the town's built-up core, AREA_NUDGE; a lake's open water); otherwise it is left out. Features with no
// name of their own are named by the nearest field: "Village 3 NM north-east of Elmley".
//
// API (what 4a builds on): `landmarks(fields)` the list (deterministic per world seed and fields; cached), `Landmark`
// with a stable `id` (kind and the feature's own index in its source, so ids survive a feature being left out),
// `nearestLandmark(north, east, list)`, and `landmarkWaypoint(l)` (a scenic turning point over it, named after it).
// The era is present-day only (the Career's world); in other eras the list is empty.
//
// Pure (no DOM); valley.ts brings three.js in as it does for tests/airport/valley.test.ts, but nothing is drawn.

import { FT, NM } from '../core/math';
import { era, isPresent } from '../world/era/eraState';
import type { Airfield } from '../world/airfields';
import { findTownSite } from '../world/airport/valley';
import { hydrology, terrainHeight } from '../world/terrain/heightfield';
import { lakeRadius, type Lake } from '../world/terrain/hydrology';
import { riverCrossings, villageSites } from '../world/terrain/roads';
import { worldSeed } from '../world/worldSeed';
import { bearingDeg, compassName, nearestField, placeName, type NedPoint } from './geo';
import { BOARD_RULES, type Waypoint } from './types';

/** What a landmark is. */
export type LandmarkKind = 'town' | 'village' | 'lake' | 'oxbow' | 'riverBend' | 'bridge' | 'summit';

/** A landmark: a feature seen from the air, with the point a turning point over it is placed on. */
export interface Landmark {
  /** Stable within a world: `town`, `village-<i>`, `lake-<i>`, `oxbow-<i>`, `bend-<i>`, `bridge-<i>`, `summit-<i>`. */
  id: string;
  kind: LandmarkKind;
  /** Unique within the list ("Valley Lake", "Village 3 NM north-east of Elmley", "Summit 4,210 ft, 6 NM west of Dundale"). */
  name: string;
  /** The point over the feature, NED m. */
  north: number;
  east: number;
  /** The ground or water there, m MSL (a summit: its top; a lake: its water level). */
  elevationM: number;
  /** Rough size of the feature about the point (half its width), m. */
  radiusM: number;
}

/** Lake names by hydrology.lakes index (hydrology.ts LAKE_DEFS order; tests pin each to its position). */
export const LAKE_NAMES: readonly string[] = ['Valley Lake', 'Foothill Lake', 'Alpine Tarn', 'Glacial Lake'];

/**
 * Horseshoe loops of the river: the channel runs arcM (centred on the apex) round a neck no wider than
 * arcM / minSinuosity; loops closer than spacingM to a more pronounced one are left out.
 */
export const RIVER_BEND = { arcM: 1200, minSinuosity: 2.5, spacingM: 2000 } as const;

/**
 * Summits: a grid of gridM out to reachM north and east of the home field (past the generated fields' ring); a top
 * is the highest cell within windowCells cells and stands minProminenceM above the lowest of them; then climbed in
 * steps from a quarter of the grid size, halved down to finalStepM.
 */
export const SUMMIT = { gridM: 1000, reachM: 50000, windowCells: 4, minProminenceM: 150, finalStepM: 25 } as const;

/**
 * How far an area feature's point may move from its centre to clear the fields, as a share of its size: the town
 * up to its always-built-up core (townMask.ts: the edge lies between 0.44 and 1.0 of the radius); a lake while the
 * point stays on open water (lakeRadius below lakeWater).
 */
export const AREA_NUDGE = { town: 0.44, lake: 0.6, lakeWater: 0.85 } as const;

/** A bridge and its ramps, m (about half its length). */
const BRIDGE_SIZE_M = 60;
/** A summit's size about its top, m. */
const SUMMIT_SIZE_M = 500;

/** "4,210" for 4210. */
function thousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
}

/** The least distance from a point to any field's runway centre, m (Infinity with no fields). */
function fieldClearance(p: NedPoint, fields: readonly Airfield[]): number {
  let d = Infinity;
  for (const f of fields) d = Math.min(d, Math.hypot(f.north - p.north, f.east - p.east));
  return d;
}

/**
 * The point to use for an area feature centred at `c`: `c` itself when clear of every field, else `c` moved straight
 * away from the nearest field by the least distance that clears it (plus a metre), when that is within `maxM` and
 * `ok` holds there; null when it cannot be cleared.
 */
function clearPoint(c: NedPoint, fields: readonly Airfield[], maxM: number, ok: (p: NedPoint) => boolean = () => true): NedPoint | null {
  const clear = BOARD_RULES.scenicFieldClearM;
  if (fieldClearance(c, fields) >= clear) return c;
  const near = nearestField(c.north, c.east, fields);
  if (!near || near.distanceM === 0) return null;
  const move = clear - near.distanceM + 1;
  if (move > maxM) return null;
  const k = move / near.distanceM;
  const p = { north: c.north + (c.north - near.field.north) * k, east: c.east + (c.east - near.field.east) * k };
  return fieldClearance(p, fields) >= clear && ok(p) ? p : null;
}

/** "3 NM north-east of Elmley" from the nearest field (whole NM, or tenths when `fine`). */
function relativeTo(p: NedPoint, fields: readonly Airfield[], fine = false): string {
  const near = nearestField(p.north, p.east, fields);
  if (!near) return '';
  const nm = near.distanceM / NM;
  const d = fine ? (Math.round(nm * 10) / 10).toFixed(1) : String(Math.round(nm));
  return `${d} NM ${compassName(bearingDeg(near.field, p))} of ${placeName(near.field)}`;
}

/** A landmark under construction: its name is made from `prefix` and its place unless `fixedName` is given. */
interface Draft extends Omit<Landmark, 'name'> {
  prefix: string;
  fixedName?: string;
}

/** The river's horseshoe loops: the middle of each loop (the mean of its arc's points) and its arc position. */
function riverBends(): { north: number; east: number; s: number; sinuosity: number }[] {
  const r = hydrology.river;
  const n = r.north.length;
  if (n < 3) return [];
  const half = RIVER_BEND.arcM / 2;
  const found: { north: number; east: number; s: number; sinuosity: number }[] = [];
  let lo = 0;
  let hi = 0;
  let run: { north: number; east: number; s: number; sinuosity: number } | null = null;
  for (let i = 0; i < n; i++) {
    while (r.s[i] - r.s[lo] > half) lo++;
    while (hi < n - 1 && r.s[hi] - r.s[i] < half) hi++;
    // Only where the whole arc lies on the river (not cut short at its source or mouth).
    const full = r.s[i] >= half && r.s[n - 1] - r.s[i] >= half;
    const chord = Math.hypot(r.north[hi] - r.north[lo], r.east[hi] - r.east[lo]);
    const sinuosity = full ? (r.s[hi] - r.s[lo]) / Math.max(chord, 1) : 0;
    if (sinuosity >= RIVER_BEND.minSinuosity) {
      if (!run || sinuosity > run.sinuosity) {
        let sn = 0;
        let se = 0;
        for (let j = lo; j <= hi; j++) {
          sn += r.north[j];
          se += r.east[j];
        }
        const k = hi - lo + 1;
        run = { north: sn / k, east: se / k, s: r.s[i], sinuosity };
      }
    } else if (run) {
      found.push(run);
      run = null;
    }
  }
  if (run) found.push(run);
  // The most pronounced first; a loop within spacingM of one already kept is the same bend seen again.
  const kept: typeof found = [];
  for (const b of [...found].sort((a, c) => c.sinuosity - a.sinuosity || a.s - c.s)) {
    if (kept.every((k) => Math.hypot(k.north - b.north, k.east - b.east) >= RIVER_BEND.spacingM)) kept.push(b);
  }
  return kept.sort((a, c) => a.s - c.s);
}

/** Summit tops: grid maxima with their prominence, climbed to the top; highest first. */
function summits(): { north: number; east: number; top: number }[] {
  const { gridM: g, reachM, windowCells: w, minProminenceM, finalStepM } = SUMMIT;
  const cells = Math.round(reachM / g);
  const side = 2 * cells + 1;
  const h = new Float64Array(side * side);
  for (let a = 0; a < side; a++) for (let b = 0; b < side; b++) h[a * side + b] = terrainHeight((a - cells) * g, (b - cells) * g);
  const tops: { north: number; east: number; top: number }[] = [];
  for (let a = w; a < side - w; a++) {
    for (let b = w; b < side - w; b++) {
      const c = h[a * side + b];
      let highest = true;
      let rim = Infinity;
      for (let i = -w; i <= w && highest; i++) {
        for (let j = -w; j <= w; j++) {
          if (i === 0 && j === 0) continue;
          const v = h[(a + i) * side + b + j];
          if (v >= c) {
            highest = false;
            break;
          }
          rim = Math.min(rim, v);
        }
      }
      if (!highest || c - rim < minProminenceM) continue;
      // Climb to the top: the highest of the eight neighbours at each step, halving the step when none is higher.
      let n = (a - cells) * g;
      let e = (b - cells) * g;
      let top = c;
      for (let step = g / 4; ; step = Math.max(finalStepM, step / 2)) {
        for (let moved = true, guard = 0; moved && guard < 64; guard++) {
          moved = false;
          for (let k = 0; k < 8; k++) {
            const ang = (k / 8) * Math.PI * 2;
            const pn = n + Math.cos(ang) * step;
            const pe = e + Math.sin(ang) * step;
            const v = terrainHeight(pn, pe);
            if (v > top) {
              top = v;
              n = pn;
              e = pe;
              moved = true;
            }
          }
        }
        if (step === finalStepM) break;
      }
      tops.push({ north: n, east: e, top });
    }
  }
  return tops.sort((x, y) => y.top - x.top || x.north - y.north || x.east - y.east);
}

/** The drafts, in kind order (town, villages, lakes, oxbows, river bends, bridges, summits). */
function drafts(fields: readonly Airfield[]): Draft[] {
  const out: Draft[] = [];
  const home = fields.find((f) => f.kind === 'home');

  const town = findTownSite(terrainHeight);
  if (town) {
    const p = clearPoint(town, fields, AREA_NUDGE.town * town.radius);
    if (p) {
      out.push({
        id: 'town', kind: 'town', prefix: 'Town', fixedName: home ? `${placeName(home)} town` : undefined,
        ...p, elevationM: terrainHeight(p.north, p.east), radiusM: town.radius,
      });
    }
  }

  villageSites().forEach((v, i) => {
    const p = clearPoint(v, fields, 0);
    if (p) out.push({ id: `village-${i}`, kind: 'village', prefix: 'Village', ...p, elevationM: terrainHeight(p.north, p.east), radiusM: v.radius });
  });

  hydrology.lakes.forEach((lake: Lake, i) => {
    const size = Math.min(lake.radiusA, lake.radiusB);
    const p = clearPoint(lake, fields, AREA_NUDGE.lake * size, (q) => lakeRadius(lake, q.north, q.east) < AREA_NUDGE.lakeWater);
    if (p) {
      out.push({
        id: `lake-${i}`, kind: 'lake', prefix: 'Lake', fixedName: LAKE_NAMES[i],
        ...p, elevationM: lake.level, radiusM: Math.max(lake.radiusA, lake.radiusB),
      });
    }
  });

  hydrology.oxbows.forEach((o, i) => {
    const m = o.north.length;
    if (m === 0) return;
    const mid = { north: o.north[m >> 1], east: o.east[m >> 1] };
    let reach = 0;
    for (let j = 0; j < m; j++) reach = Math.max(reach, Math.hypot(o.north[j] - mid.north, o.east[j] - mid.east));
    if (fieldClearance(mid, fields) >= BOARD_RULES.scenicFieldClearM) {
      out.push({ id: `oxbow-${i}`, kind: 'oxbow', prefix: 'Oxbow lake', ...mid, elevationM: o.level, radiusM: reach / 2 });
    }
  });

  riverBends().forEach((b, i) => {
    if (fieldClearance(b, fields) >= BOARD_RULES.scenicFieldClearM) {
      out.push({ id: `bend-${i}`, kind: 'riverBend', prefix: 'River bend', north: b.north, east: b.east, elevationM: terrainHeight(b.north, b.east), radiusM: RIVER_BEND.arcM / Math.PI });
    }
  });

  riverCrossings().forEach((x, i) => {
    if (fieldClearance(x, fields) >= BOARD_RULES.scenicFieldClearM) {
      out.push({ id: `bridge-${i}`, kind: 'bridge', prefix: 'Road bridge', north: x.north, east: x.east, elevationM: terrainHeight(x.north, x.east), radiusM: BRIDGE_SIZE_M });
    }
  });

  summits().forEach((s, i) => {
    if (fieldClearance(s, fields) >= BOARD_RULES.scenicFieldClearM) {
      out.push({
        id: `summit-${i}`, kind: 'summit', prefix: `Summit ${thousands(Math.round(s.top / FT / 10) * 10)} ft,`,
        north: s.north, east: s.east, elevationM: s.top, radiusM: SUMMIT_SIZE_M,
      });
    }
  });
  return out;
}

/** Names the drafts: fixed names as given; the rest "<prefix> N NM <compass> of <field>", in tenths where whole NM would repeat a name. */
function named(list: readonly Draft[], fields: readonly Airfield[]): Landmark[] {
  const coarse = list.map((d) => d.fixedName ?? `${d.prefix} ${relativeTo(d, fields)}`);
  const count = new Map<string, number>();
  for (const n of coarse) count.set(n, (count.get(n) ?? 0) + 1);
  const names = list.map((d, i) => ((count.get(coarse[i]) ?? 0) > 1 && !d.fixedName ? `${d.prefix} ${relativeTo(d, fields, true)}` : coarse[i]));
  // Anything still repeated (two features within a tenth of a NM in the same direction) takes a number.
  const seen = new Map<string, number>();
  return list.map((d, i) => {
    const k = (seen.get(names[i]) ?? 0) + 1;
    seen.set(names[i], k);
    const { prefix: _p, fixedName: _f, ...l } = d;
    return { ...l, name: k > 1 ? `${names[i]} (${k})` : names[i] };
  });
}

let cache: { key: string; list: readonly Landmark[] } | null = null;

/**
 * The world's landmarks seen from the fields given (the Career passes airfields()): every one at least
 * BOARD_RULES.scenicFieldClearM from every field, in kind order (town, villages, lakes, oxbows, river bends,
 * bridges, summits, the summits highest first). Deterministic for a world seed and the fields; cached on both (and
 * the era). Empty outside the present day.
 */
export function landmarks(fields: readonly Airfield[]): readonly Landmark[] {
  if (!isPresent()) return [];
  const key = `${era().id}|${worldSeed()}|${fields.map((f) => `${f.code}:${f.north}:${f.east}`).join(',')}`;
  if (cache?.key === key) return cache.list;
  const list = Object.freeze(named(drafts(fields), fields).map((l) => Object.freeze(l)));
  cache = { key, list };
  return list;
}

/** The landmark nearest a point, with its distance (m), within `maxM` (default: any); null when none. Ties: the first. */
export function nearestLandmark(north: number, east: number, list: readonly Landmark[], maxM = Infinity): { landmark: Landmark; distanceM: number } | null {
  let best: { landmark: Landmark; distanceM: number } | null = null;
  for (const l of list) {
    const d = Math.hypot(l.north - north, l.east - east);
    if (d <= maxM && (!best || d < best.distanceM)) best = { landmark: l, distanceM: d };
  }
  return best;
}

/** A scenic turning point over a landmark, named after it, with the board's capture radius and height (BOARD_RULES). */
export function landmarkWaypoint(l: Landmark): Waypoint {
  return { name: l.name, north: l.north, east: l.east, radiusM: BOARD_RULES.scenicRadiusM, maxAglFt: BOARD_RULES.scenicMaxAglFt };
}
