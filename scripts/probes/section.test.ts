// A cross-section of the drawn and natural ground: SEC_SEED, SEC_AT=n,e, SEC_DIR=n|e (the axis it runs along),
// SEC_HALF m either side, every SEC_STEP m; the nearest channels and valleys at each point.
//   SEC_SEED=1 SEC_AT=-12000,-98000 SEC_DIR=e npx vitest run --config scripts/probes/vitest.config.ts section
import { it } from 'vitest';
import { debugMacro, hydrology, makeSample, naturalHeight, sampleTerrain } from '../../src/world/terrain/heightfield';
import type { ChannelNear, ValleyNear } from '../../src/world/terrain/hydrology';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('section', () => {
  setWorldSeed(env.SEC_SEED ?? '1');
  const s = makeSample();
  for (const at of (env.SEC_AT ?? '0,0').split(';')) {
    const [n0, e0] = at.split(',').map(Number);
    const half = Number(env.SEC_HALF ?? 300), step = Number(env.SEC_STEP ?? 10);
    console.log(`section at ${n0},${e0} along ${env.SEC_DIR ?? 'e'}`);
    for (let x = -half; x <= half; x += step) {
      const n = env.SEC_DIR === 'n' ? n0 + x : n0, e = env.SEC_DIR === 'n' ? e0 : e0 + x;
      const g = sampleTerrain(n, e, s).ground;
      const nat = naturalHeight(n, e);
      const ch: ChannelNear[] = [];
      const k = hydrology.network!.channels(n, e, ch);
      const vs: ValleyNear[] = [];
      const kv = hydrology.network!.valleys(n, e, vs);
      const cs = ch.slice(0, k).filter((c) => c.dist < 400).map((c) => `C${c.line}${c.kind ? 's' : 'r'} d${c.dist.toFixed(0)} lv${c.level.toFixed(0)}${c.breach > 0 ? ` br${c.breach.toFixed(0)}/${c.reach.toFixed(0)}` : ''}`).join(' ');
      const vv = vs.slice(0, kv).map((v) => `V${v.line} t${((v.dist - v.floodplain) / v.influence).toFixed(2)} I${v.influence.toFixed(0)} lv${v.level.toFixed(0)}`).join(' ');
      const dm = debugMacro(n, e);
      console.log(`${x}\t${g.toFixed(1)}\t${nat.toFixed(1)}\tmg ${dm ? dm.s.m.toFixed(2) : '-'} m ${dm ? dm.s.m.toFixed(2) : '-'} hs ${dm ? dm.s.hs.toFixed(0) : '-'} coarse ${dm ? dm.coarse.toFixed(0) : '-'}\t${cs}\t${vv}`);
    }
  }
  setWorldSeed(0);
});
