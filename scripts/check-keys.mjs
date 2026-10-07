#!/usr/bin/env node
// Usage: node scripts/check-keys.mjs <outDir>
// Real-key-event check of the keyboard controls in the real app (cruise scenario): the yoke and rudder keys hold
// their position after release, 5 / Num 5 recentre, F2 / F3 step the throttle, F5 / F6 the flaps, the old flap
// keys (F, V, [ ]) do nothing, and F5 with the menu open does not reload the page. Prints and writes keycheck.json.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import net from 'node:net';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const out = process.argv[2];
const port = await new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null } });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-webgl'] });
const errs = [];
const res = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push(String(e)));
  let loads = 0;
  p.on('load', () => loads++);
  await p.goto(`http://127.0.0.1:${port}/index.html?scenario=cruise&cam=cockpit&mute=1`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
  await p.evaluate(() => { window.__marker = 42; });
  const c = () => p.evaluate(() => { const k = __sim.ctx.controls; return { e: +k.elevator.toFixed(4), a: +k.aileron.toFixed(4), r: +k.rudder.toFixed(4), thr: +k.throttle.toFixed(3), flaps: +k.flaps.toFixed(3), kias: +__sim.summary().kias.toFixed(1), pitch: +__sim.summary().pitchDeg.toFixed(1), roll: +__sim.summary().rollDeg.toFixed(1) }; });
  const hold = async (code, ms) => { await p.keyboard.down(code); await sleep(ms); await p.keyboard.up(code); };
  await p.mouse.click(640, 100).catch(() => {});
  await sleep(300);
  res.start = await c();
  // Elevator: tap and holds.
  await hold('ArrowDown', 100); res.afterTapDown = await c();
  await hold('ArrowDown', 700); res.afterHoldDown07 = await c();
  await sleep(2000); res.twoSecLater = await c();
  await hold('Numpad5', 60); await sleep(300); res.afterNumpad5 = await c();
  // Aileron hold then release: stays.
  await hold('ArrowRight', 500); res.afterAilR = await c();
  await sleep(1500); res.ail15sLater = await c();
  await hold('Digit5', 60); await sleep(300); res.afterDigit5 = await c();
  // Rudder X (right) / Z (left).
  await hold('KeyX', 400); res.afterRudX = await c();
  await sleep(1000); res.rud1sLater = await c();
  await hold('KeyZ', 800); res.afterRudZ = await c();
  await hold('Numpad5', 60); await sleep(300); res.afterCentre2 = await c();
  // Throttle F2 / F3.
  const t0 = (await c()).thr;
  await hold('F2', 80); await sleep(150); const t1 = (await c()).thr;
  await hold('F2', 80); await sleep(150); const t2 = (await c()).thr;
  await hold('F3', 80); await sleep(150); const t3 = (await c()).thr;
  await hold('F3', 600); await sleep(150); const t4 = (await c()).thr;
  res.throttle = { start: t0, afterF2: t1, afterF2x2: t2, afterF3: t3, afterF3hold600: t4 };
  // Flaps F6 down / F5 up.
  const f = [(await c()).flaps];
  await hold('F6', 80); await sleep(200); f.push((await c()).flaps);
  await hold('F6', 80); await sleep(200); f.push((await c()).flaps);
  await hold('F5', 80); await sleep(200); f.push((await c()).flaps);
  await hold('F5', 80); await sleep(200); f.push((await c()).flaps);
  res.flaps = f;
  // Old keys should no longer move flaps.
  await hold('KeyF', 80); await hold('KeyV', 80); await hold('BracketRight', 80); await sleep(200);
  res.flapsAfterOldKeys = (await c()).flaps;
  // Modal open: F5 must not reload.
  await hold('Escape', 60); await sleep(400);
  const menuOpen = await p.evaluate(() => !!__sim.systems.ui?.menuOpen);
  await hold('F5', 80); await sleep(800);
  res.menuOpenDuringF5 = menuOpen;
  res.markerAfterF5InMenu = await p.evaluate(() => window.__marker).catch(() => 'navigated');
  res.loads = loads;
  await p.screenshot({ path: `${out}/keycheck_menu.png` });
} catch (e) {
  res.error = String(e.stack ?? e);
} finally {
  res.consoleErrors = errs;
  console.log(JSON.stringify(res, null, 1));
  writeFileSync(`${out}/keycheck.json`, JSON.stringify(res, null, 1));
  await browser.close();
  await server.close();
}
