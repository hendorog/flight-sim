#!/usr/bin/env node
// Round 7 evidence in the real app (headless Chrome on the GPU, a private vite dev server), the student flown
// with REAL KEY EVENTS by the keyboard student (tests/training/keyStudent.ts: the AutoStudent decides, a
// translator presses the keys):
//
//   node scripts/school-round7.mjs l02 [outDir]   L02 from cold and dark to holding point A1: the taxi flown on
//                                                  the yellow line by the pure-pursuit taxi driver; every caption
//                                                  with the aircraft's position along the route; the calls checked
//                                                  against the route (turns 30-60 m before, once, right way; the
//                                                  hold call and HOLD SHORT before the line); screenshots of each.
//   node scripts/school-round7.mjs flap [outDir]  L03 flown by the AutoStudent (student=auto); in its first task the
//                                                  flap is lowered with real keys (F6) at cruise speed for 5 s, then
//                                                  raised: the flapOverspeed fault, with the speed, in the debrief.
//   node scripts/school-round7.mjs l01 [outDir]   L01 whole: the further-effects demonstration's power segment
//                                                  (nose left, ball out) and the right rudder that centres it, the
//                                                  student's full-power climb (feet off, then right rudder), the
//                                                  debrief. Samples of heading, ball, rudder, power and speed.
//
// Output (default shots/school/round7/): PNGs, <mode>-transcript.txt, <mode>-samples.json, <mode>-summary.json.
// Exits non-zero when a check fails, on a page or console error, or when the lesson is not competent (l01).

import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import net from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
if (mode !== 'l01' && mode !== 'l02' && mode !== 'flap') {
  console.error('usage: node scripts/school-round7.mjs l01|l02|flap [outDir]');
  process.exit(2);
}
const outDir = resolve(process.argv[3] ?? `${root}/shots/school/round7`);
mkdirSync(outDir, { recursive: true });
const lessonId = mode === 'l01' ? 'L01' : mode === 'flap' ? 'L03' : 'L02';

const port = await new Promise((res) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => res(p));
  });
});
const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null }, optimizeDeps: { holdUntilCrawlEnd: true } });
await server.listen();
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s]`, ...a);
const consoleErrors = [];
const problems = [];
const shots = {};
let exitCode = 0;

const url = `http://127.0.0.1:${port}/index.html?lesson=${lessonId}&tstore=mem&voice=0&mute=1&cam=cockpit${mode === 'flap' ? '&student=auto' : ''}`;

