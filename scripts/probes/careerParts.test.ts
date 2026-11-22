// Probe: where a seeded world's first career boards spend their time (landmarks, site anchors, sites, boards).
import { it } from 'vitest';
import { boardFor } from '../../src/career/jobs';
import { landmarks } from '../../src/career/landmarks';
import { helicopterSites, siteAnchors } from '../../src/career/sites';
import { airfields } from '../../src/world/airfields';
import { setEra } from '../../src/world/era/eraState';
import '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('career parts', () => {
  setEra('present');
  const seed = Number(process.env.CB_SEED ?? 42);
  setWorldSeed(seed);
  const fields = airfields();
  const t = (f: () => unknown) => { const t0 = performance.now(); const r = f(); return [performance.now() - t0, r] as const; };
  const [tl, L] = t(() => landmarks(fields));
  const [ta, A] = t(() => siteAnchors());
  const [ts, S] = t(() => helicopterSites(fields));
  const per: string[] = [];
  for (const f of fields) { const [tb] = t(() => boardFor(seed, 1, f.code, fields)); per.push(tb.toFixed(0)); }
  console.log(`seed ${seed}: landmarks ${tl.toFixed(0)} ms (${(L as unknown[]).length}), site anchors ${ta.toFixed(0)} ms (${(A as unknown[]).length}), sites ${ts.toFixed(0)} ms (${(S as unknown[]).length}); boards ${per.join(' ')} ms`);
  setWorldSeed(0);
});
