// Probe (Round V step 0, PLAN-V section 2 item 3): ruleFires - one row per rule of map 2's catalogue
// (design-V/map/rules.md: 203 counted rows + 5 infrastructure rows, plus its appendix B), and how often each fired
// in the build, per seed. No src change: every count is read from what a build already exposes or can be heard from
// a probe. Each row says how it was counted:
//   report   a counter the build keeps (hydrology.streamReport and its shape / pitch / feed / chains / surface parts,
//            LakeMask, Drainage.cutWhy, slopeStats, fieldHeldCount);
//   stage    levelProbe's stages A..E on the rivers' valley axes (samples whose level the stage changed, by > 1 cm);
//   hook     a call heard through vi.mock or a class prototype, attributed to the src line that made it (the line is
//            found by a text anchor at run time; "gone" when the anchor is no longer in the src: the rule was deleted).
//            riverNetwork.ts and heightfield.ts are never mocked here, so their lines are the src's; callers inside a
//            mocked module (drainage, streams) are told apart by file and function instead;
//   derived  recomputed from the build's output (what the rule acted on, not the rule's own counter);
//   box      sample-time rules (the terrain carve, heightfield.ts carveNetwork): heard while terrainHeight samples the
//            owner's box (RF_BOX, default -12200,-41300,3000 at 25 m), so a rate per box, not a build total;
//   n/o      not observable without a src counter (internal to one function, or fires at render time only).
//   RF_SEEDS=1,42,777777 RF_OUT=dir npx vitest run --config scripts/probes/vitest.config.ts ruleFires --silent=false --disable-console-intercept
import { it, vi } from 'vitest';

/** Hook state, shared with the vi.mock factories (hoisted above the imports). */
const HK = vi.hoisted(() => {
  const hits = new Map<string, number>();
  /** The src line (file:line, under src/world/terrain) that called the hooked function. (A module the probe mocks is
   * loaded without its source map, so its own lines are not the src's: callers in a mocked module are told apart by
   * file and function name, `fnSite`, never by line.) */
  const frame = (): { file: string; line: string; fn: string } => {
    const st = new Error().stack?.split('\n') ?? [];
    const parse = (l: string): { fn: string; file: string; line: string } | null => {
      const m = l.match(/at (?:new )?(\S+) \((.*)\)$/) ?? l.match(/at ()(.*)$/);
      const q = m?.[2].match(/\/src\/world\/terrain\/([A-Za-z0-9_]+\.ts)[^:]*:(\d+)/);
      return m && q ? { fn: m[1], file: q[1], line: q[2] } : null;
    };
    for (let i = 2; i < st.length; i++) {
      const f = parse(st[i]);
      if (!f) continue;
      // An anonymous callback (a forEach's): the function round it, the next named frame in the same file.
      for (let j = i; !f.fn && j < st.length; j++) {
        const g = parse(st[j]);
        if (g && g.file === f.file && g.fn) f.fn = g.fn;
      }
      return f;
    }
    return { fn: '?', file: '?', line: '?' };
  };
  const site = (): string => {
    const f = frame();
    return `${f.file}:${f.line}`;
  };
  const fnSite = (): string => {
    const f = frame();
    return `${f.file}#${f.fn}`;
  };
  const bump = (k: string, v = 1): void => {
    hits.set(k, (hits.get(k) ?? 0) + v);
  };
  return {
    hits,
    site,
    fnSite,
    bump,
    /** buildDrainage's `routing` (Round V A1), heard in the drainage mock. */
    routing: null as Float32Array | null,
    /** confineBelt's window (riverNetwork.ts): from levelProbe 'E' of the first line until the first ground sample
     * after the last line's that confineBelt did not ask for. Within it, the points confineBelt asked the ground at
     * (heard at the macro cache, seededLayout.ts, which every natural ground sample starts with), by line. */
    inE: false,
    eLi: -1,
    eLast: -1,
    cbPts: new Map<number, number[]>(),
  };
});

vi.mock('../../src/world/terrain/streams', async (orig) => {
  const o = (await orig()) as Record<string, unknown>;
  const breachOfCut = o.breachOfCut as (c: number) => number;
  const refineSteep = o.refineSteep as (...a: unknown[]) => unknown;
  return {
    ...o,
    breachOfCut: (c: number): number => {
      HK.bump(`breachOfCut@${HK.site()}`);
      return breachOfCut(c);
    },
    refineSteep: (...a: unknown[]): unknown => {
      HK.bump(`refineSteep@${HK.site()}`);
      return refineSteep(...a);
    },
  };
});
vi.mock('../../src/world/terrain/erosion', async (orig) => {
  const o = (await orig()) as Record<string, unknown>;
  const markCourse = o.markCourse as (f: { course?: Uint8Array | Float32Array }, axes: ReadonlyArray<{ north: ArrayLike<number> }>, ...r: unknown[]) => unknown;
  return {
    ...o,
    markCourse: (f: { course?: Uint8Array | Float32Array }, axes: ReadonlyArray<{ north: ArrayLike<number> }>, ...r: unknown[]): unknown => {
      const before = f.course ? f.course.slice() : null;
      const out = markCourse(f, axes, ...r);
      HK.bump('markCourse.calls');
      HK.bump('markCourse.axes', axes.length);
      HK.bump('markCourse.samples', axes.reduce((a, x) => a + x.north.length, 0));
      if (before && f.course) {
        let ch = 0;
        for (let q = 0; q < before.length; q++) if (f.course[q] !== before[q]) ch++;
        HK.bump('markCourse.cells', ch);
      }
      return out;
    },
  };
});
vi.mock('../../src/world/terrain/hillslopes', async (orig) => {
  const o = (await orig()) as Record<string, unknown>;
  const riverCore = o.riverCore as (...a: unknown[]) => Uint8Array;
  return {
    ...o,
    riverCore: (...a: unknown[]): Uint8Array => {
      const at = HK.site();
      const r = riverCore(...a);
      let held = 0, any = 0;
      for (let q = 0; q < r.length; q++) {
        if (r[q] > 0) any++;
        if (r[q] >= 250) held++;
      }
      HK.bump(`riverCore@${at}.held`, held);
      HK.bump(`riverCore@${at}.any`, any);
      return r;
    },
  };
});
vi.mock('../../src/world/terrain/seededLayout', async (orig) => {
  const o = (await orig()) as Record<string, unknown>;
  const heard = (f: (...a: unknown[]) => unknown) => (...a: unknown[]): unknown => {
    if (HK.inE) {
      const stack = new Error().stack ?? '';
      if (stack.includes('at confineBelt ')) {
        let pts = HK.cbPts.get(HK.eLi);
        if (!pts) HK.cbPts.set(HK.eLi, (pts = []));
        const n = a[0] as number, e = a[1] as number;
        if (!(pts.length && pts[pts.length - 2] === n && pts[pts.length - 1] === e)) pts.push(n, e);
      } else if (HK.eLi === HK.eLast) HK.inE = false;
    }
    return f(...a);
  };
  return { ...o, macroCachedAt: heard(o.macroCachedAt as (...a: unknown[]) => unknown), macroCachedGradAt: heard(o.macroCachedGradAt as (...a: unknown[]) => unknown) };
});
vi.mock('../../src/world/terrain/pitchPool', async (orig) => {
  const o = (await orig()) as Record<string, unknown>;
  const pitchPool = o.pitchPool as (a: unknown, line: number, ...r: unknown[]) => unknown;
  return {
    ...o,
    pitchPool: (a: unknown, line: number, ...r: unknown[]): unknown => {
      HK.bump('pitchPool.calls');
      (HK as unknown as { pitchLines?: number[] }).pitchLines ??= [];
      (HK as unknown as { pitchLines: number[] }).pitchLines.push(line);
      return pitchPool(a, line, ...r);
    },
  };
});
vi.mock('../../src/world/terrain/falls', async (orig) => {
  const o = (await orig()) as Record<string, unknown>;
  const bedGrain = o.bedGrain as (...a: unknown[]) => unknown;
  return { ...o, bedGrain: (...a: unknown[]): unknown => (HK.bump('bedGrain.calls'), bedGrain(...a)) };
});
vi.mock('../../src/world/terrain/drainage', async (orig) => {
  const o = (await orig()) as Record<string, unknown>;
  const Shore = o.ShoreSmooth as new (n: number, origin: number, ponds: number[][], home: unknown) => object;
  class ShoreSmoothHeard extends (Shore as unknown as new (...a: unknown[]) => object) {
    constructor(n: number, origin: number, ponds: number[][], home: unknown) {
      super(n, origin, ponds, home);
      HK.bump('ShoreSmooth.ponds', ponds.length);
      HK.bump('ShoreSmooth.cells', ponds.reduce((a, p) => a + p.length, 0));
    }
  }
  // (Round V A1: the cells the drainage routes the water over, `routing`, kept for the second flood's rows.)
  const build = o.buildDrainage as (...a: unknown[]) => unknown;
  const buildDrainage = (...a: unknown[]): unknown => {
    HK.routing = (a[4] as Float32Array | undefined) ?? null;
    return build(...a);
  };
  return { ...o, ShoreSmooth: ShoreSmoothHeard, buildDrainage };
});

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { hydrology, seededDrainage, seededInputs, seededModel, debugValley, fieldHeldCount, terrainHeight, naturalHeight } from '../../src/world/terrain/heightfield';
import { levelProbe } from '../../src/world/terrain/riverNetwork';
import { LakeMask, cellNorth, cellEast, DRAIN_CELL, HOME_MOUND, HOME_RADIUS } from '../../src/world/terrain/drainage';
import { AIRPORT } from '../../src/core/world';
import { SteadyRouter } from '../../src/world/terrain/erosion';
import { slopeStats } from '../../src/world/terrain/hillslopes';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

