#!/usr/bin/env node
// The aircraft hot swap end to end in the real app (src/sim/Simulator.ts swapAircraft; docs/simulator.md "Aircraft
// switch"): headless Chrome on the GPU against a private vite dev server, a fresh browser profile, driven through
// window.__sim.swapAircraft.
//
//   node scripts/swap-check.mjs [--port 5197] [--out dir] [--types r44,pa34,c152,c208,c172s] [--reference]
//
// Boots the Cessna 172S in the cruise scenario, flies a few seconds, then switches in place to each type of --types in
// turn (the last back to the C172S). Each switch is made with the simulation paused (as the menu does), so the state
// across it can be compared exactly: position, velocity and attitude unchanged; then, flying again for 3 s, the
// position moves on as the velocity says. Also per switch: the result is 'hot', ctx.aircraft / the physics / the
// stored preference name the new type, aircraft= is gone from the address, a snapshot is stored under the new type,
// the new instrument panel's texture is on a mesh of the new model (and the old model has left the scene), the frame
// loop runs, no console or subsystem errors; a cockpit and an exterior screenshot. At the end: the GPU geometries,
// textures and programs and the window's event listeners across a second, paused C172S -> R44 -> C172S round trip
// (leaks; the way back forced through the quick path without a curtain), and the wall time of a switch against a full
// reload of the page (which resumes in the type last flown). Before the reload, a switch as the pilot makes it: the
// menu opened, the C152 clicked in its aircraft chooser (no question asked; the menu closes and the flight goes on).
// Last, on the reloaded page, a switch on the runway (lined up, the other type taking over on its own wheels).
//
// --reference also boots each type of --types straight into the cruise scenario (a fresh profile each) and shoots its
// cockpit and exterior as ref-<type>-*.png, to set beside the switched-to pictures.
//
// Screenshots and summary.json go to --out. Exits non-zero on any failed assertion, page or console error.

import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flags = { port: 5197, out: `${root}/shots/swap-check`, types: ['r44', 'pa34', 'c152', 'c208', 'c172s'], reference: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--port') flags.port = Number(argv[++i]);
  else if (a === '--out') flags.out = resolve(argv[++i]);
  else if (a === '--types') flags.types = argv[++i].split(',');
  else if (a === '--reference') flags.reference = true;
  else {
    console.error('usage: node scripts/swap-check.mjs [--port 5197] [--out dir] [--types r44,pa34,c152,c208,c172s] [--reference]');
    process.exit(2);
  }
}
mkdirSync(flags.out, { recursive: true });

/** Largest position change across a paused switch, m (in the air the state is put back exactly). */
const POS_TOL_M = 0.05;
/** Largest velocity change across a paused switch, m/s. */
const VEL_TOL_MS = 0.05;
/** Largest attitude change across a paused switch, deg. */
const ATT_TOL_DEG = 0.1;
/** Largest miss of the position 3 s after a switch against old position + velocity x time, m (the new type's accelerations). */
const FLY_TOL_M = 25;

const server = await createServer({ root, logLevel: 'error', server: { port: flags.port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null }, optimizeDeps: { holdUntilCrawlEnd: true } });
await server.listen();
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = `http://127.0.0.1:${flags.port}/index.html`;
const consoleErrors = [];
const problems = [];
const passed = [];
const shots = {};
const swaps = [];
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s]`, ...a);

/** One assertion: recorded as passed or as a problem (the run carries on, and fails at the end). */
function check(what, ok, detail = '') {
  if (ok) passed.push(what);
  else problems.push(`${what}${detail ? `: ${detail}` : ''}`);
  log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`);
  return ok;
}

async function ready(p) {
  await p.waitForFunction(() => window.__ready === true && !!window.__sim, null, { timeout: 240000 });
}

/** Poll `fn` in the page until it returns a truthy value (or time out with a problem and return the last value). */
async function until(p, what, fn, arg, timeoutS = 60) {
  const end = Date.now() + timeoutS * 1000;
  let v;
  for (;;) {
    v = await p.evaluate(fn, arg);
    if (v) return v;
    if (Date.now() > end) {
      check(`in time: ${what}`, false);
      return v;
    }
    await sleep(100);
  }
}

