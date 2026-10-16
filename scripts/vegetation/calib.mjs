#!/usr/bin/env node
// Forest appearance: impostors at full density vs the far canopy shell alone, over view directions.
//   node scripts/vegetation/calib.mjs <outJson>   env: TOD, PE, PN, D (m), PATCH (m), HDGS, ELEVS, EXTRA, SHOTS=prefix
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [outJson] = process.argv.slice(2);
const E = process.env;
const cfg = {
  pe: +(E.PE ?? -1500), pn: +(E.PN ?? 1500), d: +(E.D ?? 600), patch: +(E.PATCH ?? 150),
  hdgs: (E.HDGS ?? '0,45,90,135,180,225,270,315').split(',').map(Number),
  elevs: (E.ELEVS ?? '8,20,45').split(',').map(Number), shots: !!E.SHOTS, pick: E.PICK ?? null,
};
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const port = await freePort();
const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null }, optimizeDeps: { holdUntilCrawlEnd: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-webgl', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 320 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await p.goto(`http://127.0.0.1:${port}/index.html?aircraft=c172s&scenario=downwind&ui=0&hud=0&cover=0&cirrus=0&freeze=1&clock=0&tod=${E.TOD ?? 11}&vis=150000&camPos=${cfg.pn - 600},${cfg.pe},400&camLook=${cfg.pn},${cfg.pe},120${E.EXTRA ?? ''}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const res = await p.evaluate(async (cfg) => {
    const sim = window.__sim, gl = sim.ctx.renderer.getContext(), post = sim.post, orig = post.render, v = window.__sim.systems.terrain.vegetation;
    const wait = (n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    const grab = () => new Promise((res) => {
      post.render = function (...a) {
        const r = orig.apply(this, a);
        const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        // Mean linear colour of the middle third; and the image for inspection.
        let s = [0, 0, 0], n = 0;
        const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
        for (let y = Math.floor(h / 3); y < Math.floor(2 * h / 3); y++) for (let x = Math.floor(w / 3); x < Math.floor(2 * w / 3); x++) { const o = (y * w + x) * 4; s[0] += lin(px[o]); s[1] += lin(px[o + 1]); s[2] += lin(px[o + 2]); n++; }
        let url = null;
        if (cfg.shots) {
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          const c2 = c.getContext('2d'), img = c2.createImageData(w, h);
          for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
          for (let k = 3; k < img.data.length; k += 4) img.data[k] = 255;
          c2.putImageData(img, 0, 0); url = c.toDataURL('image/png');
        }
        post.render = orig;
        res({ m: s.map((x) => x / n), url });
        return r;
      };
    });
    let patches = [[cfg.pe, cfg.pn]];
    if (cfg.pick && cfg.pick.startsWith('hedge')) {
      const k = +cfg.pick.split('-')[1];
      const cand = [];
      for (const c of v.cells.values()) {
        if (!c.data) continue;
        const a = c.data.instances; let n = 0, se = 0, sn = 0;
        for (let i = 0; i < c.data.count; i++) if (a[i * 6 + 3] < 7) { n++; se += a[i * 6]; sn += a[i * 6 + 2]; }
        if (n > 20) cand.push([Math.round(se / n), Math.round(sn / n), n, Math.hypot(se / n + 1500, sn / n - 1500)]);
      }
      cand.sort((a, b) => b[2] - a[2]);
      patches = cand.filter((c) => c[3] < 4000).slice(0, k).map((c) => [c[0], c[1]]);
    } else if (cfg.pick) {
      const [lo, hi, k] = cfg.pick.split('-').map(Number);
      const cand = [];
      for (const c of v.cells.values()) if (c.data && c.data.count >= lo && c.data.count <= hi) cand.push([(c.cx + 0.5) * 256, (c.cz + 0.5) * 256, Math.hypot((c.cx + 0.5) * 256 + 1500, (c.cz + 0.5) * 256 - 1500)]);
      cand.sort((a, b) => a[2] - b[2]);
      patches = cand.slice(0, k).map((c) => [c[0], c[1]]);
    }
    const groundAt = (pe, pn) => { let gy = 120, bd = Infinity; for (const c of v.cells.values()) { if (!c.data) continue; const a = c.data.instances; for (let i = 0; i < c.data.count; i++) { const o = i * 6; const d = (a[o] - pe) ** 2 + (a[o + 2] - pn) ** 2; if (d < bd) { bd = d; gy = a[o + 1]; } } } return gy; };
    const vegRoot = sim.ctx.scene.getObjectByName('vegetation');
    const ap = v.applyRanges;
    const sun = sim.ctx.sky.sunDir.clone();
    const out = [];
    for (const [pe, pn] of patches) { const gy = groundAt(pe, pn); cfg.pe = pe; cfg.pn = pn;
    for (const elev of cfg.elevs) for (const hdg of cfg.hdgs) {
      const h = hdg * Math.PI / 180, el = elev * Math.PI / 180, hz = cfg.d * Math.cos(el);
      sim.sim.setFixedCamera([cfg.pn - Math.cos(h) * hz, cfg.pe - Math.sin(h) * hz, gy + 12 + cfg.d * Math.sin(el)], [cfg.pn, cfg.pe, gy + 12]);
      sim.sim.params.fov = 2 * Math.atan(cfg.patch / 2 / cfg.d) * 180 / Math.PI;
      vegRoot.visible = true; v.applyRanges = ap;
      await wait(90);
      const veg = await grab();
      vegRoot.visible = false; v.applyRanges = () => { ap.call(v); v.canopyKeep.w = 0; }; v.canopyKeep.w = 0;
      await wait(6);
      const bare = await grab();
      vegRoot.visible = true; v.applyRanges = ap;
      // Phase angle: between the direction to the camera and to the sun.
      const cam = sim.ctx.camera.position, tgt = { x: cfg.pe, y: gy + 12, z: -cfg.pn };
      const vx = cam.x - tgt.x, vy = cam.y - tgt.y, vz = cam.z - tgt.z, vl = Math.hypot(vx, vy, vz);
      const phase = Math.acos((vx * sun.x + vy * sun.y + vz * sun.z) / vl) * 180 / Math.PI;
      out.push({ pe, pn, hdg, elev, phase: +phase.toFixed(1), veg: veg.m, bare: bare.m, vu: veg.url, bu: bare.url });
    } }
    return { sun: sun.toArray(), out };
  }, cfg);
  if (cfg.shots) res.out.forEach((o) => { for (const [k, u] of [['veg', o.vu], ['bare', o.bu]]) writeFileSync(`${E.SHOTS}-${o.pe}_${o.pn}-h${o.hdg}e${o.elev}-${k}.png`, Buffer.from(u.split(',')[1], 'base64')); });
  res.out.forEach((o) => { delete o.vu; delete o.bu; });
  writeFileSync(outJson, JSON.stringify(res, null, 1));
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  console.log('sun', res.sun.map((x) => x.toFixed(2)).join(','));
  for (const o of res.out) console.log(`h${String(o.hdg).padStart(3)} e${String(o.elev).padStart(2)} phase ${String(o.phase).padStart(5)}  ratio r ${(o.veg[0] / o.bare[0]).toFixed(2)} g ${(o.veg[1] / o.bare[1]).toFixed(2)} b ${(o.veg[2] / o.bare[2]).toFixed(2)}  lum veg ${lum(o.veg).toFixed(4)} bare ${lum(o.bare).toFixed(4)}`);
  await ctx.close();
} finally {
  await browser.close();
  await server.close();
}
