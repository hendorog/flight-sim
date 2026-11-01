#!/usr/bin/env node
// The Career end to end in the real app (docs/career.md "Build plan", 3b): headless Chrome on the GPU against a
// private vite dev server, a fresh browser profile for each part, driven through window.__sim.career.
//
//   node scripts/fly-job.mjs [--port 5191] [--out dir] [--only 1,2,3]
//
//   1. cstore=session: create a career with a leased C152, open the hub, the board and the dispatch of the first
//      offer the C152 can take, accept it (the page reloads from the default C172S into the C152); the aircraft
//      stands within 5 m of the origin's stand with the load sheet's take-off mass (0.1 kg) and fuel, the GPS goes
//      direct to the destination, the active COM is the origin's frequency, and the UI is not modal once the pages
//      close. The job strip is shot on the ground and in the air, then testArrive completes the job: the debrief says
//      'completed' and the aircraft stands at the destination.
//   2. Same profile, the C152 loaded: lease a C172S and accept a job with it; the page reloads into the C172S with
//      career=1 (consumed by the boot: gone from the address afterwards) and no school=, and the job is placed at
//      its origin with the job's mass.
//   3. Real localStorage: accept a C172S job, start the engine, fast-forward 60 s (run=, from the page), reload: the
//      job resumes (same job, job time >= 60 s, the engine still running); with the resume preference off, the same;
//      Shift+R asks "Abandon the job?" and Keep keeps it; abandon(), reload within 1 s: no job resumes.
//
// Screenshots (hub, board, dispatch, the job strip on the ground and in flight, the debrief) go to --out. Exits
// non-zero on any failed assertion, page or console error, or a non-empty __sim.errors.

import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flags = { port: 5191, out: `${root}/shots/career-job`, only: [1, 2, 3] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--port') flags.port = Number(argv[++i]);
  else if (a === '--out') flags.out = resolve(argv[++i]);
  else if (a === '--only') flags.only = argv[++i].split(',').map(Number);
  else {
    console.error('usage: node scripts/fly-job.mjs [--port 5191] [--out dir] [--only 1,2,3]');
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
const base = `http://127.0.0.1:${flags.port}/index.html`;
const consoleErrors = [];
const problems = [];
const passed = [];
const shots = {};
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s]`, ...a);

/** One assertion: recorded as passed or as a problem (the run carries on, and fails at the end). */
function check(what, ok, detail = '') {
  if (ok) passed.push(what);
  else problems.push(`${what}${detail ? `: ${detail}` : ''}`);
  log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`);
  return ok;
}

/** A fresh profile and page with its errors watched. */
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[console.error] ${m.text()}`);
  });
  p.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.stack ?? e.message}`));
  return { ctx, p };
}

/** The app is booted and ready (window.__ready), on a page that has just loaded. */
async function ready(p) {
  await p.waitForFunction(() => window.__ready === true && !!window.__sim, null, { timeout: 180000 });
}

/** Poll `fn` in the page until it returns a truthy value (or time out with a problem and return the last value). */
async function until(p, what, fn, arg, timeoutS = 60) {
  const end = Date.now() + timeoutS * 1000;
  let v;
  for (;;) {
    try {
      v = await p.evaluate(fn, arg);
    } catch {
      v = undefined;   // the page is navigating
    }
    if (v) return v;
    if (Date.now() > end) {
      problems.push(`timed out waiting for ${what}`);
      log(`FAIL timed out waiting for ${what}`);
      return v;
    }
    await sleep(250);
  }
}

async function shot(p, name) {
  const file = `${flags.out}/${name}.png`;
  await sleep(600);
  await p.screenshot({ path: file });
  shots[name] = file;
  log(`screenshot ${name}`);
}

/** The job is placed and watched, the curtain down. */
const placedAndWatched = () => {
  const c = window.__sim?.career;
  const a = c?.active();
  return !!a && a.job.placed && !!c.system.jobMonitor && !window.__sim.sim.curtainBusy ? a.job.offer.id : null;
};

/**
 * The first offer on today's board (at the aircraft's field) the aircraft can take at its required fuel (at least
 * what is aboard, at most what the load allows), with the sheet.
 */
const pickOffer = (uid) => {
  const c = window.__sim.career;
  const s = c.state();
  const ac = s.fleet.find((a) => a.uid === uid);
  for (const o of c.board()) {
    if (s.taken.includes(o.id)) continue;
    const probe = c.loadSheet(o.id, uid, ac.fuelKg);
    if (!probe) continue;
    const fuelKg = Math.min(probe.maxFuelKg, Math.max(probe.requiredFuelKg, ac.fuelKg));
    const sheet = c.loadSheet(o.id, uid, fuelKg);
    if (sheet?.ok) return { offerId: o.id, fuelKg, takeoffKg: sheet.takeoffKg, origin: o.origin, dest: o.destination.kind === 'field' ? o.destination.code : o.origin };
  }
  return null;
};

