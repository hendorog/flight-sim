// Checker T1: seed 42 line 716 and the lines joining it / its pond's outlet: area profile.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../../../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('line 716', () => {
  setWorldSeed(Number(env.SEED ?? 42));
  terrainHeight(0, 0);
  const L = hydrology.rivers!;
  const show = (li: number) => {
    const r = L[li];
    const m = r.north.length - 1;
    const pts: string[] = [];
    const step = Math.max(1, Math.floor(m / 10));
    for (let i = 0; i <= m; i += step) pts.push(`s${r.s[i].toFixed(0)}:A${r.area![i].toFixed(1)}:hw${r.halfWidth[i].toFixed(1)}`);
    pts.push(`s${r.s[m].toFixed(0)}:A${r.area![m].toFixed(1)}:hw${r.halfWidth[m].toFixed(1)}`);
    console.log(`line ${li}: end ${r.end} joins ${r.joins} n ${m + 1} head ${r.north[0].toFixed(0)},${r.east[0].toFixed(0)} end ${r.north[m].toFixed(0)},${r.east[m].toFixed(0)} | ${pts.join(' ')}`);
  };
  for (const li of (env.LINES ?? '716').split(',').map(Number)) {
    show(li);
    for (let q = 0; q < L.length; q++) if (L[q].joins === li) { console.log(`  joiner:`); show(q); }
  }
  setWorldSeed(0);
});
