#!/usr/bin/env node
// Release check of resume-on-reload in the real app (headless Chrome, real GPU); run by hand (not vitest).
//   node tests/sim/resume-release-check.mjs <outDir> [flySeconds=45]
// A. picks Cruise from the menu, flaps one notch, trim, autopilot (A key), weather and chase camera, flies
//    flySeconds, reloads; compares the state recorded at pagehide with the restored state (before the first
//    frame) and the per-second rates 2 s before vs 3 s after the reload (jumps).
// B. index.html?scenario=runway ignores the stored snapshot.
// C. a menu restart (Downwind) then an immediate reload lands on the restarted scenario; Shift+R likewise;
//    after >5 s of the restarted flight a reload resumes it.
// D. a real crash, and a synthetic crashed snapshot, are not resumed.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import net from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const outDir = process.argv[2];
const FLY = Number(process.argv[3] ?? 45);
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
const base = `http://127.0.0.1:${port}/index.html`;
const R = {};
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Init script: probe, an unload recorder and a post-load sampler that starts the moment __sim exists.
const INIT = `
window.__probe = () => {
  const sim = window.__sim, s = sim.physics.state, c = sim.ctx;
  return {
    wall: performance.now(), frames: sim.sim.frames, time: s.time, scenario: sim.physics.scenario.id,
    north: s.position.x, east: s.position.y, alt: s.altitudeMSL,
    hdg: s.heading * 57.29578, pitch: s.pitch * 57.29578, roll: s.roll * 57.29578,
    kias: s.ias / 0.514444, vsFpm: s.verticalSpeed / 0.00508, rpm: s.engine.rpm, crashed: s.crashed,
    flapsCtl: c.controls.flaps, flapsSurf: s.surfaces.flaps, trimCtl: c.controls.elevatorTrim, trimSurf: s.surfaces.elevatorTrim,
    weather: { ...c.weather }, cam: c.cameraMode, quality: c.quality, ap: sim.autoflight.phase,
    apSettings: { ...sim.autopilot.settings },
  };
};
window.__post = [];
addEventListener('pagehide', () => { try { sessionStorage.setItem('__unload', JSON.stringify(window.__probe())); } catch {} });
(function poll() {
  const sim = window.__sim;
  if (sim && sim.physics && sim.physics.state && sim.sim) {
    window.__first = window.__probe();
    let last = -1;
    const iv = setInterval(() => {
      const p = window.__probe();
      if (p.frames > 0 && (last < 0 || p.wall - last >= 250)) { window.__post.push(p); last = p.wall; }
      if (window.__post.length >= 17) clearInterval(iv);
    }, 10);
    return;
  }
  setTimeout(poll, 5);
})();
`;

const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(INIT);
const p = await ctx.newPage();
const errors = [];
p.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
  if (m.type() === 'error' || m.type() === 'warning') log(`[console.${m.type()}] ${m.text()}`);
});
p.on('pageerror', (e) => {
  errors.push(e.message);
  log(`[pageerror] ${e.stack ?? e.message}`);
});
const ready = () => p.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
const ev = (f, a) => p.evaluate(f, a);
const decision = () => ev(() => window.__sim.resume.decision);
const summary = () => ev(() => window.__sim.summary());
async function clickScenario(name) {
  await p.keyboard.press('Escape');
  await sleep(400);
  await p.locator('#fsui .scenarios button', { hasText: name }).first().click();
  await p.waitForFunction((id) => window.__sim.summary().scenario === id && window.__sim.sim.frames > 0, name === 'Cruise' ? 'cruise' : name === 'Downwind' ? 'downwind' : 'runway', { timeout: 60000 });
}

