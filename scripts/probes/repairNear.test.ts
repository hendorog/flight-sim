// Repair probe: the channels near a point (RP_SEED, RP_AT=n,e).
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('near', () => {
  setWorldSeed(Number(process.env.RP_SEED ?? 42));
  const [n, e] = (process.env.RP_AT ?? '5836,-27504').split(',').map(Number);
  const hits: any[] = [];
  const k = hydrology.network!.channels(n, e, hits);
  for (let j = 0; j < k; j++) { const h = hits[j]; const r = hydrology.rivers![h.line]; console.log(`line ${h.line} kind ${h.kind} dist ${h.dist.toFixed(1)} hw ${h.halfWidth.toFixed(1)} level ${h.level.toFixed(1)} end ${r.end} beyondSource ${h.beyondSource?.toFixed(1)}`); }
  setWorldSeed(0);
});
