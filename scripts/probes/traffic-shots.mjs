#!/usr/bin/env node
// Pictures of the AI traffic through the tower view's binoculars: one per traffic aircraft drawn (each followed
// in turn), with what it was drawn as (its exterior or its far model), its distance and the frame time.
//
//   node scripts/probes/traffic-shots.mjs <outDir> [query] [--timescale 8] [--wait 25000] [--near 60]
//
//   --near m   move the tower to m metres off each aircraft while it is pictured (to see it close up, whatever
//              its distance from the field); the tower's own position otherwise
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < argv.length; i++) argv[i].startsWith('--') ? (flags[argv[i].slice(2)] = argv[++i]) : pos.push(argv[i]);
const [outDir, query = 'scenario=runway&cam=tower&tod=10&mute=1&hints=0&resume=0'] = pos;
mkdirSync(outDir, { recursive: true });
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const port = await freePort();
const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null }, optimizeDeps: { holdUntilCrawlEnd: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-webgl'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'warning' && m.text().includes('[traffic]')) console.log(`[warn] ${m.text()}`); });
  await p.goto(`http://127.0.0.1:${port}/index.html?${query}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  if (flags.timescale) await p.evaluate((s) => window.__sim.ctx.commands.setTimeScale(+s), flags.timescale);
  await p.waitForTimeout(+(flags.wait ?? 25000));
  const ids = await p.evaluate(() => window.__sim.traffic.viewTargets().map((t) => t.id));
  console.log(`targets: ${ids.join(' ')}`);
  for (const id of ids) {
    await p.evaluate(([id, near]) => {
      const sim = window.__sim, cams = sim.systems.cameras;
      cams.tower.followTarget(id);
      cancelAnimationFrame(window.__nearLoop ?? 0);
      if (!near) return;
      const loop = () => {
        const t = sim.traffic.viewTargets().find((x) => x.id === id);
        // three (x east, y up, z south) -> NED; off to the side and behind, a little above.
        if (t) cams.setTowerPosition({ x: -t.position.z - near * 0.6, y: t.position.x - near * 0.8, z: -(t.position.y + near * 0.25) });
        window.__nearLoop = requestAnimationFrame(loop);
      };
      loop();
    }, [id, +(flags.near ?? 0)]);
    await p.waitForTimeout(2500);
    const info = await p.evaluate((id) => {
      const sim = window.__sim, cam = sim.ctx.camera;
      const a = sim.traffic.states.find((s) => s.registration === id);
      const t = sim.traffic.viewTargets().find((x) => x.id === id);
      const ext = a?.exterior?.root.visible ?? false;
      return { id, phase: a?.ops?.phase ?? 'circuit', flown: !!(a?.pilot && a.physics), posed: !!(a?.pilot && !a.physics), drawn: ext ? 'exterior' : 'far', dist: t ? Math.round(t.position.distanceTo(cam.position)) : -1, fov: +cam.fov.toFixed(1) };
    }, id);
    const file = `${outDir}/${id.replace(/[^A-Z0-9]/gi, '')}.png`;
    await p.screenshot({ path: file });
    console.log(JSON.stringify(info), '->', file);
  }
} finally {
  await browser.close();
  await server.close();
}
