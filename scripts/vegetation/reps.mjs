#!/usr/bin/env node
// One view, trees forced to each representation: normal, all LOD0, all LOD1, all impostors.
//   node scripts/vegetation/reps.mjs <outPrefix>   env: FE FN (forest point), AGL, BACK (camera horizontal offset, m), HDG, LOOKD (look-at distance ahead)
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [outPrefix] = process.argv.slice(2);
const E = process.env;
const cfg = { fe: +(E.FE ?? -384), fn: +(E.FN ?? 1408), agl: +(E.AGL ?? 80), hdg: +(E.HDG ?? 0), lookd: +(E.LOOKD ?? 150) };
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const port = await freePort();
const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null }, optimizeDeps: { holdUntilCrawlEnd: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-webgl', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await p.goto(`http://127.0.0.1:${port}/index.html?aircraft=c172s&scenario=downwind&ui=0&hud=0&cover=0&freeze=1&clock=0&tod=13&camPos=${cfg.fn},${cfg.fe},${120 + cfg.agl}&camLook=${cfg.fn + 100},${cfg.fe},120`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const res = await p.evaluate(async (cfg) => {
    const sim = window.__sim, post = sim.post, gl = sim.ctx.renderer.getContext(), orig = post.render, v = window.__sim.systems.terrain.vegetation;
    const wait = (n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    const grab = () => new Promise((res) => { post.render = function (...a) { const r = orig.apply(this, a); const w = gl.drawingBufferWidth, hh = gl.drawingBufferHeight, px = new Uint8Array(w * hh * 4); gl.readPixels(0, 0, w, hh, gl.RGBA, gl.UNSIGNED_BYTE, px); const c = document.createElement('canvas'); c.width = w; c.height = hh; const c2 = c.getContext('2d'), img = c2.createImageData(w, hh); for (let y = 0; y < hh; y++) img.data.set(px.subarray((hh - 1 - y) * w * 4, (hh - y) * w * 4), y * w * 4); for (let k = 3; k < img.data.length; k += 4) img.data[k] = 255; c2.putImageData(img, 0, 0); post.render = orig; res(c.toDataURL('image/png')); return r; }; });
    let gy = 120, bd = Infinity;
    for (const c of v.cells.values()) { if (!c.data) continue; const a = c.data.instances; for (let i = 0; i < c.data.count; i++) { const o = i * 6; const d = (a[o] - cfg.fe) ** 2 + (a[o + 2] - cfg.fn) ** 2; if (d < bd) { bd = d; gy = a[o + 1]; } } }
    const h = cfg.hdg * Math.PI / 180, dn = Math.cos(h), de = Math.sin(h);
    sim.sim.setFixedCamera([cfg.fn, cfg.fe, gy + cfg.agl], [cfg.fn + dn * cfg.lookd, cfg.fe + de * cfg.lookd, gy]);
    const ap = v.applyRanges;
    const out = [], info = [];
    const modes = { normal: null, lod0: (u) => { u.uLodFade.value.set(1e5, 2e5); u.uFade.value.x = 1e5; u.uFade.value.y = 2e5; u.uNearOpen.value.set(1e5, 2e5); }, lod1: (u) => { u.uLodFade.value.set(0, 1e-3); u.uFade.value.x = 1e5; u.uFade.value.y = 2e5; }, imp: (u) => { u.uFade.value.x = 0; u.uFade.value.y = 1e-3; u.uNearOpen.value.set(0, 1e-3); } };
    for (const [name, fn] of Object.entries(modes)) {
      v.applyRanges = fn ? () => { ap.call(v); fn(v.uniforms); } : ap;
      v.applyRanges(); v.lastNear.set(Infinity, 0, 0);
      await wait(40);
      out.push([name, await grab()]);
      info.push(JSON.stringify({ name, near: v.nearRange | 0, fade: v.uniforms.uFade.value.toArray().map(Math.round), lod: v.uniforms.uLodFade.value.toArray().map(Math.round), stats: v.stats }));
    }
    return { out, info };
  }, cfg);
  res.info.forEach((s) => console.log(s));
  res.out.forEach(([n, u]) => writeFileSync(`${outPrefix}-${n}.png`, Buffer.from(u.split(',')[1], 'base64')));
  await ctx.close();
} finally { await browser.close(); await server.close(); }
