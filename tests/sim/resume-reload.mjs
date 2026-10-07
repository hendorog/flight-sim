#!/usr/bin/env node
// Usage: node tests/sim/resume-reload.mjs [outDir] [flySeconds]   (default scratch dir shots/resume, 60 s)
// End-to-end resume-on-reload check in the real app (headless Chrome, real GPU), modelled on
// scripts/fly-circuit.mjs. Not a vitest file (it needs the browser): run it by hand.
//
//   1. Fresh profile (empty localStorage): index.html?ap=1 (no scenario=, so the default runway take-off
//      on the autoflight). Fly `flySeconds` of real time, change a few controls and the weather on the way.
//   2. Sample the state every 0.25 s over the last 2 s, then reload. A pagehide listener registered after
//      the simulator's own records the exact state the simulator saved at unload (sessionStorage).
//   3. After the reload an init script catches window.__sim the moment it exists (before the first frame)
//      and samples every 0.25 s for 3 s once the frame loop runs.
//   4. Compares position / altitude / heading / speed / rpm / fuel / controls / weather / camera / quality /
//      autoflight, reports the per-sample changes before and after (no jump), checks the toast, screenshots.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import net from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const outDir = process.argv[2] ?? `${root}/shots/resume`;
const flySeconds = Number(process.argv[3] ?? 60);
mkdirSync(outDir, { recursive: true });
const port = await new Promise((res) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => res(p));
  });
});
const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null } });
await server.listen();
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
});

// In-page state probe (both pages).
const PROBE = `window.__probe = () => {
  const sim = window.__sim, s = sim.physics.state, c = sim.ctx;
  return {
    wall: Date.now(), frames: sim.sim.frames, ...sim.summary(),
    rpmExact: sim.physics.fm.propulsion.rpm,
    fuel: { left: s.fuel.left, right: s.fuel.right },
    flaps: s.surfaces.flaps,
    controls: JSON.parse(JSON.stringify(c.controls)),
    weather: { ...c.weather },
    cameraMode: c.cameraMode, quality: c.quality,
    ap: { phase: sim.autoflight.phase, settings: { ...sim.autopilot.settings } },
  };
};`;

const results = { flySeconds };
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}] ${m.text()}`);
  });
  p.on('pageerror', (e) => console.log(`[pageerror] ${e.stack ?? e.message}`));
  // Runs in every document of the page (both loads): the probe, and on the second load the boot catcher.
  await p.addInitScript(`${PROBE}
    if (sessionStorage.getItem('__preUnload')) {
      window.__after = [];
      const catcher = setInterval(() => {
        if (!window.__sim || !window.__sim.physics) return;
        clearInterval(catcher);
        window.__atBoot = window.__probe();
        // Then every 0.25 s for 3 s, from the first rendered frame on.
        const start = () => {
          if (window.__sim.sim.frames < 1) return requestAnimationFrame(start);
          window.__after.push(window.__probe());
          const iv = setInterval(() => {
            window.__after.push(window.__probe());
            if (window.__after.length >= 13) clearInterval(iv);
          }, 250);
        };
        start();
      }, 1);
    }`);

  const url = `http://127.0.0.1:${port}/index.html?ap=1&cam=chase&tod=10&mute=1`;
  await p.goto(url, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  results.firstBoot = await p.evaluate(() => window.__sim.resume.decision);
  const t0 = Date.now();
  console.log(`[resume] first boot: ${JSON.stringify(results.firstBoot)}; flying ${flySeconds} s on the autoflight`);

  // Fly in real time. Half way: a few control / weather / view changes that must survive the reload.
  await p.waitForTimeout((flySeconds * 1000) / 2);
  await p.evaluate(() => {
    const c = window.__sim.ctx.controls;
    c.lights.taxi = true;
    c.pitotHeat = true;
    c.obsDeg = 123;
    c.fuelPump = true;
    c.headingBugDeg = 77;
    window.__sim.setWeather({ cloudCover: 0.55, visibilityM: 40000 });
  });
  await p.waitForTimeout(Math.max(0, flySeconds * 1000 - (Date.now() - t0) - 2000));
  results.before = [];
  for (let i = 0; i <= 8; i++) {
    results.before.push(await p.evaluate(() => window.__probe()));
    if (i < 8) await p.waitForTimeout(250);
  }
  results.savesBeforeReload = await p.evaluate(() => window.__sim.resume.savesWritten);
  await p.screenshot({ path: `${outDir}/1_before_reload.png` });
  // The simulator saved at pagehide; this listener runs after its own and records the same instant.
  await p.evaluate(() =>
    window.addEventListener('pagehide', () => {
      sessionStorage.setItem('__preUnload', JSON.stringify(window.__probe()));
      sessionStorage.setItem('__savedSnapshot', localStorage.getItem('fs.resume.snapshot'));
    }),
  );
  const reloadAt = Date.now();
  await p.reload({ waitUntil: 'load' });
  await p.waitForFunction(() => window.__after && window.__after.length >= 13, null, { timeout: 120000 });
  results.reloadToFirstFrameMs = (await p.evaluate(() => window.__after[0].wall)) - reloadAt;
  results.atUnload = await p.evaluate(() => JSON.parse(sessionStorage.getItem('__preUnload')));
  results.atBoot = await p.evaluate(() => window.__atBoot);
  results.savedSnapshot = await p.evaluate(() => JSON.parse(sessionStorage.getItem('__savedSnapshot')));
  results.after = await p.evaluate(() => window.__after);
  results.decision = await p.evaluate(() => window.__sim.resume.decision);
  results.toasts = await p.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent));
  await p.screenshot({ path: `${outDir}/2_after_reload_loading_done.png` });
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await p.waitForTimeout(3000);
  results.afterReady = await p.evaluate(() => window.__probe());
  results.errors = await p.evaluate(() => window.__sim.errors);
  await p.screenshot({ path: `${outDir}/3_after_reload_ready.png` });
} finally {
  await browser.close();
  await server.close();
}

