// Round V A3r: at points PL_PTS (n,e;...): the sample (ground, river, standing, airportBlend, approach) and every channel
// near it (line, kind, distance, half-width, level). PL_SEED.
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, naturalHeight } from '../../src/world/terrain/heightfield';
import type { ChannelNear } from '../../src/world/terrain/hydrology';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('pt lines', () => {
  setWorldSeed(Number(env.PL_SEED ?? 42));
  const s = makeSample();
  const hits: ChannelNear[] = [];
  for (const p of (env.PL_PTS ?? '0,0').split(';')) {
    const [n, e] = p.split(',').map(Number);
    sampleTerrain(n, e, s);
    const k = hydrology.network!.channels(n, e, hits);
    const ch = hits.slice(0, k).map((c) => `[${c.line} k${c.kind} d ${c.dist.toFixed(1)} hw ${c.halfWidth.toFixed(1)} lv ${c.level.toFixed(2)}]`).join('');
    console.log(`PL ${n},${e} ground ${s.ground.toFixed(2)} river ${s.river.toFixed(2)} standing ${s.standing.toFixed(2)} blend ${s.airportBlend.toFixed(3)} approach ${s.approach.toFixed(2)} nat ${naturalHeight(n, e).toFixed(1)} ${ch}`);
  }
  setWorldSeed(0);
});