/** The src line holding `text` (file under src/world/terrain), or null when it is gone (the rule was deleted). */
const SRC = new Map<string, string[]>();
function anchor(file: string, text: string): string | null {
  let lines = SRC.get(file);
  if (!lines) SRC.set(file, (lines = readFileSync(new URL(`../../src/world/terrain/${file}`, import.meta.url), 'utf8').split('\n')));
  const at: number[] = [];
  lines.forEach((l, i) => {
    if (l.includes(text)) at.push(i + 1);
  });
  return at.length ? `${file}:${at[0]}` : null;
}
const A = {
  raise: anchor('riverNetwork.ts', 'st.breach[i] = breachOfCut(st.cut[i])'),
  lowered: anchor('riverNetwork.ts', 'a.breach[i] = Math.max(a.breach[i], breachOfCut(a.cut[i]))'),
  surface: anchor('riverNetwork.ts', 'c.breach[i] = inside ? 0 : Math.min(c.breach[i], breachOfCut(c.cut[i]))'),
  fieldTrim: anchor('riverNetwork.ts', 'r.breach[i] = Math.min(r.breach[i], breachOfCut(r.cut[i]))'),
  confine: anchor('riverNetwork.ts', 'natural(north[i] + un * r, east[i] + ue * r) < floor'),
  refineNet: anchor('riverNetwork.ts', 'const f = refineSteep('),
  coreHold: anchor('heightfield.ts', 'const core = riverCore(CUT_N'),
  holdsCarve: anchor('heightfield.ts', 'mask.holds(north, east) : 0'),
  holdsBreach: anchor('heightfield.ts', 'mask && mask.holds(north, east) > 0) keep'),
  // Round V A1: the wander family (RN1-RN3), the network's own copy of the course smoothing (ER3: one smoothing now,
  // erosion.ts channelCourse) and the drainage routing the corner-fixed cells (ER6b: the second flood routes the
  // model's own); null = deleted.
  wander: anchor('riverNetwork.ts', 'const WANDER = '),
  wanderShort: anchor('riverNetwork.ts', 'const WANDER_SHORT = '),
  pinned: anchor('riverNetwork.ts', 'const PINNED_WANDER = '),
  netSmooth: anchor('riverNetwork.ts', 'n2[i] = 0.25 * n[i - 1] + 0.5 * n[i] + 0.25 * n[i + 1];'),
  flood2: anchor('drainage.ts', 'flow.run(r2);'),
  modelCourse: anchor('riverNetwork.ts', 'const model = channelCourse('),
};

// LakeMask's own methods (DR17, DR19 / RN9, DR20), heard on its prototype.
{
  const p = LakeMask.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const m of ['drainPond', 'lowerPond']) {
    const f = p[m];
    p[m] = function (this: unknown, ...a: unknown[]): unknown {
      HK.bump(`${m}@${HK.fnSite()}`);
      return f.apply(this, a);
    };
  }
  const holds = p.holds;
  p.holds = function (this: unknown, ...a: unknown[]): unknown {
    const v = holds.apply(this, a) as number;
    if (HK.hits.has('box.on')) {
      const at = HK.site();
      HK.bump(`holds@${at}`);
      if (v > 0) HK.bump(`holds@${at}.true`);
    }
    return v;
  };
}

type Lv = { level: Float64Array; ground?: Float64Array; s: Float64Array; north: Float64Array; east: Float64Array };
type Line = { north: Float64Array; east: Float64Array; s: Float64Array; level: Float64Array; halfWidth: Float64Array; kind?: number; joins?: number; end?: string; area?: Float64Array; regime?: Uint8Array };
type Rec = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === 'number' ? v : Array.isArray(v) ? v.length : 0);

function smoothCourse(n: number[], e: number[]): void {
  for (let pass = 0; pass < 3; pass++) {
    const n2 = n.slice(), e2 = e.slice();
    for (let i = 1; i < n.length - 1; i++) {
      n2[i] = 0.25 * n[i - 1] + 0.5 * n[i] + 0.25 * n[i + 1];
      e2[i] = 0.25 * e[i - 1] + 0.5 * e[i] + 0.25 * e[i + 1];
    }
    n.splice(0, n.length, ...n2);
    e.splice(0, e.length, ...e2);
  }
}
function distOn(pn: number[], pe: number[], qn: number, qe: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pn.length; i++) {
    const dn = pn[i + 1] - pn[i], de = pe[i + 1] - pe[i];
    const L2 = dn * dn + de * de || 1;
    const u = Math.min(1, Math.max(0, ((qn - pn[i]) * dn + (qe - pe[i]) * de) / L2));
    best = Math.min(best, Math.hypot(qn - pn[i] - u * dn, qe - pe[i] - u * de));
  }
  return best;
}
/** Samples (and km) where stage b's level differs from stage a's by more than 1 cm (sign: -1 lowered, +1 raised, 0 any). */
function diff(a: Map<number, Lv>, b: Map<number, Lv>, sign = 0): { lines: number; samples: number; km: number; max: number } {
  let lines = 0, samples = 0, km = 0, max = 0;
  for (const [li, x] of a) {
    const y = b.get(li);
    if (!y || y.level.length !== x.level.length) continue;
    let hit = false;
    for (let i = 0; i < x.level.length; i++) {
      const d = y.level[i] - x.level[i];
      if (sign < 0 ? d < -0.01 : sign > 0 ? d > 0.01 : Math.abs(d) > 0.01) {
        samples++;
        hit = true;
        max = Math.max(max, Math.abs(d));
        if (i > 0) km += (x.s[i] - x.s[i - 1]) / 1000;
      }
    }
    if (hit) lines++;
  }
  return { lines, samples, km: Math.round(km * 10) / 10, max: Math.round(max * 10) / 10 };
}
const fmt = (o: { lines: number; samples: number; km: number; max: number }): string => `${o.samples} samples / ${o.lines} lines / ${o.km} km (max ${o.max} m)`;

