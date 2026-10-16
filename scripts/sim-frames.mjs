#!/usr/bin/env node
// Grab consecutive full-resolution sim frames in flight (after tone map) as PNGs.
//   node scripts/sim-frames.mjs <outPrefix> '<query>' [W H N]
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [outPrefix, query, W = '1920', H = '1080', N = '3'] = process.argv.slice(2);
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const port = await freePort();
const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null }, optimizeDeps: { holdUntilCrawlEnd: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-webgl', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
try {
  const ctx = await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await p.goto(`http://127.0.0.1:${port}/index.html?${query}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
  await p.waitForTimeout(+(process.env.WAIT ?? 8000));
  console.log(await p.evaluate(() => { const c = window.__sim.ctx; return JSON.stringify({ cam: c.camera.position, base: c.weather.cloudBaseM, top: c.weather.cloudTopM }); }));
  const urls = await p.evaluate(async (n) => {
    const sim = window.__sim, post = sim.post, gl = sim.ctx.renderer.getContext(), orig = post.render;
    const out = [];
    await new Promise((res) => {
      post.render = function (...a) {
        const r = orig.apply(this, a);
        const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const c2 = c.getContext('2d'), img = c2.createImageData(w, h);
        for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
        for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
        c2.putImageData(img, 0, 0);
        out.push(c.toDataURL('image/png'));
        if (out.length >= n) { post.render = orig; res(); }
        return r;
      };
    });
    return out;
  }, +N);
  urls.forEach((u, i) => writeFileSync(`${outPrefix}-${i}.png`, Buffer.from(u.split(',')[1], 'base64')));
  await ctx.close();
} finally {
  await browser.close();
  await server.close();
}
