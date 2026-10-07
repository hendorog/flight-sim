#!/usr/bin/env node
// Usage: node scripts/fly-keyboard.mjs [aircraft] [outDir] [extra URL params, e.g. "assist=0"]
//   aircraft  a type id (c172s, c152, ...; default the app's choice, the Cessna 172S); the pilot then flies with the
//             type's input profile, reference speeds, rest height and the pilot targets of its conformance targets
//             file (tests/conformance/keyboardTargets.ts). The arguments may come in any order: an id
//             is the aircraft, a word with "=" the URL parameters, anything else the output directory (default
//             shots/final/keyboard of this project).
// A whole left-hand circuit on runway 07 in the real app (headless Chrome, real GPU), flown ONLY with real key
// events in real time, the way a player flies the hold-position keyboard yoke: take-off roll with the rudder
// keys, rotation, climb, level-off, the four turns, approach with F2 / F3 power and F6 flaps, flare and
// landing, braking to a stop. The pilot is the scripted keyboard pilot of the tests (tests/input/keyboardPilot.ts,
// createCircuitPilot), loaded into the page: it looks at the aircraft and the control-position widget every
// 0.1 s and decides which key to press and for how long; its presses are queued in the page and this script
// sends each one to the page as a real keystroke (Playwright keyboard.down / up), so everything goes through
// the app's own keyboard listeners. Checks every sample for NaNs, a crash event, console errors and subsystem
// errors; prints a JSON summary and writes a screenshot per phase plus keyboard.json (the pilot's 10 Hz log).
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import net from 'node:net';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The type ids, as src/core/types.ts lists them (AIRCRAFT_IDS).
const ids = [...(readFileSync(`${root}/src/core/types.ts`, 'utf8').match(/AIRCRAFT_IDS[^=]*=\s*\[([^\]]*)\]/)?.[1] ?? '').matchAll(/'([a-z0-9]+)'/g)].map((m) => m[1]);
const args = process.argv.slice(2);
const aircraft = args.find((a) => ids.includes(a));
const params = args.find((a) => a.includes('='));
const outDir = args.find((a) => a !== aircraft && a !== params) ?? `${root}/shots/final/keyboard`;
const extra = `${params ? `&${params}` : ''}${aircraft ? `&aircraft=${aircraft}` : ''}`;
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
const consoleErrors = [];
let exitCode = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`[console.${m.type()}] ${m.text()}`);
  });
  p.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.stack ?? e.message}`));
  await p.goto(`http://127.0.0.1:${port}/index.html?scenario=runway&cam=chase&tod=10&mute=1${extra}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });

  // The pilot runs in the page (it reads the aircraft and the controls there); its key presses are queued.
  await p.evaluate(async () => {
    const kp = await import('/tests/input/keyboardPilot.ts');
    const kt = await import('/tests/conformance/keyboardTargets.ts');
    const sim = window.__sim;
    const q = [];
    const m = (window.__kb = { q, nan: [], crashes: [], done: false, result: null, phase: 'takeoffRoll', samples: [] });
    sim.ctx.events.on('crash', (e) => m.crashes.push({ t: sim.ctx.state.time, ...e }));
    const backend = { keyDown: (code, shift = false) => q.push({ down: true, code, shift }), keyUp: (code) => q.push({ down: false, code }) };
    // Another type than the Cessna 172S: the pilot flies with its input profile, reference speeds and rest height,
    // and with the targets of its tests/conformance/targets/<id>.ts (KEYBOARD_PILOT_TARGETS), as keyboardCircuit does.
    const def = sim.physics.definition;
    const targets = await kt.keyboardPilotTargets(def.id);
    const type = def.id === 'c172s' && !targets ? undefined : { profile: def.input, reference: def.reference, restHeight: def.geometry.restHeight, ...(targets ? { targets } : {}) };
    const pilot = kp.createCircuitPilot(backend, sim.ctx.state, sim.ctx.controls, sim.ctx.events, type);
    const t0 = sim.ctx.state.time;
    const scan = (o, path, bad) => {
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'number' && !Number.isFinite(v)) bad.push(path + k);
        else if (v && typeof v === 'object' && !ArrayBuffer.isView(v)) scan(v, path + k + '.', bad);
      }
    };
    let lastT = -1;
    const loop = () => {
      if (m.done) return;
      const t = sim.ctx.state.time - t0;
      if (t !== lastT) {
        lastT = t;
        pilot.tick(t);
        m.phase = pilot.phase;
        const bad = [];
        scan(sim.ctx.state, '', bad);
        if (bad.length && m.nan.length < 5) m.nan.push({ t, bad: bad.slice(0, 5) });
        if (pilot.observe() || t > 900) {
          m.done = true;
          m.result = { ...pilot.result(t), log: undefined };
          m.log = pilot.log;
          return;
        }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

  // Send the queued presses as real key events, as they come.
  const shots = { roll: '01_takeoff_roll', climb: '02_climb', crosswind: '03_crosswind_turn', downwind: '04_downwind', base: '05_base', final: '06_final', flare: '07_flare', rollout: '08_rollout', stopped: '09_stopped' };
  const shot = (name) => p.screenshot({ path: `${outDir}/${name}.png` });
  const taken = new Set();
  const start = Date.now();
  let status = { done: false, phase: 'takeoffRoll' };
  while (!status.done && Date.now() - start < 1_000_000) {
    status = await p.evaluate(() => ({ done: window.__kb.done, phase: window.__kb.phase, ev: window.__kb.q.splice(0) }));
    for (const e of status.ev) {
      if (e.down) {
        if (e.shift) await p.keyboard.down('Shift');
        await p.keyboard.down(e.code);
        if (e.shift) await p.keyboard.up('Shift');
      } else await p.keyboard.up(e.code);
    }
    const ph = status.phase === 'takeoffRoll' ? 'roll' : status.phase;
    if (shots[ph] && !taken.has(ph)) {
      taken.add(ph);
      // Let the phase develop a little before the picture (not for the short flare).
      if (ph !== 'flare') setTimeout(() => void shot(shots[ph]).catch(() => {}), ph === 'roll' ? 8000 : 3000);
      else await shot(shots[ph]);
    }
    await sleep(8);
  }
  await sleep(500);
  const res = await p.evaluate(() => ({ ...window.__kb, q: undefined, errors: window.__sim.errors }));
  await shot('09_stopped');
  const log = res.log ?? [];
  const summary = { ...res.result, nan: res.nan, crashes: res.crashes, errors: res.errors, consoleErrors, wallSeconds: (Date.now() - start) / 1000 };
  // A compact trace: one line every 5 s and at each phase change.
  let last = '';
  const trace = log.filter((l, i) => {
    const keep = l.phase !== last || i % 50 === 0;
    last = l.phase;
    return keep;
  });
  console.log(JSON.stringify(trace));
  console.log(JSON.stringify(summary));
  writeFileSync(`${outDir}/keyboard.json`, JSON.stringify({ summary, log }, null, 1));
  if (!res.result || res.result.crashed || !res.result.stop || res.nan.length || res.crashes.length || consoleErrors.length || res.errors.length) exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
process.exit(exitCode);
