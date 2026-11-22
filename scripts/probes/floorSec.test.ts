// Round S: the slopes' ground (gullies.ts GullyNet.h), its routing and channel weight on the fine-grid nodes about a
// point (FS_AT=north,east, FS_R nodes), and the drawn ground on a transect (FS_T=n0,e0,n1,e1, 10 m).
import { it } from 'vitest';
import { terrainHeight, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { gullyNet, inV } from '../../src/world/terrain/gullies';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const ARROW = ['↖', '↑', '↗', '←', '→', '↙', '↓', '↘'];
it('floor section', () => {
  setWorldSeed(Number(env.FS_SEED ?? 42));
  terrainHeight(0, 0);
  const g = gullyNet()!;
  if (env.FS_AT) {
    const [N, E] = env.FS_AT.split(',').map(Number);
    const R = Number(env.FS_R ?? 4);
    const y0 = Math.round((N - g.origin) / g.cell), x0 = Math.round((E - g.origin) / g.cell);
    for (let y = y0 + R; y >= y0 - R; y--) {
      let row = `${(g.origin + y * g.cell).toFixed(0).padStart(7)} `;
      for (let x = x0 - R; x <= x0 + R; x++) {
        const q = y * g.n + x;
        // (Rows printed north at the top: DI -1 is south in the array, so flip the arrows' vertical sense.)
        const d = g.dir[q];
        const a = d ? ['↙', '↓', '↘', '←', '→', '↖', '↑', '↗'][d - 1] : '·';
        row += `${g.h[q].toFixed(0).padStart(5)}${a}${inV(g, q) ? 'v' : ' '}${g.area[q] >= 1 ? 'A' : ' '}`;
      }
      console.log(row);
    }
    let hdr = '        ';
    for (let x = x0 - R; x <= x0 + R; x++) hdr += `${(g.origin + x * g.cell).toFixed(0).padStart(8)}`;
    console.log(hdr);
  }
  if (env.FS_T) {
    const [n0, e0, n1, e1] = env.FS_T.split(',').map(Number);
    const L = Math.hypot(n1 - n0, e1 - e0), s = makeSample();
    const out: string[] = [];
    for (let t = 0; t <= L; t += 10) { const n = n0 + ((n1 - n0) * t) / L, e = e0 + ((e1 - e0) * t) / L; sampleTerrain(n, e, s); out.push(s.ground.toFixed(1)); }
    console.log(`T ${out.join(' ')}`);
  }
  setWorldSeed(0);
});
