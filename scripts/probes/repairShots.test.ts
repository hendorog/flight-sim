// Repair probe: fixed camera views (index.html camPos/camLook) for the repair shots. Prints one line per shot:
//   SHOT <name> seed=<s>&camPos=...&camLook=...
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';

const groundTop = (n: number, e: number): number => {
  let g = -Infinity;
  for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) g = Math.max(g, terrainHeight(n + 40 * a, e + 40 * b));
  return g;
};
const shot = (name: string, seed: number, cn: number, ce: number, agl: number, ln: number, le: number, lalt?: number): void => {
  const alt = Math.max(groundTop(cn, ce), terrainHeight(cn, ce)) + agl;
  const la = lalt ?? terrainHeight(ln, le);
  console.log(`SHOT ${name} seed=${seed}&camPos=${cn.toFixed(0)},${ce.toFixed(0)},${alt.toFixed(0)}&camLook=${ln.toFixed(0)},${le.toFixed(0)},${la.toFixed(0)}`);
};
/** Look at (n, e) from `dist` m away in compass direction `bearing` (deg, from the target to the camera), `agl` up. */
const from = (name: string, seed: number, n: number, e: number, bearing: number, dist: number, agl: number): void => {
  const b = (bearing * Math.PI) / 180;
  shot(name, seed, n + Math.cos(b) * dist, e + Math.sin(b) * dist, agl, n, e);
};

it('repair shots', () => {
  // Seed 777777: the 72 km trench of stream 457 (and the 201 m fall into it), side views from 1500 ft.
  setWorldSeed(777777);
  from('s777-trench457-side1500ft', 777777, 146140, -90330, 225, 2500, 457);
  from('s777-trench457-east1500ft', 777777, 145500, -90300, 80, 2600, 457);
  from('s777-trench457-south1500ft', 777777, 146140, -90330, 170, 3000, 600);
  from('s777-fall2146-wide', 777777, 126850, -86794, 30, 900, 250);
  shot('s777-hang114', 777777, -128546, 36708, 88, -128471, 37056);
  // Seed 1: the trench of stream 464, the unfed head of river 4.
  setWorldSeed(1);
  from('s1-trench464-side1500ft', 1, 159580, 152310, 200, 2500, 457);
  {
    const r = hydrology.rivers![4];
    from('s1-unfedhead4', 1, r.north[0], r.east[0], 210, 500, 150);
  }
  // Seed 42: a flight of falls on river 17, the outlet of lake 510 (the causeway), the median channel outlet 455's lake,
  // the featured mountain lake 529.
  setWorldSeed(42);
  from('s42-fall58-150m', 42, 62340, 138370, 300, 250, 150);
  shot('s42-sink510-150agl', 42, 8085, -49081, 150, 7750, -50343);
  shot('s42-outlet455-1500ft', 42, 85825, -9698, 457, 85054, -6173);
  shot('s42-lake529-1500ft', 42, -43145, 48892, 475, -39948, 49954);
  from('s42-cascade126-100agl', 42, 70520, 123110, 250, 350, 100);
  // The deepest hollow the streams filled to its sill (repairFill).
  from('s42-fill-1500ft', 42, -88630, 23130, 200, 2200, 457);
  from('s42-fill-150agl', 42, -88630, 23130, 200, 700, 150);
  // A stream joining a river, and a river-river confluence (largest receiver width steps).
  const rs = hydrology.rivers!;
  let best = { li: -1, step: 0 };
  rs.forEach((r, li) => {
    if (r.kind !== 1 || r.joins < 0 || rs[r.joins].kind !== 0 || r.halfWidth[r.halfWidth.length - 1] < 3) return;
    const P = rs[r.joins];
    const m = r.north.length;
    let bj = 0, bd = Infinity;
    for (let j = 0; j < P.north.length; j++) { const d = Math.hypot(P.north[j] - r.north[m - 1], P.east[j] - r.east[m - 1]); if (d < bd) { bd = d; bj = j; } }
    if (bd > 200 || P.halfWidth[bj] > 14) return;
    let ju = bj, jd = bj;
    while (ju > 0 && P.s[ju] > P.s[bj] - 300) ju--;
    while (jd < P.s.length - 1 && P.s[jd] < P.s[bj] + 300) jd++;
    const st = P.halfWidth[jd] - P.halfWidth[ju];
    if (st > best.step && Math.abs(r.north[m - 1]) < 150000 && Math.abs(r.east[m - 1]) < 150000) best = { li, step: st };
  });
  if (best.li >= 0) {
    const r = rs[best.li];
    const m = r.north.length;
    console.log(`  join stream ${best.li} into ${r.joins}: step ${best.step.toFixed(1)} m, stream hw ${r.halfWidth[m - 1].toFixed(1)}`);
    from('s42-join-stream-river', 42, r.north[m - 1], r.east[m - 1], 160, 450, 180);
  }
  setWorldSeed(0);
});
