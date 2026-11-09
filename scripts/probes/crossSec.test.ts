// Round S: the drawn ground across the nearest line at points (XS_PTS=n,e;n,e), every 25 m out to 400 m either side,
// against its water (FlowHit level), with the line's kind and half-width.
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('cross sections', () => {
  setWorldSeed(Number(env.XS_SEED ?? 1));
  const s = makeSample();
  const hit = { dist: Infinity, side: 0, line: -1, kind: 0, index: 0, s: 0, level: 0, halfWidth: 0, gradient: 0, steepness: 0, regime: 0, speed: 0, dirN: 0, dirE: 0 };
  for (const p of (env.XS_PTS ?? '').split(';')) {
    const [n, e] = p.split(',').map(Number);
    hydrology.queryFlow!(n, e, hit as never);
    const n0 = n - hit.side * hit.dist * -hit.dirE, e0 = e - hit.side * hit.dist * hit.dirN;
    const row: string[] = [];
    for (let o = -400; o <= 400; o += 25) { sampleTerrain(n0 - hit.dirE * o, e0 + hit.dirN * o, s); row.push((s.ground - hit.level).toFixed(0)); }
    console.log(`XS ${n},${e}: line ${hit.line} kind ${hit.kind} level ${hit.level.toFixed(1)} hw ${hit.halfWidth.toFixed(1)} grad ${hit.gradient.toFixed(3)}; ground - water from -400 to 400 m: ${row.join(' ')}`);
  }
});
