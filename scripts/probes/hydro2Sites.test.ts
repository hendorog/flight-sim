// Probe: camera views (index.html camPos / camLook, NED m, altitude MSL) for the hydrology round 2 shots: the tallest
// fault fall (or flight), a hanging-valley fall, a mountain lake's breached outlet and a long boulder cascade.
//   SITES_SEED=42 npx vitest run --config scripts/probes/vitest.config.ts hydro2Sites --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import type { RiverLine } from '../../src/world/terrain/hydrology';
import { setWorldSeed } from '../../src/world/worldSeed';

const groundTop = (n: number, e: number): number => {
  let g = -Infinity;
  for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) g = Math.max(g, terrainHeight(n + 40 * a, e + 40 * b));
  return g;
};
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
  console.log(`SITE ${label}: seed=${process.env.SITES_SEED ?? 42}&camPos=${cn.toFixed(0)},${ce.toFixed(0)},${alt.toFixed(0)}&camLook=${ln.toFixed(0)},${le.toFixed(0)},${lalt.toFixed(0)}  (${note}; AGL ${(alt - terrainHeight(cn, ce)).toFixed(0)} m)`);
};

it('hydro2 sites', () => {
  setWorldSeed(Number(process.env.SITES_SEED ?? 42));
  const rs = hydrology.rivers!;
  const falls = hydrology.falls!;
  const pick = Number(process.env.SITES_PICK ?? 0);
  // 1. Fault falls: the tallest flight (or single fall), widest first among equals.
  const byFlight = new Map<string, typeof falls[number][]>();
  falls.forEach((f, k) => { if (f.cause === 'fault') { const key = f.flight >= 0 ? `f${f.flight}` : `s${k}`; (byFlight.get(key) ?? byFlight.set(key, []).get(key)!).push(f); } });
  const flights = [...byFlight.values()].map((l) => ({ l, h: l.reduce((a, f) => a + f.height, 0), w: l[0].width })).sort((a, b) => b.h * Math.sqrt(b.w) - a.h * Math.sqrt(a.w));
  for (const { l, h } of flights.slice(pick, pick + 3)) {
    const f = l[0];
    const r = rs[f.line];
    console.log(`fault fall line ${f.line} (kind ${r.kind}) ${l.length} fall(s) ${h.toFixed(1)} m, ${f.width.toFixed(1)} m wide at ${f.north.toFixed(0)},${f.east.toFixed(0)}`);
    view(`fault${f.line}-500m`, f.north + f.dirN * 380 - f.dirE * 220, f.east + f.dirE * 380 + f.dirN * 220, 130, f.north, f.east, f.top - h / 2, 'downstream and off to the side');
  }
  // 2. Hanging falls.
  for (const f of falls.filter((x) => x.cause === 'hanging' || x.cause === 'outlet').sort((a, b) => b.height - a.height).slice(0, 6)) {
    const r = rs[f.line];
    console.log(`${f.cause} fall line ${f.line} (kind ${r.kind}) ${f.height.toFixed(0)} m, ${f.width.toFixed(1)} m wide at ${f.north.toFixed(0)},${f.east.toFixed(0)}`);
    view(`${f.cause}${f.line}`, f.north + f.dirN * 700 - f.dirE * 300, f.east + f.dirE * 700 + f.dirN * 300, 200, f.north, f.east, f.top - f.height / 2, 'from the valley below');
  }
  // 3. A mountain lake's outlet with the widest breach.
  const lm = hydrology.lakeMask!;
  const outs = rs.map((r, li) => ({ r, li })).filter(({ r }) => r.kind === 1 && lm.at(r.north[0], r.east[0]) > -Infinity && r.level[0] > 700 && r.end === 'channel' && (r.breach?.[0] ?? 0) > 0);
  outs.sort((a, b) => (b.r.breach![0] - a.r.breach![0]) || a.li - b.li);
  for (const { r, li } of outs.slice(pick, pick + 3)) {
    let rim = 0;
    while (rim < r.s.length - 1 && lm.at(r.north[rim], r.east[rim]) > -Infinity) rim++;
    const o = at(r, r.s[rim]);
    console.log(`outlet line ${li}: lake ${r.level[0].toFixed(0)} m, breach half-width ${r.breach![0].toFixed(0)} m, cut ${Math.max(...Array.from(r.cut!.slice(0, rim + 20))).toFixed(0)} m, rim at ${o.n.toFixed(0)},${o.e.toFixed(0)}`);
    view(`breach${li}`, o.n - o.dn * 900 + o.de * 250, o.e - o.de * 900 - o.dn * 250, 250, o.n + o.dn * 300, o.e + o.de * 300, o.level - 20, 'over the lake looking at the breach');
    const b = at(r, r.s[rim] + 900);
    view(`breach${li}-below`, b.n + b.dn * 300 - b.de * 400, b.e + b.de * 300 + b.dn * 400, 200, o.n, o.e, o.level, 'from below looking up the scar');
  }
  // 4. The longest cascade (regime 3) with big stones.
  const runs: Array<{ li: number; a: number; b: number; len: number }> = [];
  rs.forEach((r, li) => {
    let a = -1;
    for (let i = 0; i <= r.north.length; i++) {
      const ok = i < r.north.length && r.regime![i] >= 3 && (r.grain?.[i] ?? 0) > 1.5;
      if (ok && a < 0) a = i;
      if (!ok && a >= 0) { runs.push({ li, a, b: i - 1, len: r.s[i - 1] - r.s[a] }); a = -1; }
    }
  });
  runs.sort((x, y) => y.len * Math.sqrt(rs[y.li].halfWidth[y.a]) - x.len * Math.sqrt(rs[x.li].halfWidth[x.a]));
  for (const u of runs.slice(pick, pick + 3)) {
    const r = rs[u.li];
    const mid = (r.s[u.a] + r.s[u.b]) / 2;
    const c = at(r, mid + 250);
    const l = at(r, mid - 50);
    console.log(`cascade line ${u.li} (kind ${r.kind}, hw ${r.halfWidth[u.a].toFixed(1)}, grain ${r.grain![u.a].toFixed(1)} m): ${u.len.toFixed(0)} m from s ${r.s[u.a].toFixed(0)}, level ${r.level[u.a].toFixed(0)} -> ${r.level[u.b].toFixed(0)}`);
    view(`cascade${u.li}`, c.n - c.de * 80, c.e + c.dn * 80, 80, l.n, l.e, l.level, 'below, looking up the cascade');
  }
  setWorldSeed(0);
});
