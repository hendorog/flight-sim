#!/usr/bin/env node
// The AI traffic on the ground, side-on at wheel height through the tower view (moved beside each aircraft): one
// picture per aircraft on the ground, with how high its reference point stands above the ground under it (the
// pavement as the flight models feel it) against its type's rest height, and whether it is flown or posed.
//
//   node scripts/probes/traffic-wheels.mjs <outDir> [query] [--wait 20000] [--side 9]
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
  await p.goto(`http://127.0.0.1:${port}/index.html?${query}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await p.waitForTimeout(+(flags.wait ?? 20000));
  const ids = await p.evaluate(() => window.__sim.traffic.states.filter((a) => a.state.onGround && a.pilot).map((a) => a.registration));
  console.log(`on the ground: ${ids.join(' ') || 'none'}`);
  for (const id of ids) {
    await p.evaluate(([id, side]) => {
      const sim = window.__sim, cams = sim.systems.cameras;
      cams.tower.followTarget(id);
      cancelAnimationFrame(window.__nearLoop ?? 0);
      const loop = () => {
        const a = sim.traffic.states.find((s) => s.registration === id);
        if (a) {
          // Square to its left side, at the height of its wheels' axles.
          const h = a.state.heading, n = a.state.north, e = a.state.east;
          const g = sim.physics.env.groundElevation(n, e);
          cams.setTowerPosition({ x: n + side * Math.sin(h), y: e - side * Math.cos(h), z: -(g + 0.25) });
        }
        window.__nearLoop = requestAnimationFrame(loop);
      };
      loop();
    }, [id, +(flags.side ?? 9)]);
    await p.waitForTimeout(2000);
    const info = await p.evaluate((id) => {
      const sim = window.__sim;
      const a = sim.traffic.states.find((s) => s.registration === id);
      const s = a.pilot.state;
      const ground = sim.physics.env.groundElevation(s.position.x, s.position.y);
      return {
        id, type: a.typeId, phase: a.ops?.phase ?? 'circuit', flown: !!a.physics,
        standsAt: +(a.drawn.pos.y - ground).toFixed(3),
        rest: a.pilot.def.geometry.restHeight,
        compression: s.wheels.map((w) => +w.compression.toFixed(3)),
        exterior: a.exterior?.root.visible ?? false,
      };
    }, id);
    const file = `${outDir}/${id.replace(/[^A-Z0-9]/gi, '')}.png`;
    await p.screenshot({ path: file });
    console.log(JSON.stringify(info), '->', file);
  }
} finally {
  await browser.close();
  await server.close();
}
