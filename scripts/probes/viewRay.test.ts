// Foundation stage 4 steps: what a view's pixels land on. Rays from a fixed camera (camPos / camLook as the URL gives
// them, NED: north, east, alt; vertical field VR_FOV, VR_W x VR_H) marched onto sampleTerrain's ground; for each the
// hit point, its slope (5 m differences), the CPU's surface class, the largest step to a point 25 m away along the
// four axes, and the valley the hit lies in: its reach fraction (d - f) / I, its reach I, and whether a line's nearest
// axis point switches between the hit and a point 25 m away. Written as Float32 rows of VR_FIELDS to VR_OUT.
//   VR_SEED=42 VR_CAM=-10956,-39960,1199 VR_LOOK=-12718,-41720,682 VR_OUT=x.f32 npx vitest run --config scripts/probes/vitest.config.ts viewRay
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, terrainSurface } from '../../src/world/terrain/heightfield';
import type { ValleyNear } from '../../src/world/terrain/hydrology';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('view rays', () => {
  setWorldSeed(env.VR_SEED ?? '42');
  const [cn, ce, cz] = (env.VR_CAM ?? '').split(',').map(Number);
  const [ln, le, lz] = (env.VR_LOOK ?? '').split(',').map(Number);
  const W = Number(env.VR_W ?? 400), H = Number(env.VR_H ?? 225), fov = Number(env.VR_FOV ?? 55);
  const s = makeSample();
  const g = (n: number, e: number): number => sampleTerrain(n, e, s).ground;
  // Camera basis in (north, east, up).
  let fx = ln - cn, fy = le - ce, fz = lz - cz;
  const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
  // right = forward x up (north-east-up is left-handed seen from above: right of north is east).
  let rx = -fy, ry = fx, rz = 0; // east of facing
  const rl = Math.hypot(rx, ry); rx /= rl; ry /= rl;
  // up = right x forward, in this left-handed frame: (n,e,u)
  const ux = -fz * fx, uy = -fz * fy, uz = fx * fx + fy * fy;
  const ul = Math.hypot(ux, uy, uz);
  const th = Math.tan((fov * Math.PI) / 360), aspect = 1600 / 900;
  const out = new Float32Array(W * H * 8);
  const vals: ValleyNear[] = [];
  const reachAt = (n: number, e: number): [number, number, number] => {
    const k = hydrology.network ? hydrology.network.valleys(n, e, vals) : 0;
    let best = -Infinity, I = 0, line = -1;
    for (let j = 0; j < k; j++) {
      const v = vals[j];
      const t = (v.dist - v.floodplain) / v.influence;
      if (t > best) { best = t; I = v.influence; line = v.line ?? -1; }
    }
    return [k ? best : -9, I, line];
  };
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const sx = ((px + 0.5) / W * 2 - 1) * th * aspect, sy = (1 - (py + 0.5) / H * 2) * th;
      let dx = fx + rx * sx + (ux / ul) * sy, dy = fy + ry * sx + (uy / ul) * sy, dz = fz + (uz / ul) * sy;
      const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
      let t = 0, hit = false, prevT = 0;
      for (let k = 0; k < 4000 && t < 40000; k++) {
        const n = cn + dx * t, e = ce + dy * t, z = cz + dz * t;
        if (z < g(n, e)) { hit = true; break; }
        prevT = t;
        t += Math.max(5, t * 0.004);
      }
      const o = (py * W + px) * 8;
      if (!hit) { out[o] = NaN; continue; }
      let a = prevT, b = t;
      for (let k = 0; k < 20; k++) { const m = (a + b) / 2; if (cz + dz * m < g(cn + dx * m, ce + dy * m)) b = m; else a = m; }
      const n = cn + dx * b, e = ce + dy * b;
      const h0 = g(n, e);
      const gn = (g(n + 5, e) - g(n - 5, e)) / 10, ge = (g(n, e + 5) - g(n, e - 5)) / 10;
      const slope = (Math.atan(Math.hypot(gn, ge)) * 180) / Math.PI;
      let step = 0;
      for (const [an, ae] of [[25, 0], [-25, 0], [0, 25], [0, -25]]) step = Math.max(step, Math.abs(g(n + an, e + ae) - h0));
      const [rt, I, line] = reachAt(n, e);
      const surf = terrainSurface(n, e);
      out.set([n, e, h0, slope, step, rt, I, surf === 'rock' ? 1 : surf === 'snow' ? 2 : 0], o);
      void line;
    }
  }
  writeFileSync(env.VR_OUT ?? 'viewRay.f32', out);
  console.log(`wrote ${W}x${H}x8 to ${env.VR_OUT}`);
  setWorldSeed(0);
});
