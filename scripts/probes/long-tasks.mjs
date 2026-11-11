#!/usr/bin/env node
// Main-thread stalls: every long task (over 50 ms) from the page's ready to `seconds` later, with the frame-time
// percentiles over that window (the sim's own rAF intervals). For checking that something built at run time
// (traffic exteriors, models) does not stall the frames.
//
//   node scripts/probes/long-tasks.mjs [seconds=40] [query]
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [secs = '40', query = 'scenario=runway&cam=chase&tod=10&mute=1&hints=0&resume=0'] = process.argv.slice(2);
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const port = await freePort();
const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null }, optimizeDeps: { holdUntilCrawlEnd: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-webgl'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    window.__long = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true });
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await p.goto(`http://127.0.0.1:${port}/index.html?${query}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const r = await p.evaluate(async (s) => {
    const t0 = performance.now();
    const dts = [];
    let last = t0;
    await new Promise((done) => {
      const f = (t) => { dts.push(t - last); last = t; if (t - t0 < s * 1000) requestAnimationFrame(f); else done(); };
      requestAnimationFrame(f);
    });
    dts.sort((a, b) => a - b);
    const q = (x) => dts[Math.min(dts.length - 1, Math.floor(x * dts.length))].toFixed(1);
    const long = window.__long.filter(([t]) => t >= t0).map(([t, d]) => `${((t - t0) / 1000).toFixed(1)}s:${d}ms`);
    return { frames: dts.length, p50: q(0.5), p99: q(0.99), max: dts.at(-1).toFixed(0), long };
  }, +secs);
  console.log(JSON.stringify(r));
} finally {
  await browser.close();
  await server.close();
}