async function shot(p, name) {
  const file = `${flags.out}/${name}.png`;
  await p.screenshot({ path: file });
  shots[name] = file;
  log(`screenshot ${name}`);
}

/** The flight state, the type and the resources the page holds. */
const probe = () => {
  const sim = window.__sim;
  const st = sim.physics.state;
  const info = sim.ctx.renderer.info;
  return {
    type: sim.physics.definition.id,
    ctxType: sim.ctx.aircraft.id,
    simType: sim.sim.aircraftId,
    time: st.time,
    pos: { ...st.position },
    vel: { ...st.velocity },
    att: { heading: (st.heading * 180) / Math.PI, pitch: (st.pitch * 180) / Math.PI, roll: (st.roll * 180) / Math.PI },
    kias: st.ias / 0.514444,
    agl: st.altitudeAGL,
    onGround: st.onGround,
    crashed: st.crashed,
    finite: [st.position.x, st.position.y, st.position.z, st.velocity.x, st.velocity.y, st.velocity.z].every(Number.isFinite),
    frames: sim.sim.frames,
    geometries: info.memory.geometries,
    textures: info.memory.textures,
    programs: info.programs?.length ?? 0,
    errors: [...sim.errors],
  };
};

/** The new panel's texture is on a mesh under the aircraft root; the root holds one model. */
const panelProbe = () => {
  const sim = window.__sim;
  const tex = sim.systems.panel.texture;
  let onMesh = false;
  sim.ctx.aircraftRoot.traverse((o) => {
    const m = o.material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) if (mat.map === tex || mat.emissiveMap === tex) onMesh = true;
  });
  return {
    onMesh,
    canvas: !!tex.image && tex.image.width > 0,
    models: sim.ctx.aircraftRoot.children.length,
    modelIsLive: sim.ctx.aircraftRoot.children.includes(sim.systems.aircraft.root),
  };
};

/** Event listeners on window (DevTools protocol), by type. */
async function windowListeners(p) {
  const cdp = await p.context().newCDPSession(p);
  const { result } = await cdp.send('Runtime.evaluate', { expression: 'window' });
  const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId, depth: 0 });
  await cdp.detach();
  const byType = {};
  for (const l of listeners) byType[l.type] = (byType[l.type] ?? 0) + 1;
  return { total: listeners.length, byType };
}

const fmt = (v) => `${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}`;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

