// carveAt (round T): what the terrain's network carve sees at points: network.valleys and network.channels hits.
//   CA_SEED=777777 CA_PTS="-13776,31225" npx vitest run --config scripts/probes/vitest.config.ts carveAt --silent=false
import { it } from 'vitest';
import { hydrology, terrainHeight, naturalHeight, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('carve at', () => {
  setWorldSeed(Number(env.CA_SEED ?? 777777));
  terrainHeight(0, 0);
  const net = hydrology.network as unknown as { valleys(n: number, e: number, o: unknown[]): number; channels(n: number, e: number, o: unknown[]): number };
  const s = makeSample();
  for (const p of (env.CA_PTS ?? '-13776,31225').split(';')) {
    const [n, e] = p.split(',').map(Number);
    sampleTerrain(n, e, s);
    const vo: Record<string, number>[] = [], co: Record<string, number>[] = [];
    const nv = net.valleys(n, e, vo), nc = net.channels(n, e, co);
    console.log(`at ${n},${e}: natural ${naturalHeight(n, e).toFixed(1)} drawn ${s.ground.toFixed(1)} approach ${(s as unknown as { approach: number }).approach.toFixed(2)} airportBlend ${(s as unknown as { airportBlend?: number }).airportBlend}`);
    for (let k = 0; k < nv; k++) console.log(`   valley ${JSON.stringify(Object.fromEntries(Object.entries(vo[k]).map(([a, b]) => [a, Math.round(b * 10) / 10])))}`);
    for (let k = 0; k < nc; k++) console.log(`   channel ${JSON.stringify(Object.fromEntries(Object.entries(co[k]).map(([a, b]) => [a, Math.round(b * 10) / 10])))}`);
  }
  setWorldSeed(0);
});
