// Probe: camera views for the 'look' round (steep water, its rocks, falls): a boulder cascade from ~100 m and on a
// low pass at ~40 m, and a calm lowland river (placid, a wide river low down) that must look as before.
//   SITES_SEED=42 npx vitest run --config scripts/probes/vitest.config.ts lookSites --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import type { RiverLine } from '../../src/world/terrain/hydrology';
import { setWorldSeed } from '../../src/world/worldSeed';

const at = (r: RiverLine, s: number): { n: number; e: number; level: number; dn: number; de: number } => {
  let i = 0;
  while (i < r.s.length - 2 && r.s[i + 1] < s) i++;
  const t = Math.min(1, Math.max(0, (s - r.s[i]) / (r.s[i + 1] - r.s[i] || 1)));
  const dn = r.north[i + 1] - r.north[i];
  const de = r.east[i + 1] - r.east[i];
  const l = Math.hypot(dn, de) || 1;
  return { n: r.north[i] + dn * t, e: r.east[i] + de * t, level: r.level[i] + (r.level[i + 1] - r.level[i]) * t, dn: dn / l, de: de / l };
};
const seed = Number(process.env.SITES_SEED ?? 42);
const view = (label: string, cn: number, ce: number, alt: number, ln: number, le: number, lalt: number): void => {
  console.log(`SITE ${label} seed=${seed}&camPos=${cn.toFixed(0)},${ce.toFixed(0)},${alt.toFixed(0)}&camLook=${ln.toFixed(0)},${le.toFixed(0)},${lalt.toFixed(0)}  AGL ${(alt - terrainHeight(cn, ce)).toFixed(0)}`);
};

it('look sites', () => {
  setWorldSeed(seed);
  const rs = hydrology.rivers!;
  // Cascades: line and arc length from env (default: seed 42's line 126, mid-run), else the longest big-stone run.
  const li = Number(process.env.CASCADE_LINE ?? 126);
  const r = rs[li];
  let a = -1;
  let best = { a: 0, b: 0, len: 0 };
  for (let i = 0; i <= r.north.length; i++) {
    const ok = i < r.north.length && r.regime![i] >= 3;
    if (ok && a < 0) a = i;
    if (!ok && a >= 0) {
      if (r.s[i - 1] - r.s[a] > best.len) best = { a, b: i - 1, len: r.s[i - 1] - r.s[a] };
      a = -1;
    }
  }
  const mid = (r.s[best.a] + r.s[best.b]) / 2;
  console.log(`cascade line ${li} kind ${r.kind} run ${best.len.toFixed(0)} m, hw ${r.halfWidth[best.a].toFixed(1)}, grain ${r.grain![best.a].toFixed(2)}..${r.grain![best.b].toFixed(2)}`);
  for (const [label, above, back, side] of [['cascade-100m', 100, 260, 70], ['cascade-40m', 40, 150, 25]] as const) {
    const c = at(r, mid + back);
    const l = at(r, mid - 40);
    view(label, c.n - c.de * side, c.e + c.dn * side, c.level + above, l.n, l.e, l.level);
  }
  // Calm lowland river: the widest placid river sample under 200 m above sea, away from the sea.
  let pick = { li: -1, i: 0, hw: 0 };
  rs.forEach((q, k) => {
    if (q.kind !== 0) return;
    for (let i = 50; i < q.north.length - 50; i += 10) {
      if (q.regime![i] !== 0 || q.level[i] > 200 || q.level[i] < 20) continue;
      if (q.halfWidth[i] > pick.hw && Math.abs(q.north[i]) < 120000 && Math.abs(q.east[i]) < 120000) pick = { li: k, i, hw: q.halfWidth[i] };
    }
  });
  const p = rs[pick.li];
  const c = at(p, p.s[pick.i]);
  console.log(`calm river line ${pick.li} hw ${pick.hw.toFixed(1)} level ${c.level.toFixed(0)} at ${c.n.toFixed(0)},${c.e.toFixed(0)}`);
  const back = at(p, p.s[pick.i] - 500);
  view('calm-river', back.n - back.de * 200, back.e + back.dn * 200, back.level + 250, c.n + c.dn * 300, c.e + c.de * 300, c.level);
  setWorldSeed(0);
});
