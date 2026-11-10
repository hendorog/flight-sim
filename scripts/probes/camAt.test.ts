// Round V B: a camera for each site (CA="name:seed:north,east;..."), by worstN's rule (1500 m back, 600 m up, from the
// side whose ground is lowest with a clear line of sight), looking at the drawn ground there.
import { it } from 'vitest';
import { terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
function camera(n: number, e: number, z: number): string {
  let best = '';
  let bestG = Infinity;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const cn = n + 1500 * Math.cos(a), ce = e + 1500 * Math.sin(a);
    const g = terrainHeight(cn, ce);
    let cz = z + 600;
    if (cz < g + 150) cz = g + 150;
    let clear = true;
    for (let t = 0.1; t < 0.95 && clear; t += 0.05) if (terrainHeight(cn + (n - cn) * t, ce + (e - ce) * t) > cz + (z - cz) * t - 8) clear = false;
    if (clear && g < bestG) {
      bestG = g;
      best = `camPos=${cn.toFixed(0)},${ce.toFixed(0)},${cz.toFixed(0)}&camLook=${n.toFixed(0)},${e.toFixed(0)},${z.toFixed(0)}`;
    }
  }
  return best;
}
it('cameras at sites', () => {
  let cur = NaN;
  for (const t of (env.CA ?? '').split(';').filter(Boolean)) {
    const [name, sd, at] = t.split(':');
    const seed = Number(sd);
    if (seed !== cur) {
      setWorldSeed(seed);
      terrainHeight(0, 0);
      cur = seed;
    }
    const [n, e] = at.split(',').map(Number);
    console.log(`CA ${name} seed=${seed}&${camera(n, e, terrainHeight(n, e))}`);
  }
  setWorldSeed(0);
});
