// Probe (foundation stage 3): the drawn falls by cause, and how many lie on rivers (kind 0) and streams.
//   FC_SEEDS=1,42,777777
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('falls by cause', () => {
  for (const seed of (env.FC_SEEDS ?? '42').split(',')) {
    setWorldSeed(Number(seed));
    const by = new Map<string, number[]>();
    for (const f of hydrology.falls) {
      const k = by.get(f.cause) ?? [0, 0];
      k[(hydrology.rivers[f.line].kind ?? 0) === 0 ? 0 : 1]++;
      by.set(f.cause, k);
    }
    console.log(`seed ${seed}: falls ${hydrology.falls.length}; ${[...by].map(([c, [r, s]]) => `${c} ${r + s} (rivers ${r}, streams ${s})`).join(', ')}`);
  }
  setWorldSeed(0);
});
