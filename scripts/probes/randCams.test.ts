// Probe (verify3): random cockpit views on land (RC_SEEDS, RC_N per seed, RC_AGL m over the ground, looking RC_LOOK m
// ahead and down to the ground there), from a fixed generator: lines "name query" for out/verify3/shots.sh.
import { it } from 'vitest';
import { naturalHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('random cams', () => {
  let r = 12345;
  const rnd = (): number => ((r = (r * 1103515245 + 12345) >>> 0) / 4294967296);
  for (const sd of (env.RC_SEEDS ?? '42,1,777777').split(',').map(Number)) {
    setWorldSeed(sd);
    let k = 0;
    for (let t = 0; t < 200 && k < Number(env.RC_N ?? 2); t++) {
      const n = (rnd() - 0.5) * 120000, e = (rnd() - 0.5) * 120000, a = rnd() * Math.PI * 2;
      const g = naturalHeight(n, e);
      if (g < 20) continue;
      const L = Number(env.RC_LOOK ?? 1500);
      const ln = n + Math.cos(a) * L, le = e + Math.sin(a) * L;
      const gl = naturalHeight(ln, le);
      if (gl < 5) continue;
      const agl = Number(env.RC_AGL ?? 137);
      console.log(`RC rnd${sd}${String.fromCharCode(97 + k)} seed=${sd}&camPos=${Math.round(n)},${Math.round(e)},${Math.round(g + agl)}&camLook=${Math.round(ln)},${Math.round(le)},${Math.round(gl)}`);
      k++;
    }
  }
  setWorldSeed(0);
});
