// `node scripts/safari-geometry.mjs sweep`: the lighting sweep of the safari's first minute (see safari-geometry.mjs).
// The default boot (cockpit, the stub content, the SAFARI track) at each tod, shot at each time; per frame the
// river herd members' screen positions (projected in the page) are read back from the PNG: the herd / ground
// luminance contrast (mean luminance of the 3x3 pixels at each visible member vs the ring 10-16 px around it; ratio
// of the larger to the smaller), the auto-exposure, and where the sun is on screen.
//
//   --tods 17.8,18.3,18.6,19.0,19.4   --times 2,12   --out dir (PNGs: wp0a-sweep-<tod>-<t>.png)

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readPng } from './lib/png.mjs';

const EVAL = (t) => `(async () => {
  const sim = window.__sim, f = sim.fauna, H = f.herds, h = f.riverHerd;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  (() => { const seen = new Set(); const walk = (o, d) => { if (!o || typeof o !== 'object' || seen.has(o) || d > 4) return; seen.add(o); if (typeof o.updateLight === 'function' && 'light' in o) { o.updateLight = () => {}; if (o.light) o.light.upload.flush = () => {}; } for (const k of Object.keys(o)) { try { walk(o[k], d + 1); } catch {} } }; walk(sim.systems, 0); })();
  while (sim.summary().time < ${t}) await sleep(30);
  sim.pause(true);
  await sleep(400);
  const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\\/deps\\/three\\.js/.test(n));
  const T = await import(url);
  const cam = sim.ctx.camera, v = new T.Vector3(), pts = [];
  for (let k = 0; k < H.size[h]; k++) {
    const i = h * H.memberCap + k;
    v.set(H.mE[i], H.mH[i] + 1.2, -H.mN[i]).project(cam);
    if (v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1) pts.push([Math.round((v.x + 1) * innerWidth / 2), Math.round((1 - v.y) * innerHeight / 2)]);
  }
  let exposure = null;
  try { const px = new Float32Array(4); sim.ctx.renderer.readRenderTargetPixels(sim.post.exposure.adapted[0], 0, 0, 1, 1, px); exposure = +px[0].toFixed(3); } catch {}
  const sd = sim.ctx.sky.sunDir.clone().multiplyScalar(1e5).add(cam.position).project(cam);
  const s = sim.summary();
  return { t: s.time, tod: s.timeOfDay, pts, exposure, sun: [Math.round((sd.x + 1) * innerWidth / 2), Math.round((1 - sd.y) * innerHeight / 2), sd.z < 1], dayFactor: sim.ctx.sky.dayFactor, sunElev: +(Math.asin(sim.ctx.sky.sunDir.y) * 57.3).toFixed(1) };
})()`;

const lum = (img, x, y) => {
  const i = (y * img.width + x) * 4;
  const c = (k) => { const s = img.data[i + k] / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(0) + 0.7152 * c(1) + 0.0722 * c(2);
};

export async function sweep({ flags, shot }) {
  const tods = String(flags.tods ?? '17.8,18.3,18.6,19.0,19.4').split(',').map(Number);
  const times = String(flags.times ?? '2,12').split(',').map(Number);
  const out = resolve(flags.out ?? 'work/sweep');
  mkdirSync(out, { recursive: true });
  const rows = [];
  for (const tod of tods)
    for (const t of times) {
      const file = join(out, `wp0a-sweep-${tod}-${t}.png`);
      const r = shot(`index.html?era=cretaceous&ui=0&mute=1&resume=0&tod=${tod}`, file, EVAL(t));
      const img = readPng(file);
      let herd = 0, ground = 0, n = 0;
      for (const [x, y] of r.pts) {
        if (x < 18 || y < 18 || x >= img.width - 18 || y >= img.height - 18) continue;
        let a = 0, b = 0, na = 0, nb = 0;
        for (let dy = -16; dy <= 16; dy++)
          for (let dx = -16; dx <= 16; dx++) {
            const d = Math.hypot(dx, dy);
            if (d <= 1.5) { a += lum(img, x + dx, y + dy); na++; }
            else if (d >= 10 && d <= 16) { b += lum(img, x + dx, y + dy); nb++; }
          }
        herd += a / na;
        ground += b / nb;
        n++;
      }
      const ratio = n ? Math.max(herd, ground) / Math.max(1e-6, Math.min(herd, ground)) : null;
      const sunX = r.sun[2] ? r.sun[0] : null; // [x, y, in front of the eye]
      const central60 = sunX !== null && Math.abs(sunX - img.width / 2) < 0.3 * img.width;
      const row = { tod, t, members: n, herdLum: n ? +(herd / n).toFixed(4) : null, groundLum: n ? +(ground / n).toFixed(4) : null, contrast: ratio && +ratio.toFixed(2), exposure: r.exposure, sun: r.sun, sunElev: r.sunElev, sunInCentral60: central60, dayFactor: +r.dayFactor.toFixed(2), file };
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  return rows;
}