try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[console.error] ${m.text()}`); });
  p.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.stack ?? e.message}`));
  log(`opening ${url}`);
  await p.goto(url, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const state = () => p.evaluate(() => window.__sim.training.state());
  const shot = async (name) => {
    const file = `${outDir}/${name}.png`;
    await p.screenshot({ path: file });
    shots[name] = file;
    log(`screenshot ${name}`);
  };
  const until = async (what, pred, timeoutS) => {
    const end = Date.now() + timeoutS * 1000;
    for (;;) {
      const st = await state();
      if (pred(st)) return st;
      if (st.crashPending || st.outcome === 'crashed') return st;
      if (Date.now() > end) {
        problems.push(`timed out waiting for ${what}`);
        return st;
      }
      await sleep(150);
    }
  };

  await until('the briefing', (s) => s.screen === 'briefing', 120);
  await sleep(800);
  if (mode !== 'flap') await installKeyStudent(p);
  await installRecorder(p);
  await p.keyboard.press('Enter');
  await until('the flight', (s) => s.phase === 'running', 30);

  /** New captions since the last call, with the recorder's position at the time. */
  let seenSaid = 0;
  const newSaid = async () => {
    const all = await p.evaluate(() => window.__r7.said);
    const fresh = all.slice(seenSaid);
    seenSaid = all.length;
    return fresh;
  };

  if (mode === 'l02') await flyL02(p, state, shot, newSaid, until);
  else if (mode === 'flap') await flyFlap(p, state, shot, until);
  else await flyL01(p, state, shot, newSaid, until);

  const errors = await p.evaluate(() => window.__sim.errors);
  const rec = await p.evaluate(() => window.__r7);
  writeFileSync(`${outDir}/${mode}-samples.json`, JSON.stringify(rec.samples));
  const summary = { mode, shots, problems, consoleErrors, errors, wallMinutes: +((Date.now() - t0) / 60000).toFixed(1), ...globalThis.__summary };
  writeFileSync(`${outDir}/${mode}-summary.json`, JSON.stringify(summary, null, 1));
  console.log(JSON.stringify({ ...summary, transcript: undefined }, null, 1));
  if (problems.length || consoleErrors.length || errors.length) exitCode = 1;
} catch (e) {
  console.error(e);
  exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
process.exit(exitCode);

// ---- L02: the taxi ---------------------------------------------------------------------------------------------

async function flyL02(p, state, shot, newSaid, until) {
  const said = [];
  const taken = new Set();
  // Screenshot moments: the stand call, each turn-now and advance call, the hold call, HOLD SHORT.
  const moments = [
    [/out of the stand/, 'l02-01-stand-call'], [/is the next left|is the next right/, 'l02-advance'],
    [/^Turn (left|right) now/, 'l02-turn-now'], [/^Holding point A1 ahead/, 'l02-09-hold-call'],
  ];
  let taxiSeen = false;
  let n = 0;
  for (;;) {
    const st = await state();
    for (const c of await newSaid()) {
      said.push(c);
      for (const [re, name] of moments) {
        if (!re.test(c.text)) continue;
        const nm = name === 'l02-advance' || name === 'l02-turn-now' ? `l02-${String(++n + 1).padStart(2, '0')}-${name.slice(4)}` : name;
        if (taken.has(nm)) continue;
        taken.add(nm);
        await sleep(400);
        await shot(nm);
      }
    }
    if (st.stepId === 'taxiA1') taxiSeen = true;
    if (taxiSeen && st.stepId !== 'taxiA1') break;
    if (st.phase !== 'running' || st.crashPending) {
      problems.push(`the lesson stopped before the taxi ended (${st.phase})`);
      break;
    }
    await sleep(150);
  }
  await sleep(1500);
  await shot('l02-10-at-hold');
  for (const c of await newSaid()) said.push(c);
  const rec = await p.evaluate(() => window.__r7);
  const route = rec.route;
  if (!route) {
    problems.push('no taxi route recorded');
    return;
  }
  const taxiSaid = said.filter((c) => c.step === 'taxiA1');
  const line = (c) => `${c.t.toFixed(1).padStart(7)} s  s=${c.s === null ? '    -' : c.s.toFixed(0).padStart(5)} m  xt=${c.xt === null ? '-' : (c.xt >= 0 ? '+' : '') + c.xt.toFixed(1)} m  ${c.gs.toFixed(1).padStart(4)} kt  N${c.n.toFixed(0)} E${c.e.toFixed(0)}  [${c.step}]  ${c.text}`;
  const wps = route.waypoints.map((w) => `  ${w.action.padEnd(9)} ${w.name.padEnd(5)} at s=${w.sM.toFixed(0)} m (turn ${w.turnDeg} deg)`).join('\n');
  writeFileSync(`${outDir}/l02-transcript.txt`, `L02 taxi in the real app, real keys (keyStudent, pure-pursuit taxi driver); route ${route.lengthM.toFixed(0)} m:\n${wps}\n\n${said.map(line).join('\n')}\n`);

  // Checks (as tests/training/taxiCalls.test.ts).
  const samples = rec.samples.filter((x) => x.step === 'taxiA1' && x.s !== null);
  const cruising = samples.filter((x) => x.gs > 5 && x.s > 8 && x.s < route.lengthM - 10);
  const maxXt = Math.max(...cruising.map((x) => Math.abs(x.xt)));
  const meanGs = cruising.reduce((a, x) => a + x.gs, 0) / Math.max(1, cruising.length);
  if (!(maxXt <= 2)) problems.push(`max cross-track ${maxXt.toFixed(2)} m (> 2 m)`);
  if (!(meanGs >= 8 && meanGs <= 12)) problems.push(`mean taxi speed ${meanGs.toFixed(1)} kt`);
  const spoken = (name) => (name === 'A' ? 'Alpha' : name === 'apron' ? 'the apron line' : name);
  const turns = route.waypoints.filter((w) => w.action === 'left' || w.action === 'right');
  const calls = [];
  turns.forEach((w, i) => {
    const name = spoken(w.name);
    if (i === 0) {
      const c = taxiSaid.filter((x) => /out of the stand/.test(x.text));
      if (c.length !== 1 || !c[0].text.includes(`turn ${w.action}`) || !(c[0].s < 3)) problems.push(`stand call: ${c.map(line).join(' | ') || 'none'}`);
      else calls.push({ turn: `${w.action} ${name}`, kind: 'advance (stand)', distM: +(w.sM - c[0].s).toFixed(1) });
    } else {
      const adv = taxiSaid.filter((x) => x.text.toLowerCase().includes(`${name.toLowerCase()} is the next `));
      const d = adv.length ? w.sM - adv[0].s : NaN;
      if (adv.length !== 1 || !adv[0].text.includes(`next ${w.action}`) || !(d >= 30 && d <= 60)) problems.push(`advance call for ${name}: ${adv.map(line).join(' | ') || 'none'}`);
      else calls.push({ turn: `${w.action} ${name}`, kind: 'advance', distM: +d.toFixed(1) });
    }
    const re = w.name === 'apron' ? /^Turn (left|right) now, onto the yellow line/ : new RegExp(`^Turn (left|right) now onto ${name}\\b`);
    const now = taxiSaid.filter((x) => re.test(x.text));
    const d = now.length ? w.sM - now[0].s : NaN;
    if (now.length !== 1 || !now[0].text.startsWith(`Turn ${w.action} now`) || !(d >= 4 && d <= 20)) problems.push(`turn-now call for ${name}: ${now.map(line).join(' | ') || 'none'}`);
    else calls.push({ turn: `${w.action} ${name}`, kind: 'turn now', distM: +d.toFixed(1) });
  });
  const holdLineS = route.lengthM + 4;
  const hold = taxiSaid.filter((x) => /^Holding point A1 ahead/.test(x.text));
  if (hold.length !== 1 || !(hold[0].s < holdLineS - 20)) problems.push(`hold call: ${hold.map(line).join(' | ') || 'none'}`);
  else calls.push({ turn: 'hold A1', kind: 'holding point', distM: +(holdLineS - hold[0].s).toFixed(1) });
  const hs = rec.holdShortAtS;
  if (hs === null || !(hs < holdLineS - 20)) problems.push(`HOLD SHORT shown at s=${hs}`);
  else calls.push({ turn: 'hold A1', kind: 'HOLD SHORT panel', distM: +(holdLineS - hs).toFixed(1) });
  // The keyboard student primes with J itself (an earlier run's reminders showed the prime missed and set by her).
  const primeNags = said.filter((x) => /fuel pump is still|show you where the fuel pump|then off \(prime\), please/i.test(x.text));
  if (primeNags.length) problems.push(`prime not done by the student: ${primeNags.map(line).join(' | ')}`);
  const lastS = samples.at(-1)?.s ?? NaN;
  if (!(lastS < holdLineS)) problems.push(`stopped at s=${lastS} (hold line at ${holdLineS.toFixed(0)})`);
  globalThis.__summary = { maxXtrackM: +maxXt.toFixed(2), meanTaxiKt: +meanGs.toFixed(1), stoppedM: +(holdLineS - lastS).toFixed(1), calls, routeM: +route.lengthM.toFixed(0) };
  log(`max cross-track ${maxXt.toFixed(2)} m, mean ${meanGs.toFixed(1)} kt; ${calls.length} calls checked`);
}

// ---- L01: power and yaw -----------------------------------------------------------------------------------------

async function flyL01(p, state, shot, newSaid, until) {
  const said = [];
  const marks = {};
  const moments = [
    [/^Full power: watch the nose rise and swing left/, 'l01-01-demo-power', 4500],
    [/^That's slipstream and P-factor/, 'l01-02-demo-right-rudder', 4500],
    [/^Full power\. See the nose swing left/, 'l01-03-student-feet-off', 1200],
    [/^Ball in the middle\. Feel the pedal/, 'l01-04-student-balanced', 800],
  ];
  for (;;) {
    const st = await state();
    for (const c of await newSaid()) {
      said.push(c);
      for (const [re, name, wait] of moments) {
        if (!re.test(c.text) || marks[name]) continue;
        marks[name] = c.t;
        await sleep(wait);
        await shot(name);
      }
    }
    if (st.phase === 'debrief' || st.phase === 'ended' || st.outcome !== null || st.crashPending) break;
    await sleep(150);
  }
  await sleep(2500);
  await shot('l01-05-debrief');
  const result = await p.evaluate(() => window.__sim.training.result());
  const rec = await p.evaluate(() => window.__r7);
  const line = (c) => `${c.t.toFixed(1).padStart(7)} s  [${c.step}]  ${c.text}`;
  writeFileSync(`${outDir}/l01-transcript.txt`, said.map(line).join('\n') + '\n');
  // The demonstration: heading and ball over the feet-off power segment, then with the right rudder in.
  const seg = (from, to, step) => rec.samples.filter((x) => x.t >= from && x.t <= to && (!step || x.step === step));
  const stats = (xs) => xs.length ? {
    hdgChangeDeg: +((((xs.at(-1).hdg - xs[0].hdg + 540) % 360) - 180)).toFixed(1),
    ballMax: +Math.max(...xs.map((x) => x.ball)).toFixed(2), ballEnd: +xs.at(-1).ball.toFixed(2),
    rudderEnd: +xs.at(-1).rudder.toFixed(2), throttleEnd: +xs.at(-1).thr.toFixed(2), kiasEnd: +xs.at(-1).kias.toFixed(0),
  } : null;
  const dp = marks['l01-01-demo-power'], dr = marks['l01-02-demo-right-rudder'];
  const demoPower = dp !== undefined && dr !== undefined ? stats(seg(dp, dr, 'demoFurther')) : null;
  const demoRudder = dr !== undefined ? stats(seg(dr, dr + 6, 'demoFurther')) : null;
  const sf = marks['l01-03-student-feet-off'], sb = marks['l01-04-student-balanced'];
  const fullT = rec.samples.find((x) => x.step === 'powerYaw' && x.thr >= 0.95)?.t;
  const studentFeetOff = fullT !== undefined ? stats(seg(fullT, fullT + 4, 'powerYaw')) : null;
  const studentBalanced = sb !== undefined ? stats(seg(sb, sb + 4, 'powerYaw')) : null;
  const ex = result?.exercises?.find((e) => e.exerciseId === 'powerYaw') ?? null;
  if (!demoPower || !(demoPower.hdgChangeDeg <= -3) || !(demoPower.ballMax >= 0.15)) problems.push(`demonstration yaw not clear: ${JSON.stringify(demoPower)}`);
  if (!studentBalanced || !(studentBalanced.rudderEnd >= 0.12) || !(Math.abs(studentBalanced.ballEnd) <= 0.12)) problems.push(`student balance: ${JSON.stringify(studentBalanced)}`);
  if (!ex || !(ex.grade >= 2)) problems.push(`powerYaw not passed: ${JSON.stringify(ex?.criteria?.map((c) => [c.id, c.grade, c.detail]))}`);
  if (result?.outcome !== 'competent') problems.push(`L01 outcome ${result?.outcome}`);
  globalThis.__summary = {
    outcome: result?.outcome ?? null, demoPower, demoRudder, studentFeetOff, studentBalanced, studentFeetOffMark: sf ?? null,
    powerYaw: ex ? { grade: ex.grade, required: true, criteria: ex.criteria.map((c) => ({ id: c.id, grade: c.grade, detail: c.detail })) } : null,
    exercises: (result?.exercises ?? []).map((e) => ({ id: e.exerciseId, grade: e.grade, faults: e.faults.map((f) => f.id) })),
  };
}

// ---- L03 with a flap overspeed (item 5) ---------------------------------------------------------------------------

async function flyFlap(p, state, shot, until) {
  const st = await until('the first student task', (s) => s.authority === 'student' && s.stepKind === 'task' && s.stepStatus === 'active' && s.handover === 'none', 900);
  await sleep(3000);
  const kias0 = await p.evaluate(() => window.__sim.training.runner.evalContext.frame.kias);
  log(`flap 10 at ${Number(kias0).toFixed(0)} KIAS in ${st.stepId}`);
  await p.keyboard.press('F6');
  await sleep(5000);
  await shot('flap-01-overspeed');
  await p.keyboard.press('F5');
  const faults = await p.evaluate(() => window.__sim.training.runner.snapshot().faults);
  log(`faults so far: ${JSON.stringify(faults)}`);
  const end = await until('the debrief', (s) => s.phase === 'debrief' || s.phase === 'ended' || s.outcome !== null, 3600);
  await sleep(2500);
  // Open the exercise that carries the fault.
  await p.evaluate(() => {
    for (const box of document.querySelectorAll('.sc-ex')) {
      if (box.querySelector('.sc-fault')) {
        document.querySelectorAll('.sc-ex.open').forEach((b) => b.classList.remove('open'));
        box.classList.add('open');
        box.scrollIntoView({ block: 'center' });
      }
    }
  });
  await sleep(600);
  await shot('flap-02-debrief');
  const result = await p.evaluate(() => window.__sim.training.result());
  const withFault = (result?.exercises ?? []).filter((e) => e.faults.some((f) => f.id === 'flapOverspeed'));
  if (withFault.length === 0) problems.push('no flapOverspeed fault on any exercise');
  globalThis.__summary = {
    outcome: result?.outcome ?? end.outcome, main: result?.debrief?.main ?? null,
    faulted: withFault.map((e) => ({ id: e.exerciseId, grade: e.grade, faults: e.faults })),
  };
}

// ---- in-page helpers ---------------------------------------------------------------------------------------------

/** Every 0.25 s of sim time: position, taxi signals, heading, ball, controls; every caption with where it was said. */
async function installRecorder(page) {
  await page.evaluate(() => {
    const r7 = { samples: [], said: [], route: null, holdShortAtS: null };
    window.__r7 = r7;
    const seen = new Set();
    let lastT = -1;
    const KT = 0.514444;
    const tick = () => {
      requestAnimationFrame(tick);
      const sim = window.__sim;
      const runner = sim?.training?.runner;
      if (!runner || runner.phase !== 'running') return;
      const f = runner.evalContext.frame;
      const st = sim.physics.state;
      const c = sim.ctx.controls;
      const t = runner.evalContext.simT;
      const step = runner.currentStep?.def.id ?? '';
      const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
      const s = f['taxi.active'] === true ? num(f['taxi.alongM']) : null;
      const xt = f['taxi.active'] === true ? num(f['taxi.xtrackM']) : null;
      if (runner.activeTaxiRoute && !r7.route) r7.route = JSON.parse(JSON.stringify(runner.activeTaxiRoute));
      const taxi = window.__sim.training.state().taxi;
      if (taxi?.holdShort && r7.holdShortAtS === null && s !== null) r7.holdShortAtS = s;
      for (const cap of sim.training.transcript()) {
        if (seen.has(cap.id)) continue;
        seen.add(cap.id);
        r7.said.push({ t: cap.atSim, text: cap.text, step, s, xt, gs: st.groundSpeed / KT, n: st.position.x, e: st.position.y });
      }
      if (t - lastT < 0.25) return;
      lastT = t;
      r7.samples.push({
        t: +t.toFixed(2), step, s, xt, gs: +(st.groundSpeed / KT).toFixed(2), n: +st.position.x.toFixed(2), e: +st.position.y.toFixed(2),
        hdg: +(num(f.hdgDeg) ?? 0).toFixed(2), ball: +(num(f.ball) ?? 0).toFixed(3), rudder: +c.rudder.toFixed(3), thr: +c.throttle.toFixed(3),
        kias: +(num(f.kias) ?? 0).toFixed(1), bank: +(num(f.bankDeg) ?? 0).toFixed(1), who: runner.authority.who,
      });
    };
    requestAnimationFrame(tick);
  });
}

/** The keyboard student (as scripts/fly-lesson.mjs --keys): the AutoStudent decides, real keys fly. */
async function installKeyStudent(page) {
  await page.evaluate(async () => {
    const mod = await import('/tests/training/keyStudent.ts');
    window.__keyStudent?.stop?.();
    window.__keyStudent = mod.installKeyStudent(window.__sim);
  });
  void (async () => {
    for (;;) {
      let batch;
      try {
        batch = await page.evaluate(() => window.__keyStudent?.drain() ?? null);
      } catch {
        return;
      }
      if (batch === null) return;
      for (const e of batch) {
        try {
          if (e.down) {
            if (e.shift) await page.keyboard.down('Shift');
            await page.keyboard.down(e.code);
            if (e.shift) await page.keyboard.up('Shift');
          } else await page.keyboard.up(e.code);
        } catch {
          return;
        }
      }
      await sleep(10);
    }
  })();
}