const ROWS: Array<[string, string, string, string, string]> = [
  ['DR1', 'b', 'D·kind', "\u2192state", "RIVER_AREA 45 km\u00b2"],
  ['DR2', 'a', '', "stays", "BREACH_DEPTH 3, BREACH_LENGTH 3, BREACH_LENGTH.."],
  ['DR3', 'a', '', "stays", "LAKE_DEPTH 15; residual pond cut out"],
  ['DR4', 'c', '', "shrinks to th.", "LAKE_CELLS 2, LAKE_MAX_CELLS 80"],
  ['DR5', 'c gate', '', "goes under on.", "TARN_SPILL 1200 (tarn rule)"],
  ['DR6', 'c', '', "stays", "LAKE_MAX 800"],
  ['DR7', 'c', '', "shrinks to th.", "POND_MAX_CELLS 120 + pondCap"],
  ['DR8', 'c', '', "stays", "LAKE_HOME_CLEAR 6000, HOME_MOUND 80, HOME_RADI.."],
  ['DR9', 'a', '', "stays", "a pond touching the sea is not a lake"],
  ['DR10', 'b', 'E', "stays", "a lone outlet cell is not a river"],
  ['DR11', 'a', '', "stays", "priority flood + steepest descent on the fille.."],
  ['DR12', 'b', 'C', "shrinks", "settlePonds: level = min(spill, lowest fine gr.."],
  ['DR13', 'b', 'C', "goes with DR12", "12 rounds of cut / settle; \"round 11 settles w.."],
  ['DR14', 'b', 'C', "goes", "ShoreSmooth (+ SHORE_HOME_CLEAR 4500-6000)"],
  ['DR15', 'b', 'C', "shrinks to \"f.", "LakeMask raster flood: LAKE_MARGIN 3; level = .."],
  ['DR16', 'b', 'C', "goes", "POOLS_PER_LAKE 6"],
  ['DR17', 'b', 'C', "goes", "leaky lakes left dry"],
  ['DR18', 'b', 'C', "shrinks", "SMOOTH_RING 2 / BOX_PAD; LakeMask.smooth"],
  ['DR19', 'b', 'C', "goes", "drainPond / lowerPond"],
  ['DR20', 'b', 'C', "goes", "LakeMask.holds"],
  ['DR21', 'c', '', "stays", "LAKE_CENTRE_DEPTH 3; networkLakes ellipses (ri.."],
  ['ER1', 'a', '', "stays", "STEADY {m 0.6, sc 0.45, grade 0.06, ridge 400,.."],
  ['ER2', 'a', '', "stays", "CHANNEL_AREA 30 km\u00b2 (full at 60)"],
  ['ER3', 'b', 'A', "goes", "COURSE_PASSES 3"],
  ['ER4', 'a', '', "stays", "carveSegment: CARVE_HALF 650, CARVE_HALF_MAX 1.."],
  ['ER5', 'a', '', "stays", "FLOOR_HALF 450 + markFloor"],
  ['ER6', 'b', 'E', "stays for the.", "CORNER_AREA 10: diagonal-step saddle fix"],
  ['ER6b', 'b', 'A', "goes: the dra.", "the drainage gets the corner-fixed cells: erod.."],
  ['ER7', 'a', '', "stays", "LAND_MIN 0.5"],
  ['ER8', 'c', '', "stays", "HOME_KEEP/HOME_FULL, PAD_KEEP, CAP_ALONG/ACROS.."],
  ['ER9', 'c', '', "stays", "keptHollows: cap and sill, SILL_RINGS 2, SILL_.."],
  ['ER10', 'b', 'C', "goes", "keptHollows thresholds copied from drainage.ts.."],
  ['ER11', 'b', 'A', "\u2192model", "VALLEY_R 1 + valleyDepth"],
  ['ER12', 'b', 'B', "stays", "RESIDUAL_FADE [20, 100]"],
  ['ER13', 'b', 'A', "goes", "markCourse + COURSE_TAPER 500 + COURSE_CHORD 480"],
  ['ER14', 'b', 'A', "goes", "COURSE_SLOPES / COURSE_GULLIES [0, 0.95]"],
  ['ER15', 'b', 'E', "stays", "bilinear along the slope channels (ch)"],
  ['ER16', 'b', 'E', "stays while t.", "slopeSmoothDelta"],
  ['HS1', 'a', '', "stays", "SLOPES {sc 0.73, ac 1.5, ks 0.2, theta 0.45, i.."],
  ['HS2', 'b', 'A', "\u2192model", "courseHold 0.98; riverCore, CORE_HOLD 180, COR.."],
  ['HS3', 'd', '', "\u2014", "riverLift (1) + near core"],
  ['HS4', 'b', 'A', "goes", "a held floor is base level only where it runs .."],
  ['HS5', 'b', 'E', "stays", "corner fix on diagonal channel steps"],
  ['RN1', 'b', 'A', "goes", "WANDER 900 @ 6 km fbm + per-cell jitter \u00b10.275.."],
  ['RN2', 'b', 'A', "goes", "WANDER_SHORT 350 @ 2.5 km gnoise"],
  ['RN3', 'b', 'A', "goes", "PINNED_WANDER 0.15, PIN_CUT [20, 80], free(), .."],
  ['RN4', 'a', '', "stays", "lattice course smoothed 3 \u00d7 [1 2 1]; tributary.."],
  ['RN5', 'c', '', "stays", "clearOfRunway, RUNWAY_CLEAR 2500"],
  ['RN6', 'b', 'A', "goes", "floorHalf, FLOOR_GRID 250 \u2192 markFloor callback"],
  ['RN7', 'b', 'B', "\u2192model", "stage A level: running minimum of the ground (.."],
  ['RN8', 'b', 'C', "shrinks", "OUTLET_RUN 800; pinned reaches"],
  ['RN9', 'b', 'C', "goes", "DRAIN_MARGIN 8; drainPond in stage A; lowerPon.."],
  ['RN10', 'b', 'B', "goes", "stage B confluence cut"],
  ['RN11', 'a', '', "stays", "stage C0: the parent's level at the mouth; lev.."],
  ['RN12', 'b', 'B', "goes", "capFall (0.008 + 0.6 (1 \u2212 smooth(100, 1500, A).."],
  ['RN13', 'a', '', "stays", "MEANDER_AREA 250, MEANDER_GRADIENT 0.004; mean.."],
  ['RN14', 'c', '', "stays", "no wide loops 3-6 km from the home runway"],
  ['RN15', 'b', 'C', "stays", "no meanders across a lake"],
  ['RN16', 'a', '', "stays", "GORGE_CUT [100, 180]"],
  ['RN17', 'b', 'E', "stays", "floodplain smoothed over 1500 m; belt inside t.."],
  ['RN18', 'a', '', "stays", "halfWidthFor"],
  ['RN19', 'b', 'A', "goes", "valleyInfluence (500 + 1900 smooth(30, 2000, A.."],
  ['RN20', 'b', 'B', "goes", "stage D: level under the other lines' carve (c.."],
  ['RN21', 'b', 'B', "goes", "destair: STAIR_DROP 0.5, STAIR_RUN 1500"],
  ['RN22', 'b', 'A', "\u2192state", "confineBelt: CONFINE_EVERY 4, CONFINE_MIN 150"],
  ['RN23', 'b', 'B', "goes", "wall gaps + WALL_IN 0.1, WALL_CUT 0.25, FLOOR_.."],
  ['RN24', 'a', '', "stays", "meanderChannel (Ferguson)"],
  ['RN25', 'a', '', "stays", "cutOffLoops: NECK_FACTOR 0.22, OXBOW_LEVEL 0.6.."],
  ['RN26', 'b', 'D', "shrinks", "tributary pulled onto its parent's channel ove.."],
  ['RN27', 'b', 'E', "stays", "untangle"],
  ['RN28', 'b', 'B', "goes", "a tributary ends at its parent's water (a fall.."],
  ['RN29', 'b', 'D', "goes if chann.", "head taper: HEAD_TAPER 1500, width from the bi.."],
  ['RN30', 'b', 'D', "goes", "river head trimmed to the first feeder or junc.."],
  ['RN31', 'b', 'C', "goes", "riverPools: the pools a river runs through nee.."],
  ['RN32', 'b', 'D', "\u2192model", "carvedGround: the streams' routing ground = na.."],
  ['RN33', 'b', 'B', "goes", "RAISE_CUT 2, RAISE_DEPTH 1.2, RAISE_BANK 2, RA.."],
  ['RN34', 'b', 'B', "shrinks", "refineSteep on streams (streams.ts PIECE_*)"],
  ['RN35', 'b', 'D', "goes", "JOIN_PULL 1000; catchment never less downstrea.."],
  ['RN36', 'b', 'B', "goes", "CONFLUENCE_GRADIENT 0.3, CHAIN_CONFLUENCE 0.75.."],
  ['RN37', 'c gate', '', "goes", "HANG_UPLIFT 0.25: alpine gate for hanging vall.."],
  ['RN38', 'b', 'D·kind', "\u2192state", "chains: no hanging valley; CHAIN_CONFLUENCE"],
  ['RN39', 'b', 'B', "goes", "a line lowered by the shaping gets a cut and b.."],
  ['RN40', 'b', 'D·kind', "\u2192state", "pitchPool on streams only (loop li = nR)"],
  ['RN41', 'b', 'B', "goes", "receiver-mouth cascade before the pitches"],
  ['RN42', 'b', 'C', "shrinks", "AT_THE_SURFACE: lift, holds (RAISE_BANK), back.."],
  ['RN43', 'b', 'B', "goes", "breach narrowed to bed width except at outlets"],
  ['RN44', 'a gate', '', "\u2192state", "STEEP_SLOT 0.45, STEEP_NARROW [0.05, 0.2], STE.."],
  ['RN45', 'a', '', "stays", "below a junction never narrower than what joined"],
  ['RN46', 'a', '', "stays", "bedGrain per line (fromLake)"],
  ['RN47', 'b', 'D·kind', "\u2192state", "CHANNEL_REACH 450 vs STREAM_REACH 150; bedOf f.."],
  ['RN48', 'b', 'E', "stays", "valleyBand / VALLEY_BAND_MAX 300"],
  ['RN49', 'c', '', "stays", "holdUnder (FIELD_HOLD)"],
  ['RN50', 'd', '', "\u2014", "levelProbe"],
  ['RN51', 'd', '', "\u2014", "wideIndex = channelIndex, void channelHits, vo.."],
  ['ST1', 'b', 'D', "goes if chann.", "STREAM_AREA 35; headwaters = lattice cells \u2265 3.."],
  ['ST2', 'b', 'B', "\u2192model", "STREAM_DEPTH 1.0"],
  ['ST3', 'b', 'D', "\u2192model", "LATERAL_GAIN 2 km\u00b2/km"],
  ['ST4', 'b', 'D', "goes", "HEAD_START_AREA 6, HEAD_RAMP 2000 (head taper)"],
  ['ST5', 'b', 'D', "goes if every.", "feedHeads: FEED_AREA 5, FEED_SECOND 15, FEED_J.."],
  ['ST6', 'b', 'B', "shrinks to \"f.", "LEVEL_EVERY 3, STEEP_RECHECK 3"],
  ['ST7', 'b', 'B', "goes", "JOIN_TOL 6 with canReach, joinAt, higherWater,.."],
  ['ST8', 'b', 'B', "goes", "BACKUP_FILL 4"],
  ['ST9', 'b', 'D', "goes", "CHAIN_LOWER 40"],
  ['ST10', '–', '', "", "MAX_STEPS 3000, OUTLET_FLOOD 3000"],
  ['ST11', 'b', 'E', "\u2192fill-spill", "pit climb: CLIMB_HEIGHT 25, CHAIN_CLIMB 80, CO.."],
  ['ST12', 'b', 'E', "\u2192fill-spill", "connect, CONNECT_R 12, CONT_CONNECT_R 24"],
  ['ST13', 'b', 'D', "goes", "passWalk, PASS_WALK 400"],
  ['ST14', '–', '', "", "D8 with direction memory (three ahead first)"],
  ['ST15', 'b', 'E', "stays", "no crossing its own course (crosses, visit)"],
  ['ST16', 'b', 'E', "goes under on.", "loop guards: avoid, avoidPools, upstreamOf, po.."],
  ['ST17', 'b', 'E', "goes", "standIn"],
  ['ST18', 'c', '', "stays", "byHome, HOME_CLEAR 2500"],
  ['ST19', 'b', 'E', "stays", "junction(): JUNCTION_SHIFT 400, JUNCTION_ANGLE.."],
  ['ST20', 'd', '', "\u2014", "BARB_FIX, BARB_ANGLE 105\u00b0"],
  ['ST21', 'd', '', "\u2014", "CURVE_FLOORS, FLOOR_PASSES 4, FLOOR_LAY 90, FL.."],
  ['ST22', 'b', 'D', "goes if the c.", "pinned / pinOf (slopePinned = min(1, mg \u00b7 ch \u00b7.."],
  ['ST23', 'b', 'D', "goes", "V_SIDE 15; inV, onFloor, pathVee"],
  ['ST24', 'b', 'E', "stays", "FLOOR_SMOOTH 6"],
  ['ST25', 'b', 'D', "goes", "CHAIN_PLAIN 2"],
  ['ST26', 'b', 'A', "goes", "crossTo: FLOOR_CROSS 900, FLOOR_STEP 60, FLOOR.."],
  ['ST27', 'b', 'E', "stays", "besideChain, FLOOR_FLAT 12"],
  ['ST28', 'b', 'E', "stays as draw.", "stream wander: WANDER_AMP 1, WANDER_LO 5, WAND.."],
  ['ST29', 'b', 'E', "stays", "untangleCourse"],
  ['ST30', 'b', 'B', "goes", "the last reach backs up to the mouth"],
  ['ST31', 'b', 'C', "shrinks", "OUTLET_KEEP 60"],
  ['ST32', 'b', 'B', "goes", "breach rules: BREACH_MIN 3, BREACH_BASE 12, BR.."],
  ['ST33', 'b', 'C', "shrinks", "breachOfLake (50-300 m)"],
  ['ST34', 'b', 'C', "goes", "OUTLET_SILL 10; outletPath minimax flood"],
  ['ST35', 'b', 'C', "shrinks", "outlets traced first, largest first; riverPool.."],
  ['ST36', 'b', 'D', "goes", "RIVER_TOUCH 200; rivers marked on the raster"],
  ['ST37', 'b', 'E', "stays", "stream marks, diagonal corners marked"],
  ['ST38', 'b', 'D', "shrinks", "gully chains: chainArea, longest first, skips,.."],
  ['ST39', 'b', 'E', "\u2192fill-spill", "continuations"],
  ['ST40', 'b', 'E', "\u2192fill-spill", "truncate, appendTo, crossesOwn, joinBeside (JO.."],
  ['ST41', 'b', 'E', "\u2192fill-spill", "the pond pass: POND_MAX 1200, POND_DEEP 120, P.."],
  ['ST42', 'b', 'E', "\u2192fill-spill", "CUT_BACK 450, and at most half the stream"],
  ['ST43', 'b', 'E', "\u2192fill-spill", "FILL_DEAD_ENDS, FILL_WINDOW 48, deadEnd, fillP.."],
  ['ST44', 'c', '', "stays", "POND_KEEP 3 km\u00b2, POND_SILL_CUT 15 m"],
  ['ST45', 'c', '', "goes under on.", "LAKE_BACK_CLOSED"],
  ['ST46', 'd', '', "\u2014", "BIG_POND_KEEP, LAKE_RAISE"],
  ['ST47', 'b', 'E', "\u2192fill-spill", "pondOutlet closed cases: closedNoWay, closedLo.."],
  ['ST48', 'b', 'E', "goes", "cutInto, lostArea, tribOf, endLost, lostGain, .."],
  ['ST49', 'b', 'D', "\u2192model", "catchment sum: continuation skip; chain-on-cha.."],
  ['ST50', 'b', 'E', "goes", "continuations carry their delta down"],
  ['ST51', 'b', 'D', "goes", "headFrom"],
  ['ST52', 'b', 'E', "goes", "SINK_TAPER 400, SINK_END 0.25"],
  ['ST53', 'a', '', "stays", "one width law: riverHalfWidth, BED_A 2.594, BE.."],
  ['ST54', 'a', '', "stays", "REGIME, REGIME_GRADIENT [0.005, 0.02, 0.08], G.."],
  ['ST55', 'b', 'B', "shrinks", "refineSteep: PIECE_STEP 4, PIECE_GRADIENT 0.2,.."],
  ['ST56', 'a', '', "stays", "sea: G \u2264 0.5 is sea; the level at the sea \u2264 0"],
  ['ST57', 'b', 'C', "goes", "\"never water standing over its source\""],
  ['ST58', 'd', '', "\u2014", "streamDebug"],
  ['GU1', 'b', 'D', "stays as a dr.", "CHAIN_AREA 10; chainArea()"],
  ['GU2', 'd', '', "\u2014", "setChainArea, chainOverride"],
  ['GU3', 'a', '', "stays", "gullyNetOf: catchment on the slopes' own routing"],
  ['GU4', 'b', 'D', "stays while r.", "gullyNear"],
  ['GU5', 'b', 'D', "stays with GU4", "inV (rise 10)"],
  ['FA1', 'a', '', "stays", "fault falls: FALL_MIN 3, FLIGHT_MAX 15, FLIGHT.."],
  ['FA2', 'a gate', '', "stays, ungated", "hanging valley: wallStep with HANG_WALL 0.3, H.."],
  ['FA3', 'a gate', '', "merges into F.", "outlet over a cliff: OUTLET_WALL 0.5, OUTLET_F.."],
  ['FA4', '–', '', "", "FALL_CLEAR 120, FALL_SPACING 200"],
  ['FA5', 'b', 'B', "goes", "mouth cascade \u2264 confluence"],
  ['FA6', 'a', '', "stays", "bedGrain: GRAIN_HEAD 2.5, GRAIN_FLOOR 0.04, GR.."],
  ['FA7', 'a', '', "stays", "no fault fall in a lake or under 2 m"],
  ['PP1', 'a', '', "stays", "PITCH_G_LO 0.02; UNIT_GENTLE 6, UNIT_STEEP 2.5.."],
  ['PP2', '–', '', "", "FALL_CLEAR 30, HEAD_CLEAR 20, MOUTH_CLEAR 30, .."],
  ['PP3', 'b', 'B', "goes with a m.", "\"the new profile never lies above the old one\""],
  ['PP4', 'b', 'C', "stays", "no units in lake water"],
  ['RI1', 'a', '', "stays", "RILL_AREA 0.03; CONVERGE 2.5"],
  ['RI2', 'a', '', "stays", "RILL_AREA_TOP 16, RILL_LOOK_CAP 2, RILL_WET_AR.."],
  ['RI3', 'b', 'D', "stays", "AREA_R 44 and window saturation"],
  ['RI4', 'b', 'D', "stays", "CHAIN_REACH 90 + chain catchment borrowing"],
  ['RI5', 'b', 'E', "\u2192fill-spill", "SPILL_R 10, SPILL_D 2, SPILL_ROUND 3"],
  ['RI6', 'b', 'E', "stays", "FADE 12, TAPER 10"],
  ['RI7', 'b', 'E', "stays", "WIDE_SMOOTH 6"],
  ['RI8', 'b', 'E', "stays", "RILL_TUNE.noise 0.6, ROUTE_WAVE 150"],
  ['RI9', 'b', 'E', "stays", "SNAP 10, SNAP_STEP 2"],
  ['RI10', 'b', 'D', "stays", "NET_MARGIN 4; network cells: lake, river, near.."],
  ['RI11', 'b', 'E', "stays", "MERGE_R 1, MERGE_STEPS 3 (strands)"],
  ['RI12', 'b', 'E', "stays", "slopeRouteDelta routing"],
  ['RI13', 'b', 'E', "stays", "flat spills drawn as chords (round T)"],
  ['RI14', 'd', '', "\u2014", "ROUTE_NOISE (never read; RILL_TUNE.noise is us.."],
  ['RI15', 'd', '', "\u2014", "RILL_TUNE"],
  ['HF1', 'b', 'C', "goes", "byLake: no course mark by a lake"],
  ['HF2', 'c', '', "stays", "FIELD_HOLD, FIELD_FIRST, HOLD_BANK 1, FIELD_CH.."],
  ['HF3', 'b', 'D', "goes", "slopePinned"],
  ['HF4', 'b', 'B', "goes", "slopeWall \u2192 wallLift; breachLift"],
  ['HF5', 'b', 'A', "goes", "FLOOR_GRID_MARGIN 250; mountainSlopes core / n.."],
  ['HF6', 'b', 'D', "\u2192model", "naturalHeightSmooth (routing ground), STREAM_G.."],
  ['HF7', 'b', 'D', "stays", "mountains: noise gullies keep SlopeParams.gull.."],
  ['HF8', 'b', 'B', "goes", "STREAM_SMOOTH [15, 50]; calmS removes small re.."],
  ['HF9', 'b', 'B', "goes", "STREAM_FILL 5; banks built up"],
  ['HF10', 'a gate', '', "\u2192state", "BANK_HEIGHT 1.3; valleyProfile, channelProfile"],
  ['HF11', 'b', 'B', "goes", "levee \u2264 4 m guard"],
  ['HF12', 'b', 'A', "goes", "valley carve: excess \u00b7 t\u00b2 gorge"],
  ['HF13', 'b', 'C', "shrinks to \"n.", "lake guards in the carve: LakeMask.holds, oxbo.."],
  ['HF14', 'b', 'B', "goes", "keep1 / keep2"],
  ['HF15', 'a gate', '', "\u2192state", "streamBanks, STREAM_BANK_MIN 0.6"],
  ['HF16', 'b', 'B', "goes", "breachProfile: BREACH_FLOOR 0.6, BREACH_RISE 1.2"],
  ['HF17', 'b', 'D·kind', "\u2192state", "carveNetwork kind switch (kind 1: notch and ba.."],
  ['HF18', 'b', 'D', "shrinks", "beyondSource fades: smooth(0, 20) for streams,.."],
  ['HF19', 'c', '', "stays", "seed 0: carveRiver, carveLegacyRiver, RIVER_IN.."],
  ['HF20', 'c', '', "stays", "approach trims and the obstacle-clear zone"],
  ['RE1', 'b', 'D·kind', "\u2192state", "water.ts ribbonKeep: only streams drop rows"],
  ['RE2', 'b', 'C', "stays", "water.ts: a stream's rows in lake water are hi.."],
  ['RE3', 'b', 'D·kind', "\u2192state", "water.ts: shallow centre depth for kind 1"],
  ['RE4', '–', '', "", "water.ts: small stream ribbons batched"],
  ['RE5', 'b', 'C', "stays", "tileBuilder.ts: no channel bed, bank or tree p.."],
];

