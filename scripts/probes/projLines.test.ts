// Project drawn lines into a shot's camera (camPos, camLook; vertical fov PL_FOV deg, 1600 x 900): per sample every
// PL_EVERY m, the pixel position, the screen direction of the line, its distance and its water and bed-law widths in
// pixels (JSON lines for out/fs/tools2/bandwidth.py).
//   PL_SEED=42 PL_CAM=-12900,-43000,1050 PL_LOOK=-14100,-41900,700 PL_LINES=1074,1075 npx vitest run --config scripts/probes/vitest.config.ts projLines
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { bedWidth } from '../../src/world/terrain/streams';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('proj lines', () => {
  setWorldSeed(env.PL_SEED ?? '42');
  const [cn, ce, ca] = (env.PL_CAM ?? '').split(',').map(Number);
  const [ln, le, la] = (env.PL_LOOK ?? '').split(',').map(Number);
  // three.js frame: x east, y up, z -north.
  const C = [ce, ca, -cn], L = [le, la, -ln];
  const f = [L[0] - C[0], L[1] - C[1], L[2] - C[2]]; const fl = Math.hypot(...f); for (let i = 0; i < 3; i++) f[i] /= fl;
  const up = [0, 1, 0];
  const r = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]]; const rl = Math.hypot(...r); for (let i = 0; i < 3; i++) r[i] /= rl;
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const W = 1600, H = 900, fov = (Number(env.PL_FOV ?? 60) * Math.PI) / 180, k = H / 2 / Math.tan(fov / 2);
  const proj = (e: number, y: number, n: number): [number, number, number] => {
    const d = [e - C[0], y - C[1], -n - C[2]];
    const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
    return [W / 2 + (k * (d[0] * r[0] + d[1] * r[1] + d[2] * r[2])) / z, H / 2 - (k * (d[0] * u[0] + d[1] * u[1] + d[2] * u[2])) / z, z];
  };
  const R = hydrology.rivers!;
  for (const li of (env.PL_LINES ?? '').split(',').map(Number)) {
    const l = R[li];
    let next = 0;
    for (let i = 1; i + 1 < l.s.length; i++) {
      if (l.s[i] < next) continue;
      next = l.s[i] + Number(env.PL_EVERY ?? 100);
      const y = Math.max(l.level[i], terrainHeight(l.north[i], l.east[i]));
      const [px, py, z] = proj(l.east[i], y, l.north[i]);
      if (z <= 0 || px < 0 || px >= W || py < 0 || py >= H) continue;
      const [qx, qy] = proj(l.east[i + 1], Math.max(l.level[i + 1], terrainHeight(l.north[i + 1], l.east[i + 1])), l.north[i + 1]);
      const pix = z / k; // metres per pixel at this depth (square to the view)
      console.log(`PL ${JSON.stringify({ li, s: Math.round(l.s[i]), A: l.area?.[i], px, py, dx: qx - px, dy: qy - py, dist: Math.round(z), water: (2 * l.halfWidth[i]) / pix, bed: bedWidth(l.area?.[i] ?? 0) / pix })}`);
    }
  }
});