/** Accept and wait out the reload the type switch brings (or the placement, when no reload is needed). */
async function acceptAcrossReload(p, offer, uid, expectReload) {
  const nav = expectReload ? p.waitForEvent('load', { timeout: 120000 }) : null;
  let answer;
  try {
    answer = await p.evaluate(([id, u, f]) => window.__sim.career.accept(id, { uid: u, fuelKg: f }), [offer.offerId, uid, offer.fuelKg]);
  } catch (e) {
    answer = `(navigated: ${e.message.split('\n')[0]})`;
  }
  log(`accept ${offer.offerId}: ${answer}`);
  if (expectReload) {
    check('accept with another type reloads', answer === 'reloading' || String(answer).startsWith('(navigated'), String(answer));
    await nav;
    await ready(p);
  } else check('accept places the job', answer === 'placed', String(answer));
  return until(p, 'the job placed and watched', placedAndWatched, null, 90);
}

/** What scenario 1 and 2 assert about a fresh placement: stand, mass, fuel, GPS, COM. */
async function checkPlacement(p, offer, label) {
  const r = await p.evaluate(async () => {
    const { fuelOnBoardKg } = await import('/src/career/runtime/monitor.ts');
    const { fieldByCode } = await import('/src/career/geo.ts');
    const { airfields } = await import('/src/world/airfields.ts');
    const { HOME_GROUND } = await import('/src/instruments/dynamics/radios.ts');
    const sim = window.__sim;
    const a = sim.career.active();
    const st = sim.physics.state;
    const origin = fieldByCode(a.job.offer.origin, airfields());
    const tuning = sim.radios();
    const com = tuning.mic === 2 ? tuning.com2 : tuning.com1;
    return {
      jobId: a.job.offer.id,
      type: sim.physics.definition.id,
      standOffM: Math.hypot(st.position.x - a.job.lastKnown.north, st.position.y - a.job.lastKnown.east),
      mass: st.mass,
      fuelAboard: fuelOnBoardKg(st),
      jobFuel: a.job.fuelKg,
      gps: sim.gps().code,
      comActive: com[0],
      originFreq: origin?.kind === 'home' ? HOME_GROUND : origin?.frequency,
      onGround: st.onGround,
      enginesOff: !st.engines.some((e) => e.running),
      url: location.href,
    };
  });
  log(`${label}: ${JSON.stringify(r)}`);
  check(`${label}: the job's type is flown`, r.jobId === offer.offerId, `${r.jobId} vs ${offer.offerId}`);
  check(`${label}: within 5 m of the origin's stand`, r.standOffM <= 5, `${r.standOffM.toFixed(2)} m`);
  check(`${label}: mass within 0.1 kg of the load sheet's take-off mass`, Math.abs(r.mass - offer.takeoffKg) <= 0.1, `${r.mass.toFixed(3)} vs ${offer.takeoffKg.toFixed(3)} kg`);
  check(`${label}: fuel aboard as dispatched`, Math.abs(r.fuelAboard - r.jobFuel) <= 0.1, `${r.fuelAboard.toFixed(3)} vs ${r.jobFuel.toFixed(3)} kg`);
  check(`${label}: GPS direct to the destination`, r.gps === offer.dest, `${r.gps} vs ${offer.dest}`);
  check(`${label}: active COM on the origin's frequency`, Math.abs(r.comActive - r.originFreq) < 1e-6, `${r.comActive} vs ${r.originFreq}`);
  check(`${label}: cold and dark on the ground`, r.onGround && r.enginesOff);
  return r;
}

