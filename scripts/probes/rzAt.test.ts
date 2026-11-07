// Probe (sea-level rivers): a line's level nearest a point after the late passes (levelProbe: chan = channel pass,
// shape = shapeLines, pitch = pitchPool) and in the finished hydrology. RA_SEED, RA_LINE, RA_N, RA_E.
import { it } from 'vitest';
import { hydrology, naturalHeight } from '../../src/world/terrain/heightfield';
import { levelProbe } from '../../src/world/terrain/riverNetwork';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('river zero at', () => {
  const want = Number(env.RA_LINE ?? 1), n0 = Number(env.RA_N ?? 60884), e0 = Number(env.RA_E ?? -36230);
  const near = (n: ArrayLike<number>, e: ArrayLike<number>): number => { let b = 0, bd = Infinity; for (let k = 0; k < n.length; k++) { const d = Math.hypot(n[k] - n0, e[k] - e0); if (d < bd) (bd = d), (b = k); } return b; };
  levelProbe.on = (ph, li, L) => { if (li !== want || !['chan', 'shape', 'pitch'].includes(ph)) return; const { north: n, east: e, level } = L; const k = near(n, e); console.log(`${ph}: k ${k}/${n.length} at ${n[k].toFixed(0)},${e[k].toFixed(0)} level ${level[k].toFixed(1)} (k-20 ${level[Math.max(0, k - 20)].toFixed(1)}, k+20 ${level[Math.min(level.length - 1, k + 20)].toFixed(1)})`); };
  setWorldSeed(env.RA_SEED ?? '42');
  levelProbe.on = undefined;
  const r = hydrology.rivers![want];
  const k = near(r.north, r.east);
  console.log(`final: k ${k} level ${r.level[k].toFixed(1)} natural ${naturalHeight(r.north[k], r.east[k]).toFixed(1)} joins ${r.joins}`);
  setWorldSeed(0);
});
