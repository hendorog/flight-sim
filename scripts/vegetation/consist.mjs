#!/usr/bin/env node
// Look at one patch of land from several distances, zoomed so it fills the frame: its appearance should not
// change with distance (only its detail).  node scripts/vegetation/consist.mjs <outPrefix> [W H]
// env: PE, PN (patch east/north, m), DISTS (comma list), ELEV (deg), PATCH (m across), HDG (view heading deg)
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [outPrefix, W = '640', H = '360'] = process.argv.slice(2);
const E = process.env;
const cfg = {
  pe: E.PE ? +E.PE : null, pn: E.PN ? +E.PN : null,
  dists: (E.DISTS ?? '300,600,1200,2400,4800').split(',').map(Number),
  elev: +(E.ELEV ?? 8), patch: +(E.PATCH ?? 300), hdg: +(E.HDG ?? 0), pick: E.PICK ?? null, wait: +(E.WAITF ?? 120),
};
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const port = await freePort();
const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null }, optimizeDeps: { holdUntilCrawlEnd: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-webgl', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
try {
  const ctx = await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await p.goto(`http://127.0.0.1:${port}/index.html?aircraft=c172s&scenario=downwind&ui=0&hud=0&cover=0&cirrus=0&freeze=1&clock=0&tod=11&vis=150000&camPos=1100,-800,600&camLook=1100,-1500,200${E.EXTRA ?? ''}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const res = await p.evaluate(async (cfg) => {
    const sim = window.__sim, post = sim.post, gl = sim.ctx.renderer.getContext(), orig = post.render, v = window.__sim.systems.terrain.vegetation;
    const wait = (n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    const out = [], info = [];
    let pe = cfg.pe, pn = cfg.pn;
    if (pe === null) {
      const [lo, hi] = (cfg.pick ?? '0-1e9').split('-').map(Number);
      let best = null, bd = Infinity;
      for (const c of v.cells.values()) {
        if (!c.data || c.data.count < lo || c.data.count > hi) continue;
        const e = (c.cx + 0.5) * 256, n = (c.cz + 0.5) * 256, dd = (e + 1500) ** 2 + (n - 1500) ** 2;
        if (dd < bd) { bd = dd; best = [e, n, c.data.count]; }
      }
      [pe, pn] = best; info.push(JSON.stringify({ patch: best }));
    }
    const groundAt = () => { let bd = Infinity, fy = 120; for (const c of v.cells.values()) { if (!c.data) continue; const a = c.data.instances; for (let i = 0; i < c.data.count; i++) { const o = i * 6; const d = (a[o] - pe) ** 2 + (a[o + 2] - pn) ** 2; if (d < bd) { bd = d; fy = a[o + 1]; } } } return fy; };
    const grab = () => new Promise((res) => {
      post.render = function (...a) {
        const r = orig.apply(this, a);
        const w = gl.drawingBufferWidth, hh = gl.drawingBufferHeight, px = new Uint8Array(w * hh * 4);
        gl.readPixels(0, 0, w, hh, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const c = document.createElement('canvas'); c.width = w; c.height = hh;
        const c2 = c.getContext('2d'), img = c2.createImageData(w, hh);
        for (let y = 0; y < hh; y++) img.data.set(px.subarray((hh - 1 - y) * w * 4, (hh - y) * w * 4), y * w * 4);
        for (let k = 3; k < img.data.length; k += 4) img.data[k] = 255;
        c2.putImageData(img, 0, 0);
        post.render = orig;
        res(c.toDataURL('image/png'));
        return r;
      };
    });
    const vegRoot = sim.ctx.scene.getObjectByName('vegetation');
    const h = cfg.hdg * Math.PI / 180, dn = Math.cos(h), de = Math.sin(h), el = cfg.elev * Math.PI / 180;
    let gy = null;
    for (const d of cfg.dists) {
      // Approach from far in steps so streaming settles as in flight.
      const set = () => {
        const hz = d * Math.cos(el);
        sim.sim.setFixedCamera([pn - dn * hz, pe - de * hz, (gy ?? 120) + d * Math.sin(el)], [pn, pe, gy ?? 120]);
        sim.sim.params.fov = 2 * Math.atan(cfg.patch / 2 / d) * 180 / Math.PI * (sim.ctx.camera.aspect > 1 ? 1 / sim.ctx.camera.aspect : 1);
      };
      set();
      await wait(cfg.wait);
      if (gy === null) { gy = groundAt(); set(); await wait(cfg.wait); }
      vegRoot.visible = true; await wait(4);
      out.push(await grab());
      vegRoot.visible = false; v.canopyKeep.w = 0; const ap = v.applyRanges; v.applyRanges = () => { ap.call(v); v.canopyKeep.w = 0; }; await wait(4);
      out.push(await grab());
      vegRoot.visible = true; v.applyRanges = ap;
      info.push(JSON.stringify({ d, gy: Math.round(gy), fov: +sim.ctx.camera.fov.toFixed(2), dense: Math.round(v.uniforms.uDensityRange.value), stats: v.stats }));
    }
    return { out, info };
  }, cfg);
  res.info.forEach((s) => console.log(s));
  res.out.forEach((u, i) => writeFileSync(`${outPrefix}${E.TAG ?? ''}-${cfg.dists[i >> 1]}-${i & 1 ? 'bare' : 'veg'}.png`, Buffer.from(u.split(',')[1], 'base64')));
  await ctx.close();
} finally {
  await browser.close();
  await server.close();
}