let exitCode = 0;
try {
  // ------------------------------------------------------------------------------------------- 1 and 2
  if (flags.only.includes(1) || flags.only.includes(2)) {
    const { ctx, p } = await newPage();
    const url = `${base}?cstore=session&unlock=1&career=1&voice=0&mute=1`;
    log(`1. opening ${url}`);
    await p.goto(url, { waitUntil: 'load' });
    await ready(p);
    check('career=1 with no career opens the Career (the create page)', await p.evaluate(() => window.__sim.career.system.pages?.page() === 'create'));
    const created = await p.evaluate(() => window.__sim.career.create({ pilotName: 'R. Henderson', companyName: 'Fable Air', start: 'c152' }));
    check('a career is created', created === 'ok', created);
    await shot(p, '01-hub');
    const c152 = await p.evaluate(() => window.__sim.career.state().fleet.find((a) => a.type === 'c152').uid);
    await p.evaluate(() => window.__sim.career.open('board'));
    await shot(p, '02-board');
    const offer = await p.evaluate(pickOffer, c152);
    if (!check('a C152 offer is on the first board', !!offer)) throw new Error('no offer');
    await p.evaluate((id) => window.__sim.career.command({ kind: 'dispatch', offerId: id }), offer.offerId);
    await shot(p, '03-dispatch');
    const booted = await p.evaluate(() => window.__sim.physics.definition.id);
    const jobId = await acceptAcrossReload(p, offer, c152, booted !== 'c152');
    await p.evaluate(() => window.__sim.career.close());
    const r1 = await checkPlacement(p, offer, '1');
    check('1: the UI is not modal once the pages close', !(await p.evaluate(() => window.__sim.systems.ui.modalOpen)));
    check('1: the job strip shows', await p.evaluate(() => window.__sim.career.system.pages?.stripVisible === true));
    await shot(p, '04-strip-ground');
    // In flight: the job leg re-placed in the air through the Career's own reset ('career:<id>'), so the monitor
    // carries on; a minute of flight, then the strip.
    await p.evaluate(async (id) => {
      const sim = window.__sim;
      const { buildScenario } = await import('/src/sim/scenarios.ts');
      const { setStartField } = await import('/src/sim/startField.ts');
      const job = sim.career.active().job;
      setStartField(null);
      const sc = buildScenario('cruise', sim.physics.env, sim.physics.definition);
      await sim.sim.startFrom({ ...sc, loading: job.loading, ic: { ...sc.ic, fuelFraction: 0.5 } }, { lessonId: `career:${id}`, label: 'Loading job' });
      sim.setAutoflight(true, true);
    }, jobId);
    await sleep(8000);
    const airborne = await p.evaluate(() => ({ phase: window.__sim.career.system.jobMonitor?.phase, strip: window.__sim.systems.ui.modalOpen === false && window.__sim.career.system.pages?.stripVisible }));
    check('1: in flight the job carries on, airborne, with its strip', airborne.phase === 'airborne' && airborne.strip, JSON.stringify(airborne));
    await shot(p, '05-strip-flight');
    await p.evaluate(() => window.__sim.setAutoflight(false));
    const arrived = await p.evaluate(() => window.__sim.career.testArrive());
    check('1: testArrive', arrived === 'ok', arrived);
    const done = await p.evaluate(() => ({ s: window.__sim.career.settlement(), st: window.__sim.career.state(), page: window.__sim.career.system.pages?.page() }));
    check('1: the settlement completed the job', done.s?.outcome === 'completed', done.s?.outcome);
    const ac = done.st.fleet.find((a) => a.uid === c152);
    check('1: the aircraft stands at the destination', ac?.field === offer.dest, `${ac?.field} vs ${offer.dest}`);
    check('1: no job remains', done.st.active === null);
    check('1: the debrief opens', done.page === 'debrief', done.page);
    await shot(p, '06-debrief');
    void r1;

    if (flags.only.includes(2)) {
      // 2. A C172S lease, a job for it while the C152 is loaded: the page reloads into the C172S.
      log('2. leasing a C172S');
      await p.evaluate(() => window.__sim.career.close());
      const leased = await p.evaluate(() => window.__sim.career.command({ kind: 'lease', type: 'c172s' }));
      check('2: a C172S is leased', leased === 'ok', leased);
      const c172 = await p.evaluate(() => window.__sim.career.state().fleet.find((a) => a.type === 'c172s').uid);
      const sel = await p.evaluate((u) => window.__sim.career.command({ kind: 'select', uid: u }), c172);
      check('2: the C172S is selected', sel === 'ok', sel);
      const offer2 = await p.evaluate(pickOffer, c172);
      if (!check('2: a C172S offer is on the board', !!offer2)) throw new Error('no C172S offer');
      check('2: the C152 is loaded', (await p.evaluate(() => window.__sim.physics.definition.id)) === 'c152');
      await acceptAcrossReload(p, offer2, c172, true);
      const u = new URL(await p.evaluate(() => location.href));
      // career=1 asked the reload to open the Career; the boot takes it out of the address once read (a one-shot).
      check('2: the reload has no school=, and its career=1 was consumed', !u.searchParams.has('career') && !u.searchParams.has('school'), u.search);
      const r2 = await checkPlacement(p, offer2, '2');
      check('2: the C172S is flown', r2.type === 'c172s', r2.type);
      const errs = await p.evaluate(() => window.__sim.errors);
      check('1-2: no subsystem errors', errs.length === 0, errs.join(' | '));
    }
    await ctx.close();
  }

  // ------------------------------------------------------------------------------------------- 3
  if (flags.only.includes(3)) {
    const { ctx, p } = await newPage();
    const url = `${base}?unlock=1&career=1&voice=0&mute=1`;
    log(`3. opening ${url}`);
    await p.goto(url, { waitUntil: 'load' });
    await ready(p);
    const created = await p.evaluate(() => window.__sim.career.create({ companyName: 'Fable Air', start: 'c172s' }));
    check('3: a career is created', created === 'ok', created);
    const uid = await p.evaluate(() => window.__sim.career.state().fleet[0].uid);
    const offer = await p.evaluate(pickOffer, uid);
    if (!check('3: a C172S offer is on the first board', !!offer)) throw new Error('no offer');
    const jobId = await acceptAcrossReload(p, offer, uid, false);
    // Start the engine (the C172S's own start: master, mixture rich, a crack of throttle, magnetos both, starter).
    await p.evaluate(() => Object.assign(window.__sim.ctx.controls, { masterBattery: true, mixture: 1, throttle: 0.1, magnetos: 3, fuelSelector: 'both', fuelPump: true, parkingBrake: true }));
    await sleep(2500);
    // The starter is a held key (S), as a player cranks it; the input system owns the control while it is held.
    await p.evaluate(() => {
      window.__sim.ctx.controls.fuelPump = false;
      document.querySelector('canvas')?.focus();
    });
    await p.keyboard.down('KeyS');
    const running = await until(p, 'the engine running', () => window.__sim.physics.state.engine.running, null, 30);
    await p.keyboard.up('KeyS');
    check('3: the engine starts', !!running);
    // run=60 from the page: the fast-forward the URL's run= does, with the job time following it exactly.
    await p.evaluate(() => {
      window.__sim.sim.fastForwardLeft = 60;
    });
    await until(p, 'the fast-forward', () => window.__sim.sim.fastForwardLeft === 0, null, 120);
    const before = await p.evaluate(() => window.__sim.career.system.jobMonitor.elapsedS);
    check('3: job time follows the fast-forward', before >= 60, `${before.toFixed(1)} s`);
    await sleep(1500);   // a periodic snapshot with the block
    log('3. reloading');
    await p.reload({ waitUntil: 'load' });
    await ready(p);
    const resumed = async (label) => {
      const id = await until(p, `${label}: the job watched again`, placedAndWatched, null, 60);
      const r = await p.evaluate(() => ({
        decision: window.__sim.resume.decision, elapsed: window.__sim.career.system.jobMonitor?.elapsedS ?? -1,
        running: window.__sim.physics.state.engine.running,
      }));
      log(`${label}: ${JSON.stringify(r)}`);
      check(`${label}: the boot resumed the snapshot`, r.decision?.kind === 'resume', JSON.stringify(r.decision));
      check(`${label}: the same job`, id === jobId, `${id} vs ${jobId}`);
      check(`${label}: job time >= 60 s`, r.elapsed >= 60, `${r.elapsed.toFixed(1)} s`);
      check(`${label}: the engine still running`, r.running);
    };
    await resumed('3 (reload)');
    // The resume preference off: a placed job still writes its snapshots.
    await p.evaluate(() => window.__sim.systems.ui.resumeOnReload.set(false));
    await sleep(2500);
    log('3. reloading with the resume preference off');
    await p.reload({ waitUntil: 'load' });
    await ready(p);
    await resumed('3 (preference off)');
    // Shift+R asks; Keep keeps the job.
    await p.evaluate(() => document.querySelector('canvas')?.focus());
    await p.keyboard.press('Shift+KeyR');
    await sleep(500);
    const asked = await p.evaluate(() => ({ modal: window.__sim.systems.ui.modalOpen, title: document.querySelector('#fsui .crash h2')?.textContent ?? null }));
    check('3: Shift+R asks "Abandon the job?"', asked.modal && asked.title === 'Abandon the job?', JSON.stringify(asked));
    await shot(p, '07-abandon-ask');
    await p.keyboard.press('Escape');
    await sleep(800);
    const kept = await p.evaluate(() => ({ id: window.__sim.career.active()?.job.offer.id ?? null, modal: window.__sim.systems.ui.modalOpen, curtain: window.__sim.sim.curtainBusy }));
    check('3: Keep keeps the job (no restart)', kept.id === jobId && !kept.modal && !kept.curtain, JSON.stringify(kept));
    // abandon(), reload within 1 s: nothing resumes.
    const t = Date.now();
    await p.evaluate(() => window.__sim.career.abandon());
    await p.reload({ waitUntil: 'load' });
    log(`3. reloaded ${Date.now() - t} ms after abandon()`);
    await ready(p);
    await sleep(1500);
    const after = await p.evaluate(() => ({ active: window.__sim.career.active(), decision: window.__sim.resume.decision, last: window.__sim.career.settlement()?.outcome ?? null }));
    check('3: after abandon() and a reload no job resumes', after.active === null && after.decision?.kind !== 'resume', JSON.stringify({ active: !!after.active, decision: after.decision }));
    check('3: the job was settled as abandoned', after.last === 'abandoned', after.last);
    const errs = await p.evaluate(() => window.__sim.errors);
    check('3: no subsystem errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
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