try {
  // ------------------------------------------------------------------ A. cruise, 45 s on AP, reload
  await p.goto(`${base}?mute=1`);
  await ready();
  R.A_firstBoot = await decision();
  await clickScenario('Cruise');
  await sleep(1500);
  await p.mouse.click(800, 450); // focus the canvas
  await p.keyboard.press('F6'); // flaps one notch
  await p.keyboard.down('End');
  await sleep(600);
  await p.keyboard.up('End');
  await p.keyboard.press('KeyA'); // autopilot: hold current heading / altitude
  await ev(() => {
    window.__sim.setWeather({ cloudCover: 0.45, timeOfDay: 15.25, windSpeedKt: 8, windDirectionDeg: 250 });
    window.__sim.setCamera('chase');
  });
  const t0 = Date.now();
  const pre = [];
  while (Date.now() - t0 < FLY * 1000) {
    await sleep(250);
    if (Date.now() - t0 > (FLY - 3) * 1000) pre.push(await ev(() => window.__probe()));
  }
  R.A_savesBefore = await ev(() => window.__sim.resume.savesWritten);
  await p.screenshot({ path: `${outDir}/A1_before_reload.png` });
  const tReload = Date.now();
  await p.reload();
  await p.waitForFunction(() => window.__post && window.__post.length >= 13, null, { timeout: 120000 });
  const unload = JSON.parse(await ev(() => sessionStorage.getItem('__unload')));
  const first = await ev(() => window.__first);
  const post = await ev(() => window.__post);
  R.A_decision = await decision();
  R.A_firstFrameAfterReloadMs = Date.now() - tReload;
  await ready();
  await sleep(500);
  await p.screenshot({ path: `${outDir}/A2_after_reload.png` });
  R.A_toast = await ev(() => document.body.innerText.match(/Resumed flight[^\n]*/)?.[0] ?? null);
  const keys = ['time', 'north', 'east', 'alt', 'hdg', 'kias', 'rpm', 'pitch', 'roll', 'flapsCtl', 'flapsSurf', 'trimCtl', 'trimSurf'];
  const diff = (a, b) => Object.fromEntries(keys.map((k) => [k, +(b[k] - a[k]).toFixed(4)]));
  R.A_unload = Object.fromEntries([...keys, 'scenario', 'cam', 'quality', 'ap'].map((k) => [k, typeof unload[k] === 'number' ? +unload[k].toFixed(4) : unload[k]]));
  R.A_diffUnloadVsRestored_preFirstFrame = diff(unload, first);
  R.A_diffUnloadVsFirstFrame = diff(unload, post[0]);
  R.A_weatherMatch = JSON.stringify(unload.weather) === JSON.stringify(first.weather);
  R.A_weatherDiff = Object.keys(unload.weather).filter((k) => unload.weather[k] !== first.weather[k]).map((k) => `${k}: ${unload.weather[k]} -> ${first.weather[k]}`);
  R.A_cam = [unload.cam, post.at(-1).cam];
  R.A_quality = [unload.quality, post.at(-1).quality];
  R.A_ap = [unload.ap, post.at(-1).ap, JSON.stringify(unload.apSettings) === JSON.stringify(first.apSettings)];
  R.A_scenario = [unload.scenario, first.scenario];
  // Jumps: per-sample change (normalised to per second) 2 s before and 3 s after.
  const rates = (arr) => {
    const out = { kias: 0, hdg: 0, pitch: 0, roll: 0, alt: 0, rpm: 0 };
    for (let i = 1; i < arr.length; i++) {
      const dt = arr[i].time - arr[i - 1].time;
      if (dt <= 0) continue;
      for (const k of Object.keys(out)) {
        let d = arr[i][k] - arr[i - 1][k];
        if (k === 'hdg') d = ((d + 540) % 360) - 180;
        out[k] = Math.max(out[k], Math.abs(d / dt));
      }
    }
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, +v.toFixed(2)]));
  };
  R.A_maxRatesBefore = rates(pre.slice(-9));
  R.A_maxRatesAfter = rates(post.slice(0, 13));
  // Across the reload itself: unload -> first rendered sample, per simulated second.
  R.A_acrossReload = rates([unload, post[0]]);
  R.A_postTrace = post.slice(0, 13).map((s) => [+s.time.toFixed(2), +s.alt.toFixed(1), +s.hdg.toFixed(2), +s.kias.toFixed(1), Math.round(s.vsFpm), Math.round(s.rpm)]);
  R.A_preTrace = pre.slice(-6).map((s) => [+s.time.toFixed(2), +s.alt.toFixed(1), +s.hdg.toFixed(2), +s.kias.toFixed(1), Math.round(s.vsFpm), Math.round(s.rpm)]);

  // ------------------------------------------------------------------ B. scenario=runway ignores it
  R.B_storedBefore = await ev(() => window.__sim.resume.stored()?.scenario);
  await p.goto(`${base}?scenario=runway&mute=1`);
  await ready();
  R.B_decision = await decision();
  const sb = await summary();
  R.B_state = { scenario: sb.scenario, time: sb.time, kias: sb.kias, onGround: sb.onGround, north: sb.north, east: sb.east };

  // ------------------------------------------------------------------ C. menu restart then immediate reload
  await p.goto(`${base}?mute=1`);
  await ready();
  R.C_bootDecision = await decision();
  await sleep(6000);
  await clickScenario('Downwind');
  await sleep(1000);
  R.C_storedAfterRestart = await ev(() => {
    const s = window.__sim.resume.stored();
    return s && { scenario: s.scenario, resume: s.resume, simTime: +s.simTime.toFixed(2) };
  });
  await p.reload();
  await ready();
  R.C_decision = await decision();
  const sc = await summary();
  R.C_state = { scenario: sc.scenario, time: sc.time, altitudeFt: sc.altitudeFt, kias: sc.kias };
  // Shift+R after flying for a while, then an immediate reload.
  await sleep(8000);
  await p.mouse.click(800, 450);
  const beforeR = await summary();
  await p.keyboard.press('Shift+KeyR');
  await sleep(1200);
  await p.reload();
  await ready();
  R.C_shiftR = { before: { scenario: beforeR.scenario, time: beforeR.time }, decision: await decision(), after: await summary().then((s) => ({ scenario: s.scenario, time: s.time })) };
  // ...and once the restarted flight has run > 5 s a reload resumes it again.
  await sleep(9000);
  const beforeArm = await summary();
  await p.reload();
  await ready();
  R.C_armed = { beforeTime: beforeArm.time, decision: await decision(), after: await summary().then((s) => ({ scenario: s.scenario, time: s.time })) };

  // ------------------------------------------------------------------ D. crashed snapshot not resumed
  await p.goto(`${base}?mute=1&scenario=cruise`);
  await ready();
  await sleep(2000);
  R.D_crash = await ev(() => {
    const sim = window.__sim;
    sim.pause(true);
    const c = sim.ctx.controls;
    c.throttle = 1;
    c.elevator = 1;
    c.aileron = 0;
    let s = sim.step(1);
    for (let i = 0; i < 180 && !s.crashed; i++) {
      c.elevator = i % 2 ? 1 : 1;
      s = sim.step(1);
    }
    if (!s.crashed) {
      c.elevator = -1;
      for (let i = 0; i < 180 && !s.crashed; i++) s = sim.step(1);
    }
    sim.pause(false);
    return { crashed: s.crashed, reason: s.crashReason, time: s.time };
  });
  await sleep(3000);
  R.D_stored = await ev(() => {
    const s = window.__sim.resume.stored();
    return s && { scenario: s.scenario, crashed: s.status.crashed, simTime: +s.simTime.toFixed(1), resume: s.resume };
  });
  await p.screenshot({ path: `${outDir}/D1_crashed.png` });
  await p.goto(`${base}?mute=1`);
  await ready();
  R.D_decision = await decision();
  const sd = await summary();
  R.D_state = { scenario: sd.scenario, time: sd.time, crashed: sd.crashed, onGround: sd.onGround };
  // Synthetic crashed snapshot (independent of how the crash was saved): written from another page of
  // the same origin, so the simulator's own pagehide save cannot overwrite it.
  const good = await ev(() => window.__sim.resume.stored());
  await p.goto(`http://127.0.0.1:${port}/favicon.svg`);
  await ev((s) => {
    s.status.crashed = true;
    s.resume = true;
    s.savedAt = Date.now();
    localStorage.setItem('fs.resume.snapshot', JSON.stringify(s));
  }, good);
  await p.goto(`${base}?mute=1`);
  await ready();
  R.D_syntheticDecision = await decision();
} catch (e) {
  R.error = String(e.stack ?? e);
} finally {
  R.consoleErrors = errors;
  writeFileSync(`${outDir}/result.json`, JSON.stringify(R, null, 1));
  console.log(JSON.stringify(R, null, 1));
  await browser.close();
  await server.close();
}