/** The rows' counts for one seed: id -> [how, text]. */
function measure(seed: number): Map<string, [string, string]> {
  HK.hits.clear();
  (HK as unknown as { pitchLines?: number[] }).pitchLines = [];
  HK.cbPts.clear();
  HK.eLi = HK.eLast = -1;
  const st: Record<string, Map<number, Lv>> = {};
  const keep = (stage: string, li: number, L: { level: Float64Array; ground?: Float64Array; s: ArrayLike<number>; north: ArrayLike<number>; east: ArrayLike<number> }): void => {
    (st[stage] ??= new Map()).set(li, { level: Float64Array.from(L.level), ground: L.ground ? Float64Array.from(L.ground) : undefined, s: Float64Array.from(L.s), north: Float64Array.from(L.north), east: Float64Array.from(L.east) });
  };
  levelProbe.on = (stage, li, L) => {
    if (stage === 'E') {
      HK.inE = true;
      HK.eLi = li;
      HK.eLast = (st.A?.size ?? 0) - 1;
    } else if (stage === 'chan') HK.inE = false;
    if (stage === 'A' && st.A?.has(li)) return;
    keep(stage, li, L as unknown as Lv);
  };
  setWorldSeed(seed);
  terrainHeight(0, 0);
  const rivers = (hydrology.rivers ?? []) as unknown as Line[];
  levelProbe.on = undefined;
  HK.inE = false;
  const d = seededDrainage!;
  const mask = hydrology.lakeMask as unknown as { pools: Array<{ lake: number; level: number; wet: number; drained?: boolean }>; leaky: number[] };
  const rep = (hydrology.streamReport ?? {}) as unknown as Rec & { chains?: Rec; feed?: Rec; shape?: Rec; pitch?: Rec & { deepen?: number[] }; surface?: Rec; pondWhy?: Record<string, number>; floorFree?: number[]; pondClosed?: string[] };
  const h = (k: string): number => HK.hits.get(k) ?? 0;
  const at = (fn: string, a: string | null, suffix = ''): string => (a === null ? 'gone' : String(h(`${fn}@${a}${suffix}`)));
  /** Calls heard from a file (any function, or one function: callers in mocked modules are named, not numbered). */
  const from = (fn: string, file: string, func?: string): number => {
    let t = 0;
    for (const [k, v] of HK.hits) if (k.startsWith(`${fn}@${file}#`) && (!func || k.endsWith(`#${func}`))) t += v;
    return t;
  };
  const R = new Map<string, [string, string]>();
  const set = (id: string, how: string, text: string): void => {
    R.set(id, [how, text]);
  };
  const nR = rivers.filter((r) => (r.kind ?? 0) === 0).length;
  const streams = rivers.slice(nR);

  // --- drainage.ts
  set('DR1', 'derived', `${nR} river lines`);
  const cut = [0, 0, 0, 0];
  for (let c = 0; c < d.cutWhy.length; c++) cut[d.cutWhy[c]]++;
  set('DR2', 'report', `${cut[1]} cells cut within the allowance`);
  set('DR3', 'report', `${cut[3]} cells: ponds cut to the bottom`);
  set('DR4', 'derived', `${d.lakes.filter((l) => !l.river).length} lakes no river feeds`);
  set('DR5', 'derived', `${d.lakes.filter((l) => l.tarn).length} tarns`);
  set('DR6', 'derived', `${d.lakes.length} lakes of 800`);
  set('DR7', 'report', `${cut[2]} cells cut to keep a pond within 120 km²`);
  set('DR11', 'derived', `${d.lines.length} lines traced`);
  set('DR12', 'derived', `${d.lakes.filter((l) => l.level < l.spill - 0.01).length} lakes settled under their spill`);
  set('DR13', 'report', `${cut[3]} cells (as DR3: the rounds' cut-outs)`);
  set('DR14', 'hook', `${h('ShoreSmooth.ponds')} ponds, ${h('ShoreSmooth.cells')} cells smoothed`);
  const poolsOf = new Map<number, number>();
  let lowered = 0;
  for (const p of mask.pools) {
    poolsOf.set(p.lake, (poolsOf.get(p.lake) ?? 0) + 1);
    const L = d.lakes[p.lake];
    if (L && p.level < L.level - 0.5) lowered++;
  }
  set('DR15', 'derived', `${lowered} of ${mask.pools.length} pools under their lake's level by > 0.5 m`);
  set('DR16', 'derived', `${[...poolsOf.values()].filter((v) => v > 1).length} lakes in > 1 pool (max ${Math.max(0, ...poolsOf.values())})`);
  set('DR17', 'report', `${mask.leaky.length} leaky (drainPond from LakeMask's flood ${from('drainPond', 'drainage.ts', 'LakeMask')})`);
  set('DR18', 'derived', `${mask.pools.filter((p) => !p.drained).length} pools smoothed`);
  set('DR19', 'hook', `drainPond: network ${from('drainPond', 'riverNetwork.ts')}, streams ${from('drainPond', 'streams.ts')}, lowerPond's own ${from('drainPond', 'drainage.ts', 'LakeMask.lowerPond')}; lowerPond ${from('lowerPond', 'riverNetwork.ts')}`);
  set('DR21', 'derived', `${hydrology.lakes.length} lake ellipses`);

  // --- erosion.ts
  const inp = seededInputs!;
  const T = seededModel()!.lattice;
  const n = d.n;
  {
    const RM = new SteadyRouter(n);
    RM.route(T, inp.fixed);
    let ch = 0;
    for (let c = 0; c < n * n; c++) if (RM.area[c] >= 30) ch++;
    set('ER2', 'derived', `${ch} model channel cells (>= 30 km²)`);
    const hh = Float32Array.from(T);
    let low = 0, drop = 0;
    for (let k = 0; k < RM.order.length; k++) {
      const c = RM.order[k];
      const r = RM.receiver[c];
      if (r < 0 || !RM.diag[c] || RM.area[c] < 10) continue;
      const mid = 0.5 * (hh[c] + Math.max(hh[r], 0.5));
      const ic = Math.floor(c / n), ir = Math.floor(r / n);
      for (const q of [ir * n + (c - ic * n), ic * n + (r - ir * n)]) {
        if (!inp.fixed[q] && hh[q] > mid) {
          const nv = Math.max(Math.min(hh[q], inp.sill[q]), hh[q] - (hh[q] - mid) * inp.hard[q]);
          if (nv < hh[q]) (low++, (drop += hh[q] - nv));
          hh[q] = nv;
        }
      }
    }
    set('ER6', 'derived', `${low} cells lowered (mean ${(drop / Math.max(1, low)).toFixed(0)} m), replayed`);
  }
  set('ER13', 'hook', `${h('markCourse.axes')} axes, ${h('markCourse.samples')} samples, ${h('markCourse.cells')} fine cells marked`);
  if (A.netSmooth === null) set('ER3', 'deleted', 'A1 (one smoothing, erosion.ts channelCourse, for the carve and the axes)');
  if (A.modelCourse !== null) set('RN4', 'derived', `${d.lines.length} lines laid on the model's course (channelCourse, the carve's B-spline)`);
  // The second flood (Round V A1): the drainage's receivers over the model's cells as routed (`routing`), with the
  // cuts and the lakes' water of the first flood (on the drawn lattice) carried over.
  const rte = HK.routing;
  if (A.flood2 === null || !rte) set('ER6b', 'derived', 'the drainage routes the corner-fixed cells');
  else {
    set('ER6b', 'deleted', 'A1 (the receivers come from the model\'s cells: V:FLOOD2)');
    const nn = d.n;
    const home = AIRPORT.runway.center;
    const mound = (c: number): number => {
      const r = Math.hypot(d.origin + Math.floor(c / nn) * DRAIN_CELL - home.north, d.origin + (c % nn) * DRAIN_CELL - home.east);
      return r < HOME_RADIUS ? HOME_MOUND * (1 - r / HOME_RADIUS) : 0;
    };
    const r2 = new Float32Array(rte.length);
    let cutLow = 0, cutDrop = 0, lakeLow = 0, lakeDrop = 0;
    for (let c = 0; c < rte.length; c++) {
      r2[c] = rte[c] + mound(c);
      if (d.cutWhy[c] && d.routed[c] < r2[c]) (cutLow++, (cutDrop += r2[c] - d.routed[c]), (r2[c] = d.routed[c]));
    }
    for (const l of d.lakes) for (const c of l.cells) {
      const v = Math.max(d.routed[c], l.level);
      if (v < r2[c]) (lakeLow++, (lakeDrop += r2[c] - v), (r2[c] = v));
    }
    // River steps whose receiver is not the one the drawn lattice (the first flood's surface, d.height) routes.
    const RH = new SteadyRouter(nn);
    const fixedD = new Uint8Array(nn * nn);
    for (let c = 0; c < nn * nn; c++) {
      const i = Math.floor(c / nn), j = c % nn;
      fixedD[c] = d.height[c] <= 0 || i === 0 || j === 0 || i === nn - 1 || j === nn - 1 ? 1 : 0;
    }
    RH.route(d.height, fixedD);
    let steps = 0, moved = 0;
    for (const L of d.lines) {
      const last = L.joins >= 0 ? L.cells.length - 2 : L.cells.length - 1;
      for (let k = 0; k < last; k++) {
        steps++;
        if (RH.receiver[L.cells[k]] !== L.cells[k + 1]) moved++;
      }
    }
    set('V:FLOOD2', 'derived', `${moved} of ${steps} river steps routed off the drawn lattice's receiver (${((100 * moved) / Math.max(1, steps)).toFixed(1)} %)`);
    set('V:CUT_PASTE', 'derived', `${cutLow} cut cells lowered into the routing (mean ${(cutDrop / Math.max(1, cutLow)).toFixed(0)} m)`);
    set('V:LAKE_PASTE', 'derived', `${lakeLow} lake cells lowered to the lake's level (mean ${(lakeDrop / Math.max(1, lakeLow)).toFixed(0)} m)`);
  }

  // --- hillslopes.ts
  set('HS1', 'report', `${slopeStats.active} nodes in the pass`);
  set('HS2', 'hook', `${at('riverCore', A.coreHold, '.held')} nodes held (core >= 250), ${at('riverCore', A.coreHold, '.any')} in a core`);
  set('HS5', 'report', `${slopeStats.corners} corners`);

  // --- riverNetwork.ts
  {
    const un: Array<{ n: number[]; e: number[] }> = [];
    for (let li = 0; li < d.lines.length; li++) {
      const L = d.lines[li];
      const cn = L.cells.map((c) => cellNorth(d, c)), ce = L.cells.map((c) => cellEast(d, c));
      smoothCourse(cn, ce);
      if (L.joins >= 0 && un[L.joins]) {
        cn[cn.length - 1] = un[L.joins].n[L.joinAt];
        ce[ce.length - 1] = un[L.joins].e[L.joinAt];
      }
      un.push({ n: cn, e: ce });
    }
    let total = 0, off = 0, offDeep = 0, held = 0, heldKm = 0;
    for (const [li, a] of st.A ?? []) {
      const c = un[li];
      for (let i = 0; i < a.level.length; i++) {
        const ds = i > 0 ? (a.s[i] - a.s[i - 1]) / 1000 : 0;
        if (a.ground && a.level[i] < a.ground[i] - 2.5 - 0.05) (held++, (heldKm += ds));
        if (i % 2 || !c) continue;
        const ds2 = i + 2 < a.s.length ? (a.s[i + 2] - a.s[i]) / 1000 : 0;
        total += ds2;
        if (distOn(c.n, c.e, a.north[i], a.east[i]) > 200) {
          off += ds2;
          if (debugValley(a.north[i], a.east[i]) > 80) offDeep += ds2;
        }
      }
    }
    if (A.wander === null) {
      // (Round V A1: deleted. What the old count measured, the axis off its own smoothed lattice course, kept for the
      // record: the axis now lies on the model's course, which the drainage's tree follows.)
      set('RN1', 'deleted', `A1 (axis km > 200 m off the own lattice course: ${off.toFixed(0)} of ${total.toFixed(0)})`);
    } else set('RN1', 'derived', `${off.toFixed(0)} of ${total.toFixed(0)} axis km > 200 m off the own lattice course (RN1 + RN2)`);
    if (A.wanderShort === null) set('RN2', 'deleted', 'A1');
    else set('RN2', 'derived', `(with RN1)`);
    if (A.pinned === null) set('RN3', 'deleted', `A1 (valleyAt kept: GORGE_CUT, RN16)`);
    else set('RN3', 'derived', `${offDeep.toFixed(1)} km of it in valleys > 80 m deep`);
    set('RN7', 'stage', `${held} samples / ${heldKm.toFixed(0)} km held under ground - 2.5 by the running minimum`);
    set('RN19', 'derived', `${total.toFixed(0)} axis km (the second valley is cut about every axis)`);
  }
  set('RN6', 'hook', `${h('markCourse.axes')} axes marked (as ER13)`);
  set('RN9', 'hook', `drainPond in stage A ${from('drainPond', 'riverNetwork.ts')}, lowerPond ${from('lowerPond', 'riverNetwork.ts')}`);
  const D = new Map(st.C ?? []);
  for (const [li, v] of st.D ?? []) D.set(li, v);
  set('RN10', 'stage', fmt(diff(st.A ?? new Map(), st.B ?? new Map(), -1)));
  // C0 (RN11): a tributary's water raised to its parent's level at the mouth, its last sample put there; 0 at the sea.
  set('RN11', 'stage', fmt(diff(st.B ?? new Map(), st.C0 ?? new Map())) + ' (raised or lowered to the parent / the sea at the mouth)');
  {
    // RN28, after the channels are laid: a tributary's last sample comes down to its parent's water where that lies
    // lower. From the 'chan' copies (the parent's channel is laid first): mouths over the parent's nearest sample.
    const ch = st.chan ?? new Map();
    let n = 0, max = 0;
    for (let li = 0; li < nR; li++) {
      const a = ch.get(li);
      const pj = rivers[li].joins ?? -1;
      const p = pj >= 0 ? ch.get(pj) : undefined;
      if (!a || !p) continue;
      const m = a.level.length - 1;
      let best = Infinity, lv = 0;
      for (let k = 0; k < p.level.length; k++) {
        const dd = Math.hypot(p.north[k] - a.north[m], p.east[k] - a.east[m]);
        if (dd < best) (best = dd), (lv = p.level[k]);
      }
      if (a.level[m] > lv + 0.01) (n++, (max = Math.max(max, a.level[m] - lv)));
    }
    set('RN28', 'stage', `${n} tributary mouths brought down to the parent's water (max ${max.toFixed(1)} m), from the 'chan' stage`);
  }
  set('RN12', 'stage', fmt(diff(st.C0 ?? new Map(), st.C ?? new Map())));
  set('RN20', 'stage', fmt(diff(st.C ?? new Map(), D)) + ' (carvedUnder and its capFall)');
  set('RN21', 'stage', fmt(diff(D, st.E ?? new Map())));
  {
    // confineBelt: each check asks the ground at its two sides, at half the belt and then the whole belt, and stops at
    // the first answer under the water + 1 m (the belt is narrowed): so the answers under it are the checks that fired.
    let checks = 0, fired = 0, unplaced = 0;
    for (const [li, pts] of HK.cbPts) {
      const L = st.E?.get(li);
      if (!L) continue;
      const m = L.north.length;
      let cur = 0;
      const seen = new Set<number>();
      for (let k = 0; k < pts.length; k += 2) {
        const pn = pts[k], pe = pts[k + 1];
        let found = -1;
        for (let i = cur; i < m; i += 4) {
          const i0 = Math.max(0, i - 1), i1 = Math.min(m - 1, i + 1);
          const tn = L.north[i1] - L.north[i0], te = L.east[i1] - L.east[i0];
          const tl = Math.hypot(tn, te) || 1;
          if (Math.abs(((pn - L.north[i]) * tn + (pe - L.east[i]) * te) / tl) < 1e-3) {
            found = i;
            break;
          }
        }
        if (found < 0) {
          unplaced++;
          continue;
        }
        cur = found;
        if (!seen.has(found)) (seen.add(found), checks++);
        if (naturalHeight(pn, pe) < L.level[found] + 1) fired++;
      }
    }
    set('RN22', 'hook', A.confine === null ? 'gone' : `${fired} of ${checks} checks narrowed the belt (${unplaced} answers unplaced)`);
  }
  set('RN25', 'derived', `${(hydrology.oxbows ?? []).length} oxbows`);
  set('RN26', 'derived', `${rivers.slice(0, nR).filter((r) => (r.joins ?? -1) >= 0).length} tributary rivers pulled (distance n/o)`);
  {
    const sh = st.shape ?? new Map(), ch = st.chan ?? new Map();
    let s = 0, l = 0;
    for (const [li, a] of ch) {
      const b = sh.get(li);
      const r = rivers[li];
      if (!b || (r.joins ?? -1) < 0 || b.level.length !== a.level.length) continue;
      const end = a.s[a.s.length - 1];
      let hit = false;
      for (let i = 0; i < a.level.length; i++) if (end - a.s[i] < 1500 && b.level[i] < a.level[i] - 0.01) (s++, (hit = true));
      if (hit) l++;
    }
    set('RN36', 'stage', `${s} samples / ${l} tributary rivers lowered in their last 1.5 km by the shaping (cascade and falls)`);
  }
  const feed = (rep.feed ?? {}) as Rec;
  set('RN30', 'report', `${num(feed.trims)} heads trimmed, ${num(feed.trimKm)} km`);
  set('RN31', 'report', `${num(rep.riverPools)} river pools`);
  set('RN32', 'report', `${num(rep.steps)} raster steps traced on it`);
  set('RN33', 'hook', `${at('breachOfCut', A.raise)} stream samples raised`);
  set('RN34', 'hook', `${at('refineSteep', A.refineNet)} streams refined`);
  const shape = (rep.shape ?? {}) as Rec;
  set('RN37', 'report', `${num(shape.hangCandidates)} candidates past the gate, ${num(shape.hanging)} falls`);
  const chains = (rep.chains ?? {}) as Rec;
  set('RN38', 'derived', `${num(chains.traced)} chains (none may hang)`);
  set('RN39', 'hook', `${at('breachOfCut', A.lowered)} samples cut after the shaping`);
  const pl = (HK as unknown as { pitchLines: number[] }).pitchLines;
  set('RN40', 'hook', `${pl.filter((x) => x >= nR).length} streams cut, ${pl.filter((x) => x < nR).length} rivers; ${num((rep.pitch ?? {}).units)} units`);
  const sf = (rep.surface ?? {}) as Rec;
  set('RN42', 'report', `${num(sf.lines)} lines / ${num(sf.raised)} samples raised (${Number(sf.km ?? 0).toFixed(1)} km), blocked ${num(sf.blocked)}, falls dropped ${num(sf.falls)}`);
  set('RN46', 'hook', `${h('bedGrain.calls')} lines`);
  set('RN49', 'report', `${fieldHeldCount()} stream samples held; ${at('breachOfCut', A.fieldTrim)} trimmed`);
  set('RN50', 'd', 'used by this probe');

  // --- streams.ts
  set('ST1', 'report', `${num(rep.heads)} heads, ${num(rep.traced)} traced`);
  set('ST5', 'report', `${num(feed.feeders)} feeders; short ${num(feed.short)}, held ${num(feed.held)} + ${num(feed.heldAfter)}; fed ${num(feed.fed)}, unfed ${num(feed.unfed)}`);
  set('ST6', 'report', `${num(rep.levelSamples)} re-looks`);
  set('ST7', 'report', `${num(rep.sinks)} streams ended short of higher water (lines ${num(rep.sinkGap)}, lakes ${num(rep.sinkGapLake)})`);
  {
    // BACKUP_FILL: a last reach backed up over the ground to the water it joins (at most 4 m). Read off the output:
    // samples in a stream's last 500 m whose water stands 0.5-4.5 m over the natural ground (the ground the traces
    // read is the routing ground, carvedGround, not exported: approximate).
    let lines = 0, samples = 0;
    for (const r of streams) {
      if ((r.joins ?? -1) < 0) continue;
      const end = r.s[r.s.length - 1];
      let hit = false;
      for (let i = 0; i < r.s.length; i++) {
        if (end - r.s[i] > 500) continue;
        const over = r.level[i] - naturalHeight(r.north[i], r.east[i]);
        if (over > 0.5 && over <= 4.5) (samples++, (hit = true));
      }
      if (hit) lines++;
    }
    set('ST8', 'derived', `${lines} joining streams / ${samples} samples in the last 500 m 0.5-4.5 m over the natural ground (approx.)`);
  }
  set('ST9', 'report', `${num(rep.chainLowered)} lowered`);
  set('ST11', 'report', `${num(rep.pits)} pits, ${num(rep.floods)} climbs, ${num(rep.hollows)} hollows`);
  set('ST12', 'report', `${num(rep.connects)} connects`);
  set('ST13', 'report', `${num(rep.passWalks)} pass walks`);
  set('ST17', 'derived', `${streams.filter((r) => r.s.length <= 2).length} stand-ins (<= 2 samples)`);
  set('ST19', 'report', `${num(rep.junctions)} junctions`);
  set('ST20', 'report', `${num(rep.barbed)} (off)`);
  const ff = rep.floorFree ?? [];
  set('ST21', 'report', `${ff[1] ?? 0} (off)`);
  set('ST22', 'report', `${ff[2] ?? 0} of ${ff[0] ?? 0} raster points pinned`);
  set('ST26', 'report', `${num(chains.crossed)} of ${num(chains.traced)} chains crossed a held floor`);
  set('ST28', 'report', `${num(rep.wanderSamples)} samples moved, ${num(rep.wanderCut)} cut back`);
  set('ST32', 'report', `${num(rep.breachSamples)} samples in a breach`);
  set('ST34', 'report', `${num(rep.outletHigh)} lakes with no outlet (sill), ${num(rep.outletNone)} none found`);
  set('ST35', 'report', `${num(rep.outlets)} outlets (to a lake ${num(rep.outletToLake)}, the sea ${num(rep.outletToSea)})`);
  set('ST38', 'report', `${num(chains.heads)} heads, ${num(chains.traced)} traced (${Number(chains.km ?? 0).toFixed(0)} km), ${num(chains.skipped)} skipped`);
  set('ST39', 'report', `${num(rep.continued)} continuations`);
  const pw = rep.pondWhy ?? {};
  set('ST40', 'report', `joined ${pw.joined ?? 0}, joinedBig ${pw.joinedBig ?? 0}, ranOn ${pw.ranOn ?? 0}`);
  set('ST41', 'report', `${Array.isArray(rep.ponds) ? (rep.ponds as number[]).length / 2 : 0} ponds`);
  set('ST42', 'report', `cutBack ${pw.cutBack ?? 0}, allCross ${pw.allCross ?? 0}`);
  set('ST43', 'report', `${num(rep.filled)} lines filled`);
  set('ST45', 'report', `${pw.lakeLoopClosed ?? 0} closed`);
  const pc = rep.pondClosed ?? [];
  const pcBy: Record<string, number> = {};
  for (const s of pc) pcBy[String(s).split(/[ :]/)[0]] = (pcBy[String(s).split(/[ :]/)[0]] ?? 0) + 1;
  set('ST47', 'report', `${pc.length} closed ${JSON.stringify(pcBy)}`);
  set('ST48', 'report', `${num(rep.pondInflow)} outlets set to inflow`);
  const ends = (rep.ends ?? {}) as Record<string, number>;
  set('ST52', 'report', `${ends.sink ?? 0} streams end in a sink (${num(rep.hollows)} in a hollow, ${num(rep.sinks)} short of higher water)`);
  set('ST55', 'hook', `${at('refineSteep', A.refineNet)} calls from the network (streams.ts's own calls n/o)`);
  set('ST58', 'd', 'probe hook');
  // --- gullies, falls, pitchPool
  set('GU1', 'report', `${num(chains.heads)} chain heads`);
  set('FA1', 'report', `${num(shape.faultFalls)} falls of ${num(shape.faultCrossings)} crossings`);
  set('FA2', 'report', `${num(shape.hanging)} falls of ${num(shape.hangCandidates)} candidates`);
  set('FA3', 'report', `${num(shape.outletFalls)} falls`);
  set('FA5', 'stage', '(as RN36)');
  set('FA6', 'hook', `${h('bedGrain.calls')} lines`);
  const pitch = (rep.pitch ?? {}) as Rec & { deepen?: number[] };
  set('PP1', 'report', `${num(pitch.units)} units`);
  set('PP3', 'report', `${(pitch.deepen ?? []).filter((x) => x > 0.01).length} pool heads under the old level`);
  // --- heightfield.ts (build-time parts)
  set('HF2', 'report', `${fieldHeldCount()} stream samples held`);
  set('HF5', 'hook', '(as HS2)');
  set('HF6', 'report', `${num(rep.steps)} raster steps (as RN32)`);
  set('B:LEAVE_BELOW', 'report', `${num(sf.passing)} passing lines kept their levels`);

  // --- sample-time rules, heard while the owner's box is sampled (seed RF_BOX_SEED only)
  if (seed === Number(env.RF_BOX_SEED ?? 42)) {
    const [bn, be, half] = (env.RF_BOX ?? '-12200,-41300,3000').split(',').map(Number);
    const step = Number(env.RF_BOX_STEP ?? 25);
    HK.hits.set('box.on', 1);
    // HF12 (the carve's excess·t² gorge): the valleys the carve reads at each box point (hydrology.network.valleys,
    // heard on the network object), and after the sample, its excess against the natural ground (the carve's own h is
    // the natural ground less the small relief along streams: approximate).
    const net = hydrology.network as unknown as { valleys: (n: number, e: number, out: Array<Record<string, number>>) => number };
    const valleys0 = net.valleys;
    let got: Array<Record<string, number>> = [];
    net.valleys = (pn, pe, out) => {
      const k = valleys0.call(net, pn, pe, out);
      got = out.slice(0, k).map((v) => ({ ...v }));
      return k;
    };
    const vp = (dd: number, fp: number): number => (dd < fp ? 1.3 + 1.2 * Math.min(1, Math.max(0, (dd - 0.5 * fp) / (0.5 * fp))) ** 2 * (3 - 2 * Math.min(1, Math.max(0, (dd - 0.5 * fp) / (0.5 * fp)))) : 1.3 + 1.2 + 0.012 * (dd - fp) + 0.00011 * (dd - fp) ** 2);
    let samples = 0, inValley = 0, gorge = 0, gorgeMax = 0;
    for (let y = bn - half; y <= bn + half; y += step)
      for (let x = be - half; x <= be + half; x += step) {
        got = [];
        terrainHeight(y, x);
        samples++;
        if (!got.length) continue;
        inValley++;
        const h0 = naturalHeight(y, x);
        let lift = 0;
        for (const v of got) {
          const excess = Math.max(0, h0 - v.level - vp(v.floodplain + v.influence, v.floodplain));
          const t = Math.min(1, Math.max(0, (v.dist - v.floodplain) / v.influence));
          if (v.dist < v.floodplain + v.influence) lift = Math.max(lift, excess * t * t);
        }
        if (lift > 1) (gorge++, (gorgeMax = Math.max(gorgeMax, lift)));
      }
    net.valleys = valleys0;
    HK.hits.delete('box.on');
    const tag = `${samples} box samples`;
    set('DR20', 'box', `${at('holds', A.holdsCarve, '.true')} of ${at('holds', A.holdsCarve)} carve samples held by a lake shore (${tag})`);
    set('HF12', 'box', `${gorge} of ${inValley} valley samples lifted > 1 m by the excess term (max ${gorgeMax.toFixed(0)} m; ${tag}; h approx. the natural ground)`);
    set('HF13', 'box', `${at('holds', A.holdsBreach, '.true')} breach samples kept over a lake (${tag})`);
  }
  if (env.RF_DEBUG) console.log([...HK.hits.entries()].map(([k, v]) => `${k} ${v}`).join('\n'));
  return R;
}

