// Probe (sea-level rivers): the ground along one line's stage-A axis taken apart (heightfield.ts debugMacro): the noise
// ground (coarseRaw), with the model's offset (coarse), the full ground; the model's change d, carve c, floor f, give-way
// w, noise B-spline r; and the lattice cell of the line nearest. RL_SEED, RL_LINE, RL_FROM, RL_TO (km), RL_STEP.
import { it } from 'vitest';
import { debugMacro, seededDrainage } from '../../src/world/terrain/heightfield';
import { levelProbe, type LevelStage } from '../../src/world/terrain/riverNetwork';
import { cellEast, cellNorth } from '../../src/world/terrain/drainage';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('river zero decomposition', () => {
  const want = Number(env.RL_LINE ?? 0);
  let got: { P: LevelStage } | null = null;
  levelProbe.on = (ph, li, L) => { if (ph === 'A' && li === want) got = { P: { ...L, level: L.level.slice() } }; };
  setWorldSeed(env.RL_SEED ?? '1');
  levelProbe.on = undefined;
  const d = seededDrainage!;
  const L = d.lines[want];
  const { P } = got!;
  const from = Number(env.RL_FROM ?? 0) * 1000, to = Number(env.RL_TO ?? 1e9) * 1000, step = Number(env.RL_STEP ?? 4);
  for (let i = 0; i < P.s.length; i += step) {
    if (P.s[i] < from || P.s[i] > to) continue;
    let bc = 0, bd = Infinity;
    for (const c of L.cells) { const dd = Math.hypot(cellNorth(d, c) - P.north[i], cellEast(d, c) - P.east[i]); if (dd < bd) (bd = dd), (bc = c); }
    const m = debugMacro(P.north[i], P.east[i])!;
    const s = m.s;
    console.log(`${(P.s[i] / 1000).toFixed(2)} (${P.north[i].toFixed(0)},${P.east[i].toFixed(0)}) raw ${m.coarseRaw.toFixed(1)} coarse ${m.coarse.toFixed(1)} ground ${m.ground.toFixed(1)} | d ${s.d.toFixed(1)} c ${s.c.toFixed(1)} f ${s.f.toFixed(2)} w ${s.w.toFixed(2)} r ${s.r.toFixed(1)} keep ${s.keep.toFixed(2)} | cell ${d.height[bc].toFixed(1)} at ${bd.toFixed(0)} m | lv ${P.level[i].toFixed(1)}`);
  }
  setWorldSeed(0);
});
