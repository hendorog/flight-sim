#!/usr/bin/env node
// Usage: node scripts/check-keys.mjs [outDir]   (default shots/final/check-keys)
// Real-key-event check of the keyboard controls in the real app (cruise scenario): the yoke and rudder keys hold
// their position after release, 5 / Num 5 recentre, F2 / F3 step the throttle, F5 / F6 the flaps, the old flap
// keys (F, V, [ ]) do nothing, and F5 with the menu open does not reload the page. Then the Caravan on the runway: the
// power lever's lift-over idle gate with real key events (Shift+F2 held from forward of the gate stops on it; let go
// and held again it goes aft into beta and reverse; F3 brings it back to the gate and stops; F1 idle on the gate;
// Shift+F2 then F4 full forward) and its condition lever's detents (M / Shift+M a detent a press, CUT-OFF by a fresh M
// held 1 s at LOW IDLE), and that Shift+F2 does nothing on the Cessna 172S. Then the Bo 105 on the runway (engines
// running): the engine-select keys move the chosen overhead power lever between its stops (9 F1 IDLE, Shift+F1 OFF on
// the ground, F4 FLIGHT; 0 both), ENGINE TRIM left/right on Shift+, / Shift+. and fore/aft on ; / ' (held), and
// that Shift+, stays the Cessna's left toe brake. Q is the instrument focus view (C172S and Bo 105; the fixed panel ends it;
// move + zoom, Q, look + zoom, Q comes back to exactly the view at the first Q, with a wheel fling running across both)
// and E is no longer a rudder key. Prints and writes keycheck.json; exits 1 if a check of the Caravan's
// gate or condition lever, or of the Bo 105's levers and ENGINE TRIM, fails.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import net from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
// Without an argument the output goes under shots/ (git-ignored), never to a stray directory in the tree.
const out = process.argv[2] ?? `${root}/shots/final/check-keys`;
mkdirSync(out, { recursive: true });
const port = await new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null } });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-webgl'] });
const errs = [];
const res = {};
const failures = [];
const check = (name, ok, value) => { if (!ok) failures.push(`${name}: ${JSON.stringify(value)}`); };
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

  // The Cessna 172S: Shift+F2 is nothing (it has no reverse); the throttle stays where it is.
  await hold('Escape', 60); await sleep(300);
  const thr172 = (await c()).thr;
  await p.keyboard.down('Shift'); await hold('F2', 400); await p.keyboard.up('Shift'); await sleep(150);
  res.c172ShiftF2 = { before: thr172, after: (await c()).thr, reverse: await p.evaluate(() => __sim.ctx.controls.reverse ?? null) };
  check('C172S: Shift+F2 leaves the throttle and has no reverse', res.c172ShiftF2.after === thr172 && res.c172ShiftF2.reverse === null, res.c172ShiftF2);

  // Shift+, on the Cessna 172S is still the left toe brake (the Bo 105's ENGINE TRIM key falls back on a type without it).
  await p.keyboard.down('Shift'); await p.keyboard.down('Comma'); await sleep(400);
  res.c172ShiftComma = await p.evaluate(() => ({ brakeLeft: +__sim.ctx.controls.brakeLeft.toFixed(3), split: __sim.ctx.controls.n2BeepSplit ?? null }));
  await p.keyboard.up('Comma'); await p.keyboard.up('Shift'); await sleep(200);
  check('C172S: Shift+, is the left toe brake', res.c172ShiftComma.brakeLeft > 0 && res.c172ShiftComma.split === null, res.c172ShiftComma);

  // Q: the instrument focus view (on, then off back to the same zoom), never a rudder key; E does nothing.
  const view = () => p.evaluate(() => ({ fov: +__sim.ctx.camera.fov.toFixed(2), focused: __sim.sim.systems.cameras.focused, r: +__sim.ctx.controls.rudder.toFixed(4) }));
  // The ] press above (an old flap key) went to the fixed panel, a remembered preference: back to the 3D cockpit.
  await p.evaluate(() => __sim.ctx.commands.setPanelView('3d')); await sleep(900);
  const focus = { before: await view() };
  await hold('KeyQ', 300); await sleep(700); focus.on = await view();
  await hold('KeyQ', 80); await sleep(900); focus.off = await view();
  await hold('KeyE', 300); await sleep(300); focus.e = await view();
  res.c172Focus = focus;
  check('C172S: Q is the instrument focus (narrower view), not the rudder', focus.on.focused && focus.on.fov < focus.before.fov - 5 && focus.on.r === focus.before.r, focus);
  check('C172S: Q again returns to the same zoom', !focus.off.focused && Math.abs(focus.off.fov - focus.before.fov) < 0.05, focus);
  check('C172S: E does nothing', focus.e.r === focus.before.r && focus.e.fov === focus.off.fov, focus);

  // Move + zoom -> Q -> look and zoom while focused -> Q: back to exactly the view on screen at the first Q (yaw, pitch,
  // FOV, eye). A right-drag, Shift+arrow, = and a touchpad-style wheel fling that is still coming at both Q presses.
  const pose = () => p.evaluate(() => { const r = __sim.sim.systems.cameras.cockpit; const c = __sim.ctx.camera; const a = __sim.ctx.aircraftRoot;
    const q = a.quaternion.clone().invert().multiply(c.quaternion); const e = c.position.clone().sub(a.position).applyQuaternion(a.quaternion.clone().invert());
    return { yaw: r.yaw, pitch: r.pitch, fov: r.fov, q: q.toArray(), eye: e.toArray(), focused: r.focused }; });
  const fling = (n, dy) => p.evaluate(([n, dy]) => new Promise((done) => { const el = __sim.ctx.renderer.domElement; let k = 0;
    const t = setInterval(() => { el.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, clientX: 900, clientY: 300, bubbles: true, cancelable: true })); if (++k >= n) { clearInterval(t); done(); } }, 16); }), [n, dy]);
  await p.mouse.move(640, 300); await p.mouse.down({ button: 'right' });
  for (let i = 0; i < 15; i++) { await p.mouse.move(640 - i * 8, 300 + i * 3); await sleep(16); }
  await p.mouse.up({ button: 'right' });
  await p.keyboard.down('Shift'); await hold('ArrowLeft', 250); await p.keyboard.up('Shift');
  await hold('Equal', 60); await sleep(800);
  // The view on screen at the moment the first Q takes effect (the fling is still turning and zooming it).
  await p.evaluate(() => { const cams = __sim.sim.systems.cameras; const orig = cams.toggleFocus.bind(cams);
    cams.toggleFocus = () => { if (!window.__qqAt) { const r = cams.cockpit, c = __sim.ctx.camera, a = __sim.ctx.aircraftRoot;
      window.__qqAt = { yaw: r.yaw, pitch: r.pitch, fov: r.fov, q: a.quaternion.clone().invert().multiply(c.quaternion).toArray(),
        eye: c.position.clone().sub(a.position).applyQuaternion(a.quaternion.clone().invert()).toArray(), focused: false }; } orig(); }; });
  const flingA = fling(20, 3); await sleep(120);
  await hold('KeyQ', 60); await flingA; await sleep(700);
  const qqBefore = await p.evaluate(() => window.__qqAt);
  await p.mouse.move(640, 300); await p.mouse.down({ button: 'right' });
  for (let i = 0; i < 10; i++) { await p.mouse.move(640 + i * 8, 300 - i * 3); await sleep(16); }
  await p.mouse.up({ button: 'right' });
  await hold('Minus', 60); await sleep(300);
  const flingB = fling(20, -3); await sleep(120);
  await hold('KeyQ', 60); await flingB; await sleep(1200);
  const qqAfter = await pose();
  const qqDiff = Math.max(Math.abs(qqAfter.yaw - qqBefore.yaw), Math.abs(qqAfter.pitch - qqBefore.pitch), ...qqAfter.q.map((v, i) => Math.abs(v - qqBefore.q[i])), ...qqAfter.eye.map((v, i) => Math.abs(v - qqBefore.eye[i])));
  res.c172FocusMoved = { before: qqBefore, after: qqAfter, maxDiff: qqDiff };
  check('C172S: move + zoom, Q, look + zoom, Q returns to the same view', !qqAfter.focused && qqDiff < 2e-3 && Math.abs(qqAfter.fov - qqBefore.fov) < 0.05, res.c172FocusMoved);

  // The Caravan on the runway, engine running.
  const q = await ctx.newPage();
  q.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  q.on('pageerror', (e) => errs.push(String(e)));
  await q.goto(`http://127.0.0.1:${port}/index.html?aircraft=c208&scenario=runway&cam=cockpit&mute=1`, { waitUntil: 'load' });
  await q.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
  await q.mouse.click(640, 100).catch(() => {});
  await sleep(300);
  const lever = () => q.evaluate(() => { const k = __sim.ctx.controls; return { thr: +k.throttle.toFixed(3), rev: +(k.reverse ?? 0).toFixed(3) }; });
  const qhold = async (code, ms, shift = false) => { if (shift) await q.keyboard.down('Shift'); await q.keyboard.down(code); await sleep(ms); await q.keyboard.up(code); if (shift) await q.keyboard.up('Shift'); await sleep(150); };
  const g = {};
  await qhold('F3', 600); g.forward = await lever();
  await qhold('F2', 1500, true); g.heldBackToGate = await lever();
  await qhold('F2', 800, true); g.overTheGate = await lever();
  await qhold('PageDown', 1500, true); g.fullReverse = await lever();
  await qhold('F3', 300); g.f3Short = await lever();
  await qhold('F3', 2500); g.f3ToGate = await lever();
  await qhold('F3', 400); g.f3Again = await lever();
  await qhold('F1', 80); g.f1 = await lever();
  await qhold('F2', 600, true); g.aftAgain = await lever();
  await qhold('F4', 80); g.f4 = await lever();
  await qhold('F1', 80);
  res.c208Gate = g;
  check('Caravan: F3 moves the power lever forward', g.forward.thr > 0.05 && g.forward.rev === 0, g.forward);
  check('Caravan: Shift+F2 held from forward stops on the gate', g.heldBackToGate.thr === 0 && g.heldBackToGate.rev === 0, g.heldBackToGate);
  check('Caravan: a fresh Shift+F2 goes over the gate into beta', g.overTheGate.rev >= 0.3 && g.overTheGate.thr === 0, g.overTheGate);
  check('Caravan: Shift+Page Down held goes on to full reverse', g.fullReverse.rev === 1 && g.fullReverse.thr === 0, g.fullReverse);
  check('Caravan: F3 from reverse comes forward', g.f3Short.rev < 1 && g.f3Short.rev > 0, g.f3Short);
  check('Caravan: F3 held stops on the gate', g.f3ToGate.rev === 0 && g.f3ToGate.thr === 0, g.f3ToGate);
  check('Caravan: a fresh F3 goes forward of the gate', g.f3Again.thr > 0 && g.f3Again.rev === 0, g.f3Again);
  check('Caravan: F1 is idle on the gate', g.f1.thr === 0 && g.f1.rev === 0, g.f1);
  check('Caravan: F4 from beta is full forward', g.f4.thr === 1 && g.f4.rev === 0, g.f4);
  res.c208Hud = await q.evaluate(() => document.body.innerText.includes('BETA') || document.body.innerText.includes('REV'));
  await q.screenshot({ path: `${out}/keycheck_c208.png` });
  // The condition lever's detents (InputProfile.conditionDetents): M a detent back, stopping at LOW IDLE; a fresh M
  // held there 1 s goes on to CUT-OFF (the engine stops: last); Shift+M a detent forward.
  const cond = () => q.evaluate(() => +__sim.ctx.controls.mixture.toFixed(3));
  const m = {};
  m.start = await cond();
  await qhold('KeyM', 80); m.mTap = await cond();
  await qhold('KeyM', 80, true); m.shiftMToHigh = await cond();
  await qhold('KeyM', 1500); m.mHeldFromHigh = await cond();
  await qhold('KeyM', 400); m.mShortAtLow = await cond();
  await qhold('KeyM', 80, true); m.shiftMTap = await cond();
  await qhold('KeyM', 80); await qhold('KeyM', 1300); m.mHeldAtLow = await cond();
  await qhold('KeyM', 80, true); m.shiftMFromCutoff = await cond();
  res.c208Condition = m;
  check('Caravan: M from HIGH IDLE stops at LOW IDLE', m.mTap === 0.1, m);
  check('Caravan: Shift+M from LOW IDLE is HIGH IDLE', m.shiftMToHigh === 1, m);
  check('Caravan: M held from HIGH IDLE (key auto-repeat) stops at LOW IDLE', m.mHeldFromHigh === 0.1, m);
  check('Caravan: a short M at LOW IDLE does not cut the engine', m.mShortAtLow === 0.1, m);
  check('Caravan: Shift+M from LOW IDLE is HIGH IDLE (again)', m.shiftMTap === 1, m);
  check('Caravan: a fresh M held 1 s at LOW IDLE is CUT-OFF', m.mHeldAtLow === 0, m);
  check('Caravan: Shift+M from CUT-OFF is LOW IDLE', m.shiftMFromCutoff === 0.1, m);

  // The Bo 105 on the runway, both engines running: the overhead power levers on the engine-select keys and ENGINE TRIM.
  const h = await ctx.newPage();
  h.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  h.on('pageerror', (e) => errs.push(String(e)));
  await h.goto(`http://127.0.0.1:${port}/index.html?aircraft=bo105&scenario=runway&cam=cockpit&mute=1`, { waitUntil: 'load' });
  await h.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
  await h.mouse.click(640, 100).catch(() => {});
  await sleep(300);
  const levers = () => h.evaluate(() => { const k = __sim.ctx.controls; const t = (i) => +((k.engines[i] && k.engines[i].throttle !== undefined ? k.engines[i].throttle : k.throttle)).toFixed(3);
    return { e1: t(0), e2: t(1), beep: k.n2Beep ?? 0, split: k.n2BeepSplit ?? 0 }; });
  const hhold = async (code, ms, shift = false) => { if (shift) await h.keyboard.down('Shift'); await h.keyboard.down(code); await sleep(ms); await h.keyboard.up(code); if (shift) await h.keyboard.up('Shift'); await sleep(150); };
  const held = async (code, shift) => { if (shift) await h.keyboard.down('Shift'); await h.keyboard.down(code); await sleep(300); const v = await levers(); await h.keyboard.up(code); if (shift) await h.keyboard.up('Shift'); await sleep(150); return v; };
  const bo = { start: await levers() };
  const idle = await h.evaluate(() => __sim.physics?.definition?.input?.twistGrip?.groundIdle ?? null);
  await hhold('Digit9', 80); await hhold('F1', 80); bo.nineF1 = await levers();
  await hhold('F1', 80, true); bo.shiftF1 = await levers();
  await hhold('F4', 80); bo.f4 = await levers();
  await hhold('Digit8', 80); await hhold('F1', 80); bo.eightF1 = await levers();
  await hhold('Digit0', 80); await hhold('F4', 80); bo.zeroF4 = await levers();
  bo.trimLeft = await held('Comma', true); bo.trimRight = await held('Period', true);
  bo.beepDown = await held('Semicolon', false); bo.beepUp = await held('Quote', false);
  bo.released = await levers();
  bo.help = await h.evaluate(() => document.body.innerText.includes('ENGINE TRIM'));
  res.bo105 = { ...bo, idle };
  const at = (v, x) => Math.abs(v - x) < 0.011;
  check('Bo 105: 9 F1 puts engine 2 at IDLE, engine 1 stays at FLIGHT', idle !== null ? at(bo.nineF1.e2, idle) && bo.nineF1.e1 === 1 : bo.nineF1.e2 < 0.5 && bo.nineF1.e1 === 1, bo.nineF1);
  check('Bo 105: Shift+F1 (engine 2 selected, on the ground) is OFF', bo.shiftF1.e2 === 0 && bo.shiftF1.e1 === 1, bo.shiftF1);
  check('Bo 105: F4 is FLIGHT', bo.f4.e2 === 1, bo.f4);
  check('Bo 105: 8 F1 puts engine 1 at IDLE', bo.eightF1.e1 < 0.5 && bo.eightF1.e2 === 1, bo.eightF1);
  check('Bo 105: 0 F4 both at FLIGHT', bo.zeroF4.e1 === 1 && bo.zeroF4.e2 === 1, bo.zeroF4);
  check('Bo 105: Shift+, held is ENGINE TRIM left', bo.trimLeft.split === -1, bo.trimLeft);
  check('Bo 105: Shift+. held is ENGINE TRIM right', bo.trimRight.split === 1, bo.trimRight);
  check("Bo 105: ; / ' held are ENGINE TRIM aft / fore", bo.beepDown.beep === -1 && bo.beepUp.beep === 1, { down: bo.beepDown, up: bo.beepUp });
  check('Bo 105: let go, ENGINE TRIM is centred', bo.released.split === 0 && bo.released.beep === 0, bo.released);
  // Q on a helicopter: the focus view too (CockpitDef.focus), and Shift+V (the fixed panel) ends it.
  const hview = () => h.evaluate(() => ({ fov: +__sim.ctx.camera.fov.toFixed(2), focused: __sim.sim.systems.cameras.focused }));
  await h.evaluate(() => __sim.ctx.commands.setPanelView('3d')); await sleep(900);
  const hf = { before: await hview() };
  await hhold('KeyQ', 80); await sleep(700); hf.on = await hview();
  await hhold('KeyV', 80, true); await sleep(400); hf.fixed = await hview();
  await hhold('KeyV', 80, true); await sleep(900); hf.back = await hview();
  res.bo105Focus = hf;
  check('Bo 105: Q is the instrument focus', hf.on.focused && hf.on.fov < hf.before.fov - 5, hf);
  check('Bo 105: the fixed panel ends the focus; back in 3D the normal view', !hf.fixed.focused && !hf.back.focused && Math.abs(hf.back.fov - hf.before.fov) < 0.05, hf);
  await h.screenshot({ path: `${out}/keycheck_bo105.png` });
} catch (e) {
  res.error = String(e.stack ?? e);
} finally {
  res.consoleErrors = errs;
  res.failures = failures;
  if (failures.length || res.error) process.exitCode = 1;
  console.log(JSON.stringify(res, null, 1));
  writeFileSync(`${out}/keycheck.json`, JSON.stringify(res, null, 1));
  await browser.close();
  await server.close();
}
