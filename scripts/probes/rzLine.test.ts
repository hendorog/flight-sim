// Probe (sea-level rivers): one line's stage-A profile (riverNetwork.ts levelProbe): s, position, sampled ground (lowest
// of centre and +-80 m, lakes as banks), natural centre, lake level there, wet, level; the lattice cell under it
// (drainage height). RL_SEED, RL_LINE, RL_FROM, RL_TO (km), RL_STEP.
import { it } from 'vitest';
import { naturalHeight, seededDrainage } from '../../src/world/terrain/heightfield';
import { levelProbe, type LevelStage } from '../../src/world/terrain/riverNetwork';
import { DRAIN_CELL } from '../../src/world/terrain/drainage';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('river zero line', () => {
  const want = Number(env.RL_LINE ?? 0);
  let got: { P: LevelStage & { ground: Float64Array; wet: Uint8Array }; lake: Float64Array } | null = null;
  levelProbe.on = (ph, li, L) => { if (ph === 'A' && li === want) got = { P: { ...L, level: L.level.slice(), ground: L.ground!.slice(), wet: L.wet!.slice() }, lake: L.lake!.slice() }; };
  setWorldSeed(env.RL_SEED ?? '1');
  levelProbe.on = undefined;
  const d = seededDrainage!;
  const L = d.lines[want];
  const { P, lake } = got!;
  const from = Number(env.RL_FROM ?? 0) * 1000, to = Number(env.RL_TO ?? 1e9) * 1000, step = Number(env.RL_STEP ?? 4);
  const half = -d.origin;
  console.log(`line ${want} joins ${L.joins} cells ${L.cells.length} n ${d.n}`);
  for (let i = 0; i < P.s.length; i += step) {
    if (P.s[i] < from || P.s[i] > to) continue;
    const ci = Math.round((P.north[i] + half) / DRAIN_CELL), cj = Math.round((P.east[i] + half) / DRAIN_CELL);
    const lat = ci >= 0 && cj >= 0 && ci < d.n && cj < d.n ? d.height[ci * d.n + cj] : NaN;
    console.log(`${(P.s[i] / 1000).toFixed(2)} (${P.north[i].toFixed(0)},${P.east[i].toFixed(0)}) g ${P.ground[i].toFixed(1)} nat ${naturalHeight(P.north[i], P.east[i]).toFixed(1)} lake ${lake[i] > -1e9 ? lake[i].toFixed(1) : '-'} w${P.wet[i]} lv ${P.level[i].toFixed(1)} lat ${lat.toFixed(1)}`);
  }
  setWorldSeed(0);
});
