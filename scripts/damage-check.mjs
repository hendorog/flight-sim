#!/usr/bin/env node
// Landing damage end to end in the real app (docs/simulator.md "Landing damage"): headless Chrome on the GPU against a
// private vite dev server, a fresh browser profile, driven through window.__sim.
//
//   node scripts/damage-check.mjs [--port 5198] [--out dir]
//
// Boots the Cessna 172S on the runway, drops it flat from 0.6 m at 26 m/s and 5 m/s sink (the nose leg folds, the
// propeller digs in), lets it slide to a stop, then checks: no crash, no crash dialog, a toast per damage item, the
// DAMAGE list in the flight cues, the DAMAGED chip, the engine stopped, the hot swap refused; then Shift+R's restart
// (commands.reset) clears it all. A cockpit-off exterior screenshot of the aircraft on its nose. Exits non-zero on a
// failed check, a page error or a console error.

import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flags = { port: 5198, out: `${root}/shots/damage-check` };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--port') flags.port = Number(argv[++i]);
  else if (a === '--out') flags.out = resolve(argv[++i]);
  else {
    console.error('usage: node scripts/damage-check.mjs [--port 5198] [--out dir]');
    process.exit(2);
  }
}
mkdirSync(flags.out, { recursive: true });

const server = await createServer({ root, logLevel: 'error', server: { port: flags.port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null }, optimizeDeps: { holdUntilCrawlEnd: true } });
await server.listen();
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const errors = [];
function check(what, ok, detail = '') {
  if (!ok) problems.push(`${what}${detail ? `: ${detail}` : ''}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`);
}

/** What the page shows of the damage. */
const look = () => {
  const sim = window.__sim;
  const s = sim.physics.state;
  const chips = [...document.querySelectorAll('#fsui .chip')].filter((c) => !c.classList.contains('hidden') && c.offsetParent !== null).map((c) => c.textContent);
  const list = document.querySelector('#fsui .flight-damage');
  return {
    crashed: s.crashed,
    events: (s.damage?.events ?? []).map((e) => e.text),
    toasts: sim.systems.ui.toastTexts,
    dialog: sim.systems.ui.crashCardOpen,
    list: list && !list.classList.contains('hidden') ? list.textContent : '',
    chips,
    rpm: s.engine.rpm,
    speed: Math.hypot(s.velocity.x, s.velocity.y),
    hotSwap: sim.sim.hotSwapAllowed(),
    errors: [...sim.errors],
  };
};

let exitCode = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`);
  });
  p.on('pageerror', (e) => errors.push(`[pageerror] ${e.stack ?? e.message}`));
  await p.goto(`http://127.0.0.1:${flags.port}/index.html?aircraft=c172s&scenario=runway&hints=0&resume=0`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__ready === true && !!window.__sim, null, { timeout: 240000 });
  await sleep(2000);
  await p.evaluate(() => window.__sim.setCamera('chase'));
  // The hard landing: flat, nose wheel first at 5 m/s.
  await p.evaluate(() => {
    const ph = window.__sim.physics;
    const s = ph.state;
    const h = s.heading;
    const half = h / 2;
    ph.fm.setKinematics({
      position: { ...s.position, z: s.position.z - 0.6 },
      orientation: { w: Math.cos(half), x: 0, y: 0, z: Math.sin(half) },
      velocity: { x: 26 * Math.cos(h), y: 26 * Math.sin(h), z: 5 },
      angularVelocity: { x: 0, y: 0, z: 0 },
    });
    window.__sim.ctx.controls.throttle = 0;
  });
  await sleep(1500);
  const early = await p.evaluate(look);
  await sleep(6000);
  const after = await p.evaluate(look);
  console.log(JSON.stringify(after, null, 1));
  await p.screenshot({ path: `${flags.out}/damaged.png` });
  // From the side and a little ahead, close: the folded nose leg, the aircraft on its nose.
  await p.evaluate(() => {
    window.__sim.setCamera('orbit');
    const orbit = window.__sim.systems.cameras.rigs.orbit;
    Object.assign(orbit, { targetAzimuth: 1.2, targetElevation: 0.08, targetDistance: 8 });
  });
  await sleep(2500);
  await p.screenshot({ path: `${flags.out}/damaged-side.png` });
  check('no crash', !after.crashed);
  check('no crash dialog', !after.dialog);
  check('nose gear collapsed', after.events.includes('Nose gear collapsed'), after.events.join('; '));
  check('a toast per damage item', early.events.every((t) => early.toasts.includes(t)) && early.events.length > 0, `toasts ${early.toasts.join('; ')}`);
  check('the DAMAGE list in the flight cues', after.list.startsWith('DAMAGE') && after.list.includes('Nose gear collapsed'), after.list);
  check('the DAMAGED chip', after.chips.some((c) => c.startsWith('DAMAGED')), after.chips.join(', '));
  check('the engine stopped', after.rpm === 0, `rpm ${after.rpm}`);
  check('slid to a stop', after.speed < 1, `speed ${after.speed.toFixed(2)} m/s`);
  check('hot swap refused while disabled', after.hotSwap === false);
  // Restart (Shift+R / the menu).
  await p.evaluate(() => window.__sim.ctx.commands.reset('runway'));
  await sleep(4000);
  const reset = await p.evaluate(look);
  check('restart clears the damage, list and chip', reset.events.length === 0 && reset.list === '' && !reset.chips.some((c) => c.startsWith('DAMAGED')), JSON.stringify(reset));
  check('no subsystem errors', after.errors.length === 0 && reset.errors.length === 0, [...after.errors, ...reset.errors].join('; '));
  check('no page or console errors', errors.length === 0, errors.join('\n'));
} catch (e) {
  console.error(e);
  exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n${problems.join('\n')}`);
  exitCode = 1;
}
process.exit(exitCode);
