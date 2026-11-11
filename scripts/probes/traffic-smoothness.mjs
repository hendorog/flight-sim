#!/usr/bin/env node
// How smoothly the AI traffic moves on screen: records every rendered frame's drawn position of each moving
// traffic aircraft (its exterior or its far model, three.js world frame, relative to the camera) and the sim's
// rendered time, then reports the frame-to-frame speed scatter (std / mean of |displacement| / dt): a steadily
// moving aircraft drawn smoothly scores near 0; whole physics steps per frame or snaps score high.
//
//   node scripts/probes/traffic-smoothness.mjs [frames=400] [query]
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [N = '400', query = 'scenario=runway&cam=chase&tod=10&mute=1&hints=0&resume=0'] = process.argv.slice(2);
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const port = await freePort();
const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null }, optimizeDeps: { holdUntilCrawlEnd: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-webgl'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await p.goto(`http://127.0.0.1:${port}/index.html?${query}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await p.waitForTimeout(+(process.env.WAIT ?? 25000));
  const res = await p.evaluate(async (n) => {
    const sim = window.__sim, post = sim.post, orig = post.render, cam = sim.ctx.camera;
    const traffic = sim.traffic;
    const group = sim.ctx.scene.getObjectByName('circuit-traffic');
    const tracks = new Map();
    const frames = [];
    await new Promise((done) => {
      post.render = function (...a) {
        const r = orig.apply(this, a);
        const t = sim.physics.time * 1000;
        const c = cam.getWorldPosition(new cam.position.constructor());
        frames.push(t);
        for (const o of group.children) {
          if (!o.visible) continue;
          const w = o.getWorldPosition(new cam.position.constructor()).sub(c);
          let tr = tracks.get(o.uuid);
          if (!tr) tracks.set(o.uuid, (tr = { name: o.name, pts: [] }));
          tr.pts.push([frames.length - 1, w.x, w.y, w.z, c.distanceTo(o.getWorldPosition(new cam.position.constructor()))]);
        }
        if (frames.length >= n) { post.render = orig; done(); }
        return r;
      };
    });
    const flown = traffic.states.filter((s) => s.pilot).length;
    const out = [];
    for (const tr of tracks.values()) {
      const sp = [];
      for (let i = 1; i < tr.pts.length; i++) {
        const [f0, x0, y0, z0] = tr.pts[i - 1], [f1, x1, y1, z1, d] = tr.pts[i];
        if (f1 !== f0 + 1) continue;
        const dt = (frames[f1] - frames[f0]) / 1000;
        if (dt <= 0) continue;
        sp.push(Math.hypot(x1 - x0, y1 - y0, z1 - z0) / dt);
      }
      if (sp.length < 20) continue;
      const mean = sp.reduce((a, b) => a + b, 0) / sp.length;
      if (mean < 3) continue; // parked or holding
      // Scatter about a running 9-frame median (the aircraft's own speed changes slowly).
      let dev = 0;
      for (let i = 0; i < sp.length; i++) {
        const w = sp.slice(Math.max(0, i - 4), i + 5).sort((a, b) => a - b);
        const med = w[w.length >> 1];
        dev += (sp[i] - med) ** 2;
      }
      out.push({ name: tr.name, frames: sp.length, meanSpeed: +mean.toFixed(1), scatter: +(Math.sqrt(dev / sp.length) / mean).toFixed(3), dist: Math.round(tr.pts.at(-1)[4]) });
    }
    const fdt = frames.slice(1).map((t, i) => t - frames[i]);
    return { flown, frameMs: +(fdt.reduce((a, b) => a + b, 0) / fdt.length).toFixed(1), tracks: out };
  }, +N);
  console.log(JSON.stringify(res, null, 1));
} finally {
  await browser.close();
  await server.close();
}
