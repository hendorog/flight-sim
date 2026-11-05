// Probe: fixed-camera views (index.html camPos / camLook, NED m, alt MSL) of a seeded world's running water, for the
// combined shots of the streams work: a mountain lake and its outlet stream, a cascade with boulders, a fall from about
// 500 m, a stream joining a bigger river (with the river's width either side of the junction) and a placid lowland reach.
//   SITES_SEED=42 npx vitest run --config scripts/probes/vitest.config.ts mergedSites --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import type { RiverLine } from '../../src/world/terrain/hydrology';
import { setWorldSeed } from '../../src/world/worldSeed';

/** Highest ground within 60 m of a point (so a camera `above` m over it clears the nearby slopes). */
const groundTop = (n: number, e: number): number => {
  let g = -Infinity;
  for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) g = Math.max(g, terrainHeight(n + 30 * a, e + 30 * b));
  return g;
};

/** Position, level and unit direction on a line at arc length s (clamped to the line). */
const at = (r: RiverLine, s: number): { n: number; e: number; level: number; hw: number; dn: number; de: number; i: number } => {
  let i = 0;
  while (i < r.s.length - 2 && r.s[i + 1] < s) i++;
  const t = Math.min(1, Math.max(0, (s - r.s[i]) / (r.s[i + 1] - r.s[i] || 1)));
  const dn = r.north[i + 1] - r.north[i];
  const de = r.east[i + 1] - r.east[i];
  const l = Math.hypot(dn, de) || 1;
  return { n: r.north[i] + dn * t, e: r.east[i] + de * t, level: r.level[i] + (r.level[i + 1] - r.level[i]) * t, hw: r.halfWidth[i], dn: dn / l, de: de / l, i };
};

const view = (label: string, cn: number, ce: number, above: number, ln: number, le: number, lalt: number, note: string): void => {
  const alt = groundTop(cn, ce) + above;
  console.log(`${label}: camPos=${cn.toFixed(0)},${ce.toFixed(0)},${alt.toFixed(0)}&camLook=${ln.toFixed(0)},${le.toFixed(0)},${lalt.toFixed(0)}  (${note}; AGL ${(alt - terrainHeight(cn, ce)).toFixed(0)} m)`);
};

