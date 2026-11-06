// Probe: camera views for the gully-floor before/after shots (stage A1): from each target a camera DIST m away on a
// bearing, at the highest ground within 600 m of it plus AGL m, looking at the target. Prints shot lines.
//   CAMS='42@-23664,71632@135' AGL=400 DIST=2500
import { it } from 'vitest';
import { terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('a1 cams', () => {
  const agl = Number(env.AGL ?? 400), dist = Number(env.DIST ?? 2500);
  for (const c of (env.CAMS ?? '').split(/\s+/).filter(Boolean)) {
    const [name, sd, at, brg] = c.split('@');
    setWorldSeed(Number(sd));
    const [tn, te] = at.split(',').map(Number);
    const b = (Number(brg) * Math.PI) / 180;
    const cn = tn + Math.cos(b) * dist, ce = te + Math.sin(b) * dist;
    let hi = -Infinity;
    for (let a = -3; a <= 3; a++) for (let k = -3; k <= 3; k++) hi = Math.max(hi, terrainHeight(cn + a * 200, ce + k * 200));
    const th = terrainHeight(tn, te);
    (globalThis as unknown as { process: { stderr: { write(s: string): void } } }).process.stderr.write(`CAM ${name} seed=${sd}&camPos=${cn.toFixed(0)},${ce.toFixed(0)},${(hi + agl).toFixed(0)}&camLook=${tn},${te},${th.toFixed(0)}\n`);
  }
  setWorldSeed(0);
});