// ------------------------------------------------------------------------------------------- analysis
const u = results.atUnload;
const b = results.atBoot;
const dHdg = (a, c) => Math.abs(((a - c + 540) % 360) - 180);
const diffKeys = (x, y, path = '') => {
  const out = [];
  for (const k of new Set([...Object.keys(x ?? {}), ...Object.keys(y ?? {})])) {
    const vx = x?.[k];
    const vy = y?.[k];
    if (vx && typeof vx === 'object') out.push(...diffKeys(vx, vy, `${path}${k}.`));
    else if (vx !== vy) out.push(`${path}${k}: ${vx} -> ${vy}`);
  }
  return out;
};
// The controls the shell changes on purpose at boot: none expected (starter / dgAlign are momentary).
const ctlDiff = diffKeys(u.controls, b.controls);
const wxDiff = diffKeys(u.weather, b.weather);
const restore = {
  horizontalM: +Math.hypot(u.north - b.north, u.east - b.east).toFixed(3),
  altitudeM: +(u.altitudeMSL - b.altitudeMSL).toFixed(3),
  headingDeg: +dHdg(u.headingDeg, b.headingDeg).toFixed(2),
  pitchDeg: +(u.pitchDeg - b.pitchDeg).toFixed(2),
  rollDeg: +(u.rollDeg - b.rollDeg).toFixed(2),
  kias: +(u.kias - b.kias).toFixed(2),
  groundSpeed: +(u.groundSpeed - b.groundSpeed).toFixed(3),
  rpm: +(u.rpmExact - b.rpmExact).toFixed(3),
  fuelKg: +(u.fuel.left + u.fuel.right - b.fuel.left - b.fuel.right).toFixed(4),
  simTime: +(u.time - b.time).toFixed(3),
  controlsDiff: ctlDiff,
  weatherDiff: wxDiff,
  camera: `${u.cameraMode} -> ${b.cameraMode}`,
  quality: `${u.quality} -> ${b.quality}`,
  autoflight: `${u.ap.phase} -> ${b.ap.phase}`,
  apSettingsDiff: diffKeys(u.ap.settings, b.ap.settings),
  scenario: `${u.scenario} -> ${b.scenario}`,
};
const row = (s) => ({
  t: s.time,
  n: s.north,
  e: s.east,
  alt: s.altitudeMSL,
  hdg: s.headingDeg,
  pitch: s.pitchDeg,
  roll: s.rollDeg,
  kias: s.kias,
  vs: s.verticalSpeedFpm,
  rpm: s.rpm,
  ap: s.autoflight,
});
// Changes between consecutive samples per simulated second (a jump shows as an outlier after the reload).
const rates = (list) => {
  const out = [];
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1];
    const c = list[i];
    const dt = c.time - a.time;
    if (dt <= 0) continue;
    out.push({
      dt: +dt.toFixed(3),
      dKiasPerS: +((c.kias - a.kias) / dt).toFixed(2),
      dHdgPerS: +(dHdg(c.headingDeg, a.headingDeg) / dt).toFixed(2),
      dPitchPerS: +((c.pitchDeg - a.pitchDeg) / dt).toFixed(2),
      dRollPerS: +((c.rollDeg - a.rollDeg) / dt).toFixed(2),
      altRateVsMismatchFpm: Math.round(((c.altitudeMSL - a.altitudeMSL) / dt) / 0.00508 - (a.verticalSpeedFpm + c.verticalSpeedFpm) / 2),
      dRpmPerS: Math.round((c.rpm - a.rpm) / dt),
    });
  }
  return out;
};
const maxAbs = (list, k) => Math.max(...list.map((r) => Math.abs(r[k])));
const before = [...results.before, u];
const after = [b, ...results.after];
const rb = rates(before);
const ra = rates(after);
const summary = {
  firstBoot: results.firstBoot,
  decision: results.decision,
  toasts: results.toasts,
  savesBeforeReload: results.savesBeforeReload,
  reloadToFirstFrameMs: results.reloadToFirstFrameMs,
  restoreError: restore,
  jumps: Object.fromEntries(
    ['dKiasPerS', 'dHdgPerS', 'dPitchPerS', 'dRollPerS', 'altRateVsMismatchFpm', 'dRpmPerS'].map((k) => [k, { before: maxAbs(rb, k), after: maxAbs(ra, k) }]),
  ),
  stateBefore: before.map(row),
  stateAfter: after.map(row),
  afterReady: row(results.afterReady),
  crashedAfter: results.afterReady.crashed,
  errors: results.errors,
};
writeFileSync(`${outDir}/resume.json`, JSON.stringify({ summary, raw: results }, null, 1));
console.log(JSON.stringify(summary, null, 1));
