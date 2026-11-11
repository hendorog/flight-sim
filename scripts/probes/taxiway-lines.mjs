#!/usr/bin/env node
// The yellow taxiway markings as a pilot sees them: free-look views at cockpit eye height from fixed spots on the
// home field (looking down taxiway A, round the A/B1 junction, along the apron taxilane, a connector's lead-on),
// each wide and zoomed, at midday, so line width and sharpness with distance can be compared before and after.
//
//   node scripts/probes/taxiway-lines.mjs <outDir> [--eye 1.2] [--wait 8000] [--only a-wide,apron-lane]
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
const [outDir] = pos;
if (!outDir) throw new Error('usage: taxiway-lines.mjs <outDir>');
mkdirSync(outDir, { recursive: true });
const eye = +(flags.eye ?? 1.2);

// name, eye (u, v), look-at (u, v) on the ground, fov deg. Airport-local metres (layout.ts): taxiway A at v = -120.
const VIEWS = [
  ['a-wide', [-500, -120], [-200, -120], 60],
  ['a-100', [-500, -120], [-400, -120], 20],
  ['a-300', [-500, -120], [-200, -120], 10],
  ['a-600', [-500, -120], [100, -120], 6],
  ['junction-b1', [-140, -121], [-60, -128], 40],
  ['apron-lane', [-150, -275], [-50, -275], 40],
  ['apron-tiedowns', [-150, -288], [-90, -303], 40],
  ['lead-on-a2', [-300, -85], [-300, -40], 40],
  // The runway designations from short final (15 m up, 400 m out) and from the far end's threshold (the "25").
  ['digits-final', [-1300, 0, 15], [-830, 0], 12],
  ['digits-25', [-700, -8], [830, 0], 8],
];

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const port = await freePort();
const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null }, optimizeDeps: { holdUntilCrawlEnd: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-webgl'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && console.log(`[console] ${m.text().slice(0, 400)}`));
  await p.goto(`http://127.0.0.1:${port}/index.html?scenario=runway&cam=tower&tod=12&mute=1&hints=0&resume=0&traffic=0`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await p.waitForTimeout(+(flags.wait ?? 8000));
  const only = flags.only?.split(',');
  for (const [name, from, to, fov] of VIEWS.filter(([n]) => !only || only.includes(n))) {
    const at = await p.evaluate(async ([from, to, fov, eye]) => {
      const { localToWorld } = await import('/src/world/airport/lights.ts');
      const sim = window.__sim, tower = sim.systems.cameras.tower;
      const a = localToWorld(from[0], from[1], from[2] ?? eye), b = localToWorld(to[0], to[1], 0);
      const d = b.clone().sub(a).normalize();
      tower.free = true;
      tower.spot.copy(a);
      tower.yaw = Math.atan2(-d.x, -d.z);
      tower.pitch = Math.asin(d.y);
      tower.freeFov = fov;
      tower.fov = fov;
      return [a.x, a.y, a.z].map((x) => +x.toFixed(1));
    }, [from, to, fov, eye]);
    await p.waitForTimeout(1500);
    const file = `${outDir}/${name}.png`;
    await p.screenshot({ path: file });
    console.log(name, at, '->', file);
  }
} finally {
  await browser.close();
  await server.close();
}
