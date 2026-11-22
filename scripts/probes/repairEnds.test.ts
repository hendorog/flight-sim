// Repair probe: stream endings per seed (REPAIR_SEEDS).
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('ends', () => {
  for (const seed of (process.env.REPAIR_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const rs = hydrology.rivers!;
    const ends: Record<string, number> = {};
    let n = 0;
    for (const r of rs) if (r.kind === 1) { n++; ends[r.end ?? '?'] = (ends[r.end ?? '?'] ?? 0) + 1; }
    const rep = hydrology.streamReport!;
    console.log(`seed ${seed}: streams ${n} ends ${JSON.stringify(ends)} sunk ${(((ends.sink ?? 0) + (ends.stuck ?? 0)) / n * 100).toFixed(1)} %; outlets ${rep.outlets} outlet ends ${JSON.stringify(rep.outletEnds)} no-outlet (high rim) ${rep.outletHigh}, to lake ${rep.outletToLake}, to sea ${rep.outletToSea}`);
  }
  setWorldSeed(0);
});