let exitCode = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[console.error] ${m.text()}`);
  });
  p.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.stack ?? e.message}`));

  // ------------------------------------------------------------------------------------------- boot
  const url = `${base}?aircraft=c172s&scenario=cruise&hints=0`;
  let tb = Date.now();
  await p.goto(url, { waitUntil: 'load' });
  await ready(p);
  const firstBootMs = Date.now() - tb;
  log(`booted the C172S in cruise in ${firstBootMs} ms`);
  await sleep(3000);
  const boot = await p.evaluate(probe);
  check('boot: the C172S flies (airborne, finite, frames running)', boot.type === 'c172s' && !boot.onGround && boot.finite && boot.frames > 60, JSON.stringify({ type: boot.type, agl: boot.agl, frames: boot.frames }));
  check('boot: a switch now goes in place (commands.aircraftHotSwap)', await p.evaluate(() => window.__sim.ctx.commands.aircraftHotSwap?.() === true));
  const listenersBoot = await windowListeners(p);
  log(`window listeners at boot: ${listenersBoot.total}`);
  await p.evaluate(() => window.__sim.setCamera('cockpit'));
  await sleep(1200);
  await shot(p, '00-c172s-boot-cockpit');
  const bootPanel = await p.evaluate(panelProbe);
  const baseline = { ...boot, listeners: listenersBoot, models: bootPanel.models };

  let prevType = 'c172s';
  for (const [n, type] of flags.types.entries()) {
    const tag = `${String(n + 1).padStart(2, '0')}-${type}`;
    // Paused, as from the menu: the state either side of the switch is the same instant.
    await p.evaluate(() => window.__sim.pause(true));
    await sleep(200);
    const before = await p.evaluate(probe);
    const result = await p.evaluate((id) => window.__sim.swapAircraft(id), type);
    const after = await p.evaluate(probe);
    const panel = await p.evaluate(panelProbe);
    const page = await p.evaluate(() => ({ url: location.href, pref: localStorage.getItem('fs.aircraft'), stored: window.__sim.resume.stored()?.aircraft ?? null, storedAny: !!window.__sim.resume.stored() }));
    log(`${prevType} -> ${type}: ${JSON.stringify(result)}`);
    swaps.push({ from: prevType, to: type, ...result });
    check(`${tag}: switched in place`, result.mode === 'hot', `${result.mode}${result.reason ? ` (${result.reason})` : ''}`);
    check(`${tag}: the new type in the physics, ctx and the shell`, after.type === type && after.ctxType === type && after.simType === type, `${after.type}/${after.ctxType}/${after.simType}`);
    const dPos = dist(before.pos, after.pos);
    const dVel = dist(before.vel, after.vel);
    const dAtt = Math.max(angDiff(before.att.heading, after.att.heading), Math.abs(before.att.pitch - after.att.pitch), Math.abs(before.att.roll - after.att.roll));
    check(`${tag}: position kept`, dPos <= POS_TOL_M, `${dPos.toFixed(4)} m (${fmt(before.pos)} -> ${fmt(after.pos)})`);
    check(`${tag}: velocity kept`, dVel <= VEL_TOL_MS, `${dVel.toFixed(4)} m/s (${fmt(before.vel)} -> ${fmt(after.vel)})`);
    check(`${tag}: attitude kept`, dAtt <= ATT_TOL_DEG, `${dAtt.toFixed(4)} deg`);
    check(`${tag}: the clock continues`, Math.abs(after.time - before.time) < 1e-6, `${before.time} -> ${after.time}`);
    check(`${tag}: the new panel's texture is on the new model`, panel.onMesh && panel.canvas, JSON.stringify(panel));
    check(`${tag}: one model under the aircraft root (the old one left)`, panel.models === baseline.models && panel.modelIsLive, JSON.stringify(panel));
    const left = new URL(page.url).searchParams;
    check(`${tag}: aircraft= and scenario= left the address, the preference stored, a snapshot under the new type`, !left.has('aircraft') && !left.has('scenario') && page.pref === type && page.storedAny, JSON.stringify(page));
    if (result.notes?.length) log(`${tag}: notes: ${result.notes.join(' | ')}`);
    // Fly on for 3 s.
    await p.evaluate(() => window.__sim.pause(false));
    const f0 = await p.evaluate(probe);
    await sleep(3000);
    const f1 = await p.evaluate(probe);
    const dt = f1.time - f0.time;
    const predicted = { x: f0.pos.x + f0.vel.x * dt, y: f0.pos.y + f0.vel.y * dt, z: f0.pos.z + f0.vel.z * dt };
    const miss = dist(predicted, f1.pos);
    check(`${tag}: flies on (time advances, frames run, finite, not crashed)`, dt > 1 && f1.frames > f0.frames + 30 && f1.finite && !f1.crashed, `dt ${dt.toFixed(2)} s, frames +${f1.frames - f0.frames}`);
    check(`${tag}: the position moves on as the velocity says`, miss <= FLY_TOL_M, `${miss.toFixed(2)} m off after ${dt.toFixed(2)} s; ${f0.kias.toFixed(0)} -> ${f1.kias.toFixed(0)} KIAS, AGL ${f1.agl.toFixed(0)} m`);
    check(`${tag}: no subsystem errors`, f1.errors.length === 0, f1.errors.join(' | '));
    check(`${tag}: no console errors so far`, consoleErrors.length === 0, consoleErrors.slice(-3).join(' | '));
    // Pictures: the cockpit and the exterior (chase) view, held still for the shot.
    await p.evaluate(() => window.__sim.setCamera('cockpit'));
    await sleep(1500);
    await shot(p, `${tag}-cockpit`);
    await p.evaluate(() => window.__sim.setCamera('chase'));
    await sleep(2000);
    await shot(p, `${tag}-exterior`);
    await p.evaluate(() => window.__sim.setCamera('cockpit'));
    const res = await p.evaluate(probe);
    log(`${tag}: GPU geometries ${res.geometries}, textures ${res.textures}, programs ${res.programs}`);
    swaps[swaps.length - 1].gpu = { geometries: res.geometries, textures: res.textures, programs: res.programs };
    swaps[swaps.length - 1].flyMissM = +miss.toFixed(2);
    prevType = type;
  }

  // ------------------------------------------------------------------------------------------- leaks
  if (prevType === 'c172s') {
    // A second round trip with the simulation paused (the terrain around a still aircraft does not change), both views
    // drawn before each count: whatever the trip leaves behind is a leak.
    const settle = async () => {
      await p.evaluate(() => window.__sim.setCamera('chase'));
      await sleep(1200);
      await p.evaluate(() => window.__sim.setCamera('cockpit'));
      await sleep(1200);
      return p.evaluate(probe);
    };
    await p.evaluate(() => window.__sim.pause(true));
    const m0 = await settle();
    const l0 = await windowListeners(p);
    const r1 = await p.evaluate(() => window.__sim.swapAircraft('r44'));
    await settle();
    // The way back as a quick switch (no curtain, one held frame): its measured rebuild set below the curtain's limit.
    const r2 = await p.evaluate(() => {
      window.__sim.sim.swapRebuildMs.set('c172s', 0);
      return window.__sim.swapAircraft('c172s');
    });
    const m1 = await settle();
    const l1 = await windowListeners(p);
    await p.evaluate(() => window.__sim.pause(false));
    swaps.push({ from: 'c172s', to: 'r44', ...r1 }, { from: 'r44', to: 'c172s', ...r2 });
    log(`second round trip: ${JSON.stringify(r1)} / ${JSON.stringify(r2)}`);
    log(`GPU before ${JSON.stringify({ g: m0.geometries, t: m0.textures, p: m0.programs })}, after ${JSON.stringify({ g: m1.geometries, t: m1.textures, p: m1.programs })}`);
    const diff = (a, b) => Object.keys({ ...a.byType, ...b.byType }).filter((k) => a.byType[k] !== b.byType[k]).map((k) => `${k}: ${a.byType[k] ?? 0} -> ${b.byType[k] ?? 0}`).join(', ');
    // A model leaked would be hundreds of geometries; the terrain near a still aircraft may still change a few tiles.
    check('leaks: geometries after a C172S -> R44 -> C172S round trip as before it (+/- 10)', Math.abs(m1.geometries - m0.geometries) <= 10, `${m0.geometries} -> ${m1.geometries}`);
    check('leaks: textures after the round trip as before it', m1.textures === m0.textures, `${m0.textures} -> ${m1.textures}`);
    // Fewer is fine: three releases the programs only the R44's materials used once they are disposed.
    check('leaks: no new shader programs on a second visit', m1.programs <= m0.programs, `${m0.programs} -> ${m1.programs}`);
    check('leaks: window event listeners after the round trip as before it', l1.total === l0.total, `${l0.total} -> ${l1.total} ${diff(l0, l1)}`);
    log(`window listeners at boot ${listenersBoot.total}, after every switch ${l1.total} (${diff(listenersBoot, l1) || 'same types'})`);
    check('second round trip: in place', r1.mode === 'hot' && r2.mode === 'hot', `${r1.mode} / ${r2.mode}`);
    check('second round trip: the way back without a curtain', r2.curtain === false, JSON.stringify(r2));
    check('second round trip: the C172S again in the physics and ctx, flying', m1.type === 'c172s' && m1.ctxType === 'c172s' && m1.finite && !m1.onGround, JSON.stringify({ type: m1.type, ctx: m1.ctxType, agl: m1.agl }));
  }

  // ------------------------------------------------------------------------------------------- the menu
  // As the pilot does it: Escape's menu on the Flight page, a click on the C152 in the aircraft chooser. No "Leave
  // this flight?" (the flight is not left); the switch runs, the menu closes and the flight goes on.
  await p.evaluate(() => {
    window.__sim.sim.lastSwap = null;
    window.__sim.systems.ui.openMenu('flight');
  });
  await sleep(600);
  const menuPaused = await p.evaluate(() => window.__sim.ctx.paused && window.__sim.systems.ui.menuOpen);
  check('menu: open on the Flight page, the simulation paused', menuPaused);
  await p.locator('#fsui .scenarios button', { hasText: 'Cessna 152' }).first().click();
  await sleep(150);
  const asked = await p.evaluate(() => [...document.querySelectorAll('#fsui .sc-confirm')].filter((e) => !e.classList.contains('hidden')).map((e) => e.textContent));
  check('menu: no "Leave this flight?" for a switch in place', asked.length === 0, JSON.stringify(asked));
  const viaMenu = await until(p, 'the switch from the menu', () => {
    const s = window.__sim;
    return s.lastSwap && !s.sim.curtainBusy ? s.lastSwap : null;
  }, null, 60);
  log(`menu: ${JSON.stringify(viaMenu)}`);
  check('menu: switched in place to the C152', viaMenu?.mode === 'hot' && viaMenu.aircraft === 'c152', JSON.stringify(viaMenu));
  const m0f = await p.evaluate(probe);
  await sleep(2000);
  const m1f = await p.evaluate(probe);
  const menuAfter = await p.evaluate(() => ({ menuOpen: window.__sim.systems.ui.menuOpen, paused: window.__sim.ctx.paused, brand: document.querySelector('#fsui .menu .brand b')?.textContent ?? null }));
  check('menu: closed, the simulation running again, the flight going on', !menuAfter.menuOpen && !menuAfter.paused && m1f.time > m0f.time + 1 && m1f.type === 'c152' && !m1f.onGround && m1f.finite,
    JSON.stringify({ ...menuAfter, dt: +(m1f.time - m0f.time).toFixed(2), type: m1f.type, agl: m1f.agl }));
  check('menu: the rebuilt menu names the C152', menuAfter.brand === 'Cessna 152', String(menuAfter.brand));
  await p.evaluate(() => window.__sim.setCamera('cockpit'));
  await sleep(1500);
  await shot(p, 'menu-c152-cockpit');
  prevType = 'c152';

  // ------------------------------------------------------------------------------------------- reload
  // The menu's guard: a curtain up means the reload path.
  const guard = await p.evaluate(() => {
    const sim = window.__sim.sim;
    sim.curtainBusy = true;
    const hot = window.__sim.ctx.commands.aircraftHotSwap();
    sim.curtainBusy = false;
    return hot;
  });
  check('guard: no switch in place behind a curtain', guard === false);
  await p.evaluate(() => window.__sim.resume.save());
  tb = Date.now();
  await p.reload({ waitUntil: 'load' });
  await ready(p);
  const reloadMs = Date.now() - tb;
  const resumed = await p.evaluate(() => ({ type: window.__sim.physics.definition.id, decision: window.__sim.resume.decision, url: location.href }));
  check(`reload: resumes in the type last flown (${prevType})`, resumed.type === prevType && resumed.decision?.kind === 'resume', JSON.stringify(resumed));
  const hot = swaps.filter((s) => s.mode === 'hot');
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const timing = {
    reloadMs,
    firstBootMs,
    swapMeanMs: Math.round(mean(hot.map((s) => s.ms))),
    swapMaxMs: Math.round(Math.max(...hot.map((s) => s.ms))),
    swapNoCurtainMeanMs: Math.round(mean(hot.filter((s) => !s.curtain).map((s) => s.ms))),
    rebuildMeanMs: Math.round(mean(hot.map((s) => s.rebuildMs))),
    perSwap: swaps.map((s) => ({ from: s.from, to: s.to, mode: s.mode, ms: Math.round(s.ms), rebuildMs: Math.round(s.rebuildMs), curtain: s.curtain, notes: s.notes, phases: s.phases })),
  };
  log(`timing: ${JSON.stringify(timing, null, 1)}`);
  check('a switch is quicker than a reload', timing.swapMaxMs < reloadMs, `${timing.swapMaxMs} ms vs ${reloadMs} ms`);
  writeFileSync(`${flags.out}/timing.json`, JSON.stringify(timing, null, 1));

  // ------------------------------------------------------------------------------------------- on the ground
  // Lined up on the runway with the engine running: another aeroplane takes over at the same north/east and heading,
  // on its own wheels, and stays there.
  const groundTo = prevType === 'c152' ? 'c172s' : 'c152';
  await p.evaluate(() => window.__sim.reset('runway'));
  await sleep(1500);
  await p.evaluate(() => window.__sim.pause(true));
  const g0 = await p.evaluate(probe);
  const gr = await p.evaluate((id) => window.__sim.swapAircraft(id), groundTo);
  const g1 = await p.evaluate(probe);
  await p.evaluate(() => window.__sim.pause(false));
  await sleep(3000);
  const g2 = await p.evaluate(probe);
  log(`on the ground ${prevType} -> ${groundTo}: ${JSON.stringify(gr)}`);
  const dNE = Math.hypot(g1.pos.x - g0.pos.x, g1.pos.y - g0.pos.y);
  check('ground: switched in place', gr.mode === 'hot', gr.mode);
  check('ground: same north/east and heading, on the ground', dNE <= POS_TOL_M && angDiff(g0.att.heading, g1.att.heading) <= ATT_TOL_DEG && g1.onGround,
    `${dNE.toFixed(4)} m, heading ${g0.att.heading.toFixed(2)} -> ${g1.att.heading.toFixed(2)}, onGround ${g1.onGround}`);
  check('ground: 3 s later still on its wheels, nearly where it was, not crashed', g2.onGround && !g2.crashed && g2.finite && Math.hypot(g2.pos.x - g1.pos.x, g2.pos.y - g1.pos.y) < 5,
    `moved ${Math.hypot(g2.pos.x - g1.pos.x, g2.pos.y - g1.pos.y).toFixed(2)} m`);
  await p.evaluate(() => window.__sim.setCamera('chase'));
  await sleep(2000);
  await shot(p, `ground-${groundTo}-exterior`);
  check('ground: no subsystem or console errors', g2.errors.length === 0 && consoleErrors.length === 0, [...g2.errors, ...consoleErrors].join(' | '));
  await ctx.close();

  // ------------------------------------------------------------------------------------------- reference
  for (const type of flags.reference ? flags.types : []) {
    const rc = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    const rp = await rc.newPage();
    await rp.goto(`${base}?aircraft=${type}&scenario=cruise&hints=0&resume=0`, { waitUntil: 'load' });
    await ready(rp);
    await rp.evaluate(() => window.__sim.setCamera('cockpit'));
    await sleep(3000);
    await shot(rp, `ref-${type}-cockpit`);
    await rp.evaluate(() => window.__sim.setCamera('chase'));
    await sleep(2000);
    await shot(rp, `ref-${type}-exterior`);
    await rc.close();
  }
} catch (e) {
  console.error(e);
  problems.push(`exception: ${e.message}`);
} finally {
  await browser.close();
  await server.close();
}
const summary = { passed: passed.length, problems, consoleErrors, shots, wallS: Math.round((Date.now() - t0) / 1000) };
writeFileSync(`${flags.out}/summary.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
if (problems.length || consoleErrors.length) exitCode = 1;
process.exit(exitCode);
