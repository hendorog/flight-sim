#!/usr/bin/env node
// Record the real sim (e.g. R22 demo in chase view): frames every K rendered frames.
//   node scripts/sim-record.mjs <outPrefix> '<query>' [N K]   env: WAIT (ms before recording)
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [outPrefix, query, N = '12', K = '30'] = process.argv.slice(2);
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const port = await freePort();
const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null }, optimizeDeps: { holdUntilCrawlEnd: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-webgl'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await p.goto(`http://127.0.0.1:${port}/index.html?${query}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await p.waitForTimeout(+(process.env.WAIT ?? 1000));
  const res = await p.evaluate(async ([n, k]) => {
    const sim = window.__sim, post = sim.post, gl = sim.ctx.renderer.getContext(), orig = post.render;
    const out = [], info = [];
    let f = 0;
    await new Promise((res) => {
      post.render = function (...a) {
        const r = orig.apply(this, a);
        if (f++ % k !== 0) return r;
        const s = sim.summary();
        info.push(`t ${s.time.toFixed(1)} agl ${s.altitudeAGL.toFixed(0)} gs ${s.groundSpeed.toFixed(1)} pos ${s.north.toFixed(0)},${s.east.toFixed(0)} hdg ${s.headingDeg}`);
        const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const c2 = c.getContext('2d'), img = c2.createImageData(w, h);
        for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
        for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
        c2.putImageData(img, 0, 0);
        out.push(c.toDataURL('image/jpeg', 0.9));
        if (out.length >= n) { post.render = orig; res(); }
        return r;
      };
    });
    return { out, info };
  }, [+N, +K]);
  res.info.forEach((s, i) => console.log(i, s));
  res.out.forEach((u, i) => writeFileSync(`${outPrefix}-${String(i).padStart(2, '0')}.jpg`, Buffer.from(u.split(',')[1], 'base64')));
  await ctx.close();
} finally { await browser.close(); await server.close(); }
