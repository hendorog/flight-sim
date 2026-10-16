#!/usr/bin/env node
// Fly a fixed camera toward a forest and grab frames.  node scripts/vegetation/approach.mjs <outPrefix> [W H]
// env: AGL (m, default 150), D0, D1 (horizontal distance to the forest point, m), N (frames), MODE (base|dense)
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [outPrefix, W = '1280', H = '720'] = process.argv.slice(2);
const E = process.env;
const cfg = { agl: +(E.AGL ?? 150), d0: +(E.D0 ?? 1500), d1: +(E.D1 ?? 200), n: +(E.N ?? 8), mode: E.MODE ?? 'base', sub: +(E.SUB ?? 30), fe: E.FE ? +E.FE : null, fn: E.FN ? +E.FN : null, hdg: +(E.HDG ?? 0), what: E.WHAT ?? 'fls', dr: +(E.DR ?? 40) };
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const port = await freePort();
const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null }, optimizeDeps: { holdUntilCrawlEnd: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-webgl', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
try {
  const ctx = await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
  await p.goto(`http://127.0.0.1:${port}/index.html?aircraft=c172s&scenario=downwind&ui=0&hud=0&cover=0&freeze=1&clock=0&tod=11&camPos=1100,-800,600&camLook=1100,-1500,200${E.EXTRA ?? ''}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const res = await p.evaluate(async (cfg) => {
    const sim = window.__sim, post = sim.post, gl = sim.ctx.renderer.getContext(), orig = post.render, v = window.__sim.systems.terrain.vegetation;
    const wait = (n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    // Forest point: densest loaded cell's tree centroid (or FE/FN given).
    let fe = cfg.fe, fn = cfg.fn, fy = 0;
    let best = null;
    for (const c of v.cells.values()) if (c.data && (!best || c.data.count > best.data.count)) best = c;
    if (fe === null) { fe = (best.cx + 0.5) * 256; fn = (best.cz + 0.5) * 256; }
    // Ground height: nearest tree base.
    let bd = Infinity;
    for (const c of v.cells.values()) { if (!c.data) continue; const a = c.data.instances; for (let i = 0; i < c.data.count; i++) { const o = i * 6; const d = (a[o] - fe) ** 2 + (a[o + 2] - fn) ** 2; if (d < bd) { bd = d; fy = a[o + 1]; } } }
    const h = cfg.hdg * Math.PI / 180, dn = Math.cos(h), de = Math.sin(h);
    const setCam = (d) => sim.sim.setFixedCamera([fn - dn * d, fe - de * d, fy + cfg.agl], [fn + dn * 400, fe + de * 400, fy]);
    if (cfg.mode === 'frozen') {
      const up = v.update.bind(v);
      let pos = null;
      v.update = (dt, c) => { up(dt, c); if (!pos && window.__freezeAt) pos = window.__freezeAt.clone(); if (pos) v.uniforms.uViewPos.value.copy(pos); };
    }
    if (cfg.mode === 'shift') {
      const process_what = cfg.what;
      const ap = v.applyRanges.bind(v);
      v.applyRanges = () => { ap(); if (window.__shift) { const k = window.__shift, u = v.uniforms, w = process_what; if (w.includes('f')) { u.uFade.value.x *= k; u.uFade.value.y *= k; } if (w.includes('l')) u.uLodFade.value.multiplyScalar(k); if (w.includes('s')) v.forestFade.multiplyScalar(k); } };
    }
    if (cfg.mode === 'frozenall') {
      const up = v.update.bind(v);
      let snap = null;
      v.update = (dt, c) => { up(dt, c); const u = v.uniforms;
        if (!snap && window.__freezeAt) snap = { vp: u.uViewPos.value.clone(), f: u.uFade.value.clone(), l: u.uLodFade.value.clone(), d: u.uDensityRange.value, ff: v.forestFade.clone(), ck: v.canopyKeep.clone() };
        if (snap) { u.uViewPos.value.copy(snap.vp); u.uFade.value.copy(snap.f); u.uLodFade.value.copy(snap.l); u.uDensityRange.value = snap.d; v.forestFade.copy(snap.ff); v.canopyKeep.copy(snap.ck); } };
    }
    if (cfg.mode === 'thin') {
      const process_dr = cfg.dr;
      const ap = v.applyRanges.bind(v);
      v.applyRanges = () => { ap(); v.uniforms.uDensityRange.value = +(process_dr); };
    }
    if (cfg.mode === 'dense') {
      const ap = v.applyRanges.bind(v);
      v.applyRanges = () => { ap(); v.uniforms.uDensityRange.value = 1e5; };
    }
    const out = [], info = [];
    for (let i = 0; i < cfg.n; i++) {
      const d = cfg.d0 + (cfg.d1 - cfg.d0) * i / Math.max(1, cfg.n - 1);
      // Approach in sub-steps so the streaming/list rebuilds behave as in flight.
      for (let s = cfg.sub; s >= 0; s--) { setCam(d + s * 2); await wait(1); }
      await wait(3);
      if (i === 0) { window.__freezeAt = sim.ctx.camera.position.clone(); await wait(2); }
      if (cfg.mode === 'shift') {
        const grab1 = () => new Promise((res) => { post.render = function (...a) { const r = orig.apply(this, a); const w = gl.drawingBufferWidth, hh = gl.drawingBufferHeight, px = new Uint8Array(w * hh * 4); gl.readPixels(0, 0, w, hh, gl.RGBA, gl.UNSIGNED_BYTE, px); const c = document.createElement('canvas'); c.width = w; c.height = hh; const c2 = c.getContext('2d'), img = c2.createImageData(w, hh); for (let y = 0; y < hh; y++) img.data.set(px.subarray((hh - 1 - y) * w * 4, (hh - y) * w * 4), y * w * 4); for (let k = 3; k < img.data.length; k += 4) img.data[k] = 255; c2.putImageData(img, 0, 0); out.push(c.toDataURL('image/png')); post.render = orig; res(); return r; }; });
        window.__shift = 0; await wait(20); await grab1();
        window.__shift = 1.3; await wait(20); await grab1();
        window.__shift = 0;
        info.push(JSON.stringify({ d: Math.round(d), fade: v.uniforms.uFade.value.toArray().map(Math.round), lod: v.uniforms.uLodFade.value.toArray().map(Math.round), ff: v.forestFade.toArray().map(Math.round), stats: v.stats }));
        continue;
      }
      info.push(JSON.stringify({ d: Math.round(d), forest: [Math.round(fe), Math.round(fn), Math.round(fy)], dense: Math.round(v.uniforms.uDensityRange.value), cap: v.far[0].array.length / 6, fade: v.uniforms.uFade.value.toArray().map(Math.round), stats: v.stats }));
      await new Promise((res) => {
        post.render = function (...a) {
          const r = orig.apply(this, a);
          const w = gl.drawingBufferWidth, hh = gl.drawingBufferHeight, px = new Uint8Array(w * hh * 4);
          gl.readPixels(0, 0, w, hh, gl.RGBA, gl.UNSIGNED_BYTE, px);
          const c = document.createElement('canvas'); c.width = w; c.height = hh;
          const c2 = c.getContext('2d'), img = c2.createImageData(w, hh);
          for (let y = 0; y < hh; y++) img.data.set(px.subarray((hh - 1 - y) * w * 4, (hh - y) * w * 4), y * w * 4);
          for (let k = 3; k < img.data.length; k += 4) img.data[k] = 255;
          c2.putImageData(img, 0, 0);
          out.push(c.toDataURL('image/png'));
          post.render = orig;
          res();
          return r;
        };
      });
    }
    return { out, info };
  }, cfg);
  res.info.forEach((s) => console.log(s));
  res.out.forEach((u, i) => writeFileSync(`${outPrefix}-${i}.png`, Buffer.from(u.split(',')[1], 'base64')));
  await ctx.close();
} finally {
  await browser.close();
  await server.close();
}