it('rule fires', () => {
  const seeds = (env.RF_SEEDS ?? '1,42,777777').split(',').map(Number);
  const per = new Map<number, Map<string, [string, string]>>();
  for (const s of seeds) {
    const t0 = performance.now();
    per.set(s, measure(s));
    console.log(`seed ${s}: built and measured in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }
  setWorldSeed(0);
  const rows: Array<Record<string, string>> = [];
  const all = [...ROWS.map((r) => r[0]), 'B:FIELD_RAISE', 'B:FIELD_BANK', 'B:RAISE_BESIDE', 'B:LEAVE_BELOW', 'B:RECEIVERS_FIRST', 'V:FLOOD2', 'V:CUT_PASTE', 'V:LAKE_PASTE'];
  const meta = new Map(ROWS.map((r) => [r[0], r]));
  const appx: Record<string, [string, string, string, string]> = {
    'B:FIELD_RAISE': ['c', '(B)', '', 'FIELD_RAISE, RAISE_UNDER 1.5'],
    'B:FIELD_BANK': ['c', '(B)', '', 'FIELD_BANK_SLOPE 0.35, FIELD_BANK_WIDTH 8, FIELD_KEEP 6'],
    'B:RAISE_BESIDE': ['c', '(B)', '', 'RAISE_BESIDE 1, RAISE_BESIDE_REACH 20'],
    'B:LEAVE_BELOW': ['b', 'C', '', 'LEAVE_BELOW 1, the passing lake guard'],
    'B:RECEIVERS_FIRST': ['b', 'C', '', 'receivers-first order for AT_THE_SURFACE'],
    // Round V A1's added rows (drainage.ts buildDrainage's second flood).
    'V:FLOOD2': ['b', 'C', 'A1', 'second flood: receivers over the model\'s cells (routing), lakes and cuts from the first'],
    'V:CUT_PASTE': ['b', 'C', 'A1', 'the first flood\'s breach cuts carried into the second'],
    'V:LAKE_PASTE': ['b', 'C', 'A1', 'the first flood\'s lake levels carried into the second'],
  };
  const tally: Record<string, number> = {};
  const lines: string[] = [];
  for (const id of all) {
    const m = meta.get(id);
    const [cls, grp, fate, rule] = m ? [m[1], m[2], m[3], m[4]] : appx[id];
    let how = 'n/o';
    const vals = seeds.map((s) => {
      const v = per.get(s)!.get(id);
      if (v) how = v[0];
      return v ? v[1] : '-';
    });
    if (cls.startsWith('–') || cls === '-') how = '–';
    tally[how] = (tally[how] ?? 0) + 1;
    rows.push({ id, cls, grp, fate, rule, how, ...Object.fromEntries(seeds.map((s, k) => [`s${s}`, vals[k]])) });
    lines.push(`${id.padEnd(17)} ${cls.padEnd(6)} ${grp.padEnd(6)} ${how.padEnd(7)} ${vals.map((v) => v.padEnd(34)).join(' | ')} ${rule}`);
  }
  console.log(`ruleFires: ${all.length} rows (map 2: 203 counted + 5 infrastructure; appendix B: 5; Round V added: 3); by how counted ${JSON.stringify(tally)}`);
  console.log(`  anchors: ${JSON.stringify(A)}`);
  console.log(`${'id'.padEnd(17)} ${'cls'.padEnd(6)} ${'grp'.padEnd(6)} ${'how'.padEnd(7)} ${seeds.map((s) => `seed ${s}`.padEnd(34)).join(' | ')} rule`);
  for (const l of lines) console.log(l);
  if (env.RF_OUT) {
    mkdirSync(env.RF_OUT, { recursive: true });
    writeFileSync(`${env.RF_OUT}/ruleFires.json`, JSON.stringify({ seeds, anchors: A, rows }, null, 1));
  }
});
