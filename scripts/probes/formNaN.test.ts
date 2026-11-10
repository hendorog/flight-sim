// Round V A4': every line's form fields finite (halfWidth, wet and bed edges, depth), per seed (FN_SEEDS).
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('form fields finite', () => {
  for (const seed of (env.FN_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const L = hydrology.rivers ?? [];
    let bad = 0;
    const shown: string[] = [];
    L.forEach((r, li) => {
      const f = r as unknown as Record<string, ArrayLike<number> | undefined>;
      for (const k of ['halfWidth', 'wetR', 'wetL', 'bedR', 'bedL', 'depth', 'level', 'north', 'east']) {
        const a = f[k];
        if (!a) continue;
        for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) {
          bad++;
          if (shown.length < 12) shown.push(`line ${li} kind ${r.kind} ${k}[${i}/${a.length}] = ${a[i]} area ${r.area?.[i]?.toFixed(2)} s ${r.s[i]?.toFixed(0)}`);
          break;
        }
      }
    });
    console.log(`seed ${seed}: ${L.length} lines, ${bad} non-finite fields`);
    for (const s of shown) console.log('  ' + s);
  }
  setWorldSeed(0);
});
