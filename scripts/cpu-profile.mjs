#!/usr/bin/env node
// node scripts/cpu-profile.mjs "<page>" [ms]  -> top self-time functions over a CPU profile window
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [page, msArg] = process.argv.slice(2);
const ms = Number(msArg ?? 3000);
const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, optimizeDeps: { holdUntilCrawlEnd: true } });
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-webgl', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await p.goto(`http://127.0.0.1:${port}/${page}`, { waitUntil: 'load', timeout: 180000 });
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  await p.waitForTimeout(4000);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  const f0 = await p.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const tick = () => (++n < 2 ? requestAnimationFrame(tick) : r(t0)); requestAnimationFrame(tick); }));
  await cdp.send('Profiler.start');
  const frames = await p.evaluate((ms) => new Promise((r) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(tick); else r(n); }; requestAnimationFrame(tick); }), ms);
  const { profile } = await cdp.send('Profiler.stop');
  const dt = (profile.endTime - profile.startTime) / 1000;
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const counts = new Map();
  for (const s of profile.samples) counts.set(s, (counts.get(s) ?? 0) + 1);
  const total = profile.samples.length;
  for (const [id, c] of counts) {
    const n = byId.get(id);
    const cf = n.callFrame;
    const key = `${cf.functionName || '(anon)'} ${cf.url.replace(/^.*\/(src|node_modules)\//, '$1/').replace(/\?.*$/, '')}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + c);
  }
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const callers = new Map();
  for (const [id, c] of counts) {
    const n = byId.get(id);
    if (!['drawImage', 'texSubImage2D', 'texImage2D', 'getImageData', 'putImageData'].includes(n.callFrame.functionName)) continue;
    const chain = [];
    let q = parent.get(id);
    while (q && chain.length < 6) { const cf = byId.get(q).callFrame; chain.push(`${cf.functionName || '(anon)'}@${cf.url.replace(/^.*\/(src|node_modules)\//, '$1/').replace(/\?.*$/, '')}:${cf.lineNumber + 1}`); q = parent.get(q); }
    const key = n.callFrame.functionName + ' <- ' + chain.join(' <- ');
    callers.set(key, (callers.get(key) ?? 0) + c);
  }
  for (const [k, c] of [...callers].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log('CALLER', ((c / profile.samples.length) * dt / frames).toFixed(2), k);
  console.log(`${frames} frames in ${dt.toFixed(0)} ms -> ${(dt / frames).toFixed(2)} ms/frame`);
  for (const [k, c] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(((c / total) * dt / frames).toFixed(2).padStart(7), 'ms/f ', k);
} finally {
  await browser.close();
  await server.close();
}