it('merged sites', () => {
  const seed = Number(process.env.SITES_SEED ?? 42);
  setWorldSeed(seed);
  const rs = hydrology.rivers!;
  const falls = hydrology.falls!;
  const lm = hydrology.lakeMask!;
  const fallsOn = (li: number, s0: number, s1: number): number => falls.filter((f) => f.line === li && rs[li].s[f.index] >= s0 && rs[li].s[f.index] <= s1).length;

  // 1. Mountain lake outlets: a stream leaving a lake, reaching another channel, dropping hardest in its first 3 km.
  const outlets: Array<{ li: number; drop: number; lake: number; len: number; nf: number }> = [];
  rs.forEach((r, li) => {
    if (r.kind !== 1 || lm.at(r.north[0], r.east[0]) === -Infinity || r.end !== 'channel') return;
    const lake = lm.at(r.north[0], r.east[0]);
    const end = at(r, 3000);
    outlets.push({ li, drop: lake - end.level, lake, len: r.s[r.s.length - 1], nf: fallsOn(li, 0, 3000) });
  });
  outlets.sort((a, b) => b.drop - a.drop);
  for (const o of outlets.slice(0, 6)) {
    const r = rs[o.li];
    const d = at(r, 250);
    const j = rs[r.joins ?? -1];
    console.log(`outlet line ${o.li}: lake ${o.lake.toFixed(0)} m, drop ${o.drop.toFixed(0)} m in 3 km, ${o.nf} falls, ${(o.len / 1000).toFixed(1)} km to line ${r.joins} (kind ${j?.kind}), head ${r.north[0].toFixed(0)},${r.east[0].toFixed(0)}`);
    // Over the lake, 700 m behind the outlet, looking down the stream 1.6 km on.
    const back = Number(process.env.OUT_BACK ?? 700);
    const ls = Number(process.env.OUT_LOOK ?? 1600);
    const l = at(r, ls);
    view(`  view outlet ${o.li}`, r.north[0] - d.dn * back, r.east[0] - d.de * back, Number(process.env.OUT_AGL ?? 220), l.n, l.e, l.level, `look at s ${ls}, level ${l.level.toFixed(0)}, hw there ${l.hw.toFixed(1)}`);
  }

  // 2. Cascades: the longest step-pool runs (regime >= 3), streams and rivers, with the falls on them.
  const runs: Array<{ li: number; a: number; b: number; len: number }> = [];
  rs.forEach((r, li) => {
    let a = -1;
    for (let i = 0; i <= r.north.length; i++) {
      const ok = i < r.north.length && (r.regime![i] ?? 0) >= 3;
      if (ok && a < 0) a = i;
      if (!ok && a >= 0) {
        runs.push({ li, a, b: i - 1, len: r.s[i - 1] - r.s[a] });
        a = -1;
      }
    }
  });
  runs.sort((x, y) => y.len - x.len);
  for (const u of runs.slice(0, 5)) {
    const r = rs[u.li];
    const mid = (r.s[u.a] + r.s[u.b]) / 2;
    const c = at(r, mid - 300);
    const l = at(r, mid + 150);
    console.log(`cascade line ${u.li} (kind ${r.kind}, hw ${r.halfWidth[u.a].toFixed(1)}): ${u.len.toFixed(0)} m of step-pool from s ${r.s[u.a].toFixed(0)}, ${fallsOn(u.li, r.s[u.a], r.s[u.b])} falls, level ${r.level[u.a].toFixed(0)} -> ${r.level[u.b].toFixed(0)}`);
    view(`  view cascade ${u.li}`, c.n - c.de * 60, c.e + c.dn * 60, 110, l.n, l.e, l.level, `mid s ${mid.toFixed(0)}`);
    // A low pass over the channel (about 25 m over the highest ground within 60 m, 120 m back) where the stones resolve.
    const c2 = at(r, mid - 120);
    const l2 = at(r, mid + 60);
    const side = Number(process.env.LOW_SIDE ?? 0);
    view(`  low pass ${u.li}`, c2.n - c2.de * side, c2.e + c2.dn * side, Number(process.env.LOW_ABOVE ?? 25), l2.n, l2.e, l2.level, 'low pass');
  }

  // 3. Falls seen from about 500 m: the biggest by width x drop, camera downstream and off to one side.
  const big = falls.map((f, k) => ({ f, k, score: f.width * (f.top - f.bottom) })).sort((a, b) => b.score - a.score);
  for (const { f, k } of big.slice(0, 5)) {
    const r = rs[f.line];
    const cn = f.north + f.dirN * 430 - f.dirE * 250;
    const ce = f.east + f.dirE * 430 + f.dirN * 250;
    console.log(`fall ${k}: line ${f.line} (kind ${r.kind}), ${(f.top - f.bottom).toFixed(1)} m drop, ${f.width.toFixed(1)} m wide, at ${f.north.toFixed(0)},${f.east.toFixed(0)}; ${fallsOn(f.line, r.s[f.index] - 500, r.s[f.index] + 500)} falls within 500 m`);
    view(`  view fall ${k}`, cn, ce, 150, f.north, f.east, (f.top + f.bottom) / 2, `distance ${Math.hypot(cn - f.north, ce - f.east).toFixed(0)} m`);
  }

  // 4. A stream joining a bigger river: the river's half-width a few samples above and below the junction.
  const joins: Array<{ li: number; j: number; k: number; up: number; dn: number; shw: number }> = [];
  rs.forEach((r, li) => {
    if (r.kind !== 1 || r.end !== 'channel' || r.joins === undefined || r.joins < 0) return;
    const j = rs[r.joins];
    if (j.kind !== 0) return;
    const n = r.north[r.north.length - 1];
    const e = r.east[r.east.length - 1];
    let k = 0;
    let best = Infinity;
    for (let i = 0; i < j.north.length; i++) {
      const d = Math.hypot(j.north[i] - n, j.east[i] - e);
      if (d < best) { best = d; k = i; }
    }
    if (best > 80 || k < 6 || k > j.north.length - 7) return;
    const shw = r.halfWidth[r.halfWidth.length - 1];
    joins.push({ li, j: r.joins, k, up: j.halfWidth[k - 6], dn: j.halfWidth[k + 6], shw });
  });
  // Visible: a stream at least 3 m half-width into a river 8-25 m, the step at least 0.4 m.
  // (JOIN=small: a narrow stream, 2-6 m, into a river at least twice as wide, biggest step first.)
  const small = process.env.JOIN === 'small';
  const goodJoins = joins
    .filter((x) => (small ? x.shw >= 2 && x.shw <= 6 && x.up >= 2 * x.shw && x.up <= 30 : x.shw >= 3 && x.up >= 8 && x.up <= 25 && x.dn - x.up >= 0.4))
    .sort((a, b) => (small ? b.dn - b.up - (a.dn - a.up) : b.shw - a.shw));
  console.log(`${joins.length} streams join a river; ${goodJoins.length} visible candidates`);
  for (const x of goodJoins.slice(0, 5)) {
    const r = rs[x.li];
    const s = r.s[r.s.length - 1];
    const c = at(r, s - 500);
    console.log(`join stream ${x.li} -> river ${x.j} at ${r.north[r.north.length - 1].toFixed(0)},${r.east[r.east.length - 1].toFixed(0)}: stream hw ${x.shw.toFixed(1)} m, river hw ${x.up.toFixed(1)} above -> ${x.dn.toFixed(1)} below (area ${rs[x.j].area?.[x.k - 6].toFixed(0)} -> ${rs[x.j].area?.[x.k + 6].toFixed(0)} km2)`);
    view(`  view join ${x.li}`, c.n - c.de * 120, c.e + c.dn * 120, 180, r.north[r.north.length - 1], r.east[r.east.length - 1], rs[x.j].level[x.k], 'looking down the stream at the junction');
  }

  // 4b. River-river confluences of two lines of similar size (a visible width step).
  const rr: Array<{ li: number; j: number; k: number; up: number; dn: number; hw: number }> = [];
  rs.forEach((r, li) => {
    if (r.kind === 1 || r.joins === undefined || r.joins < 0 || rs[r.joins].kind === 1) return;
    const j = rs[r.joins];
    const n = r.north[r.north.length - 1];
    const e = r.east[r.east.length - 1];
    let k = 0;
    let best = Infinity;
    for (let i = 0; i < j.north.length; i++) {
      const d = Math.hypot(j.north[i] - n, j.east[i] - e);
      if (d < best) { best = d; k = i; }
    }
    if (best > 80 || k < 30 || k > j.north.length - 31) return;
    const hw = r.halfWidth[r.halfWidth.length - 1];
    // Half-width 1 km above and below the junction (river samples are 20-35 m apart).
    const above = at(j, j.s[k] - 1000);
    const below = at(j, j.s[k] + 1000);
    rr.push({ li, j: r.joins, k, up: above.hw, dn: below.hw, hw });
  });
  rr.sort((a, b) => b.dn / b.up - a.dn / a.up);
  for (const x of rr.filter((y) => y.up >= 7 && y.up <= 15).slice(0, 4)) {
    const j = rs[x.j];
    const c = at(j, j.s[x.k] - 700);
    console.log(`confluence river ${x.li} (hw ${x.hw.toFixed(1)}) -> river ${x.j}: hw ${x.up.toFixed(1)} 1 km above -> ${x.dn.toFixed(1)} 1 km below, at ${j.north[x.k].toFixed(0)},${j.east[x.k].toFixed(0)}`);
    view(`  view confluence ${x.li}`, c.n - c.de * 150, c.e + c.dn * 150, 200, j.north[x.k], j.east[x.k], j.level[x.k], 'looking down the main river at the confluence');
  }

  // 5. Placid lowland reaches: the longest placid runs of wide rivers low down.
  const placid: Array<{ li: number; a: number; b: number; len: number }> = [];
  rs.forEach((r, li) => {
    if (r.kind === 1) return;
    let a = -1;
    for (let i = 0; i <= r.north.length; i++) {
      const ok = i < r.north.length && r.regime![i] === 0 && r.halfWidth[i] >= 15 && r.level[i] < 200;
      if (ok && a < 0) a = i;
      if (!ok && a >= 0) {
        placid.push({ li, a, b: i - 1, len: r.s[i - 1] - r.s[a] });
        a = -1;
      }
    }
  });
  placid.sort((x, y) => y.len - x.len);
  for (const u of placid.slice(0, 3)) {
    const r = rs[u.li];
    const mid = (r.s[u.a] + r.s[u.b]) / 2;
    const c = at(r, mid - 600);
    const l = at(r, mid + 300);
    console.log(`placid line ${u.li}: ${(u.len / 1000).toFixed(1)} km placid, hw ${r.halfWidth[u.a].toFixed(1)}, level ${r.level[u.a].toFixed(0)}`);
    view(`  view placid ${u.li}`, c.n - c.de * 80, c.e + c.dn * 80, 180, l.n, l.e, l.level, `mid s ${mid.toFixed(0)}`);
  }
  setWorldSeed(0);
});
