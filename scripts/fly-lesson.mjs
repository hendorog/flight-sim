#!/usr/bin/env node
// Fly one Flight School lesson in the real app (headless Chrome on the GPU, a private vite dev server) and take
// the screenshots of section 6.4.4: the briefing, the first demonstration, the handover offer, a coaching
// caption, the debrief and the logbook.
//
//   node scripts/fly-lesson.mjs <lessonId> [outDir] [--keys] [--reload] [--params "k=v&..."] [--timeout s]
//
//   default     the AutoStudent flies the student's tasks (URL student=auto; tests/training/autoStudent.ts)
//   --keys      the student's tasks are flown with real key events instead: the AutoStudent works out where
//               each control should be and a key translator in the page presses the arrow, rudder, trim,
//               throttle and flap keys to put them there (the hold-position keyboard yoke, as a player flies)
//   --trace     with --keys: log the real and wanted controls and the keys held every 0.5 s
//   --reload    reload the page mid-practice (the first student task, 30 s in) and check that the lesson resumes
//               at the same step (section 3.10), then fly on to the debrief
//
// The page runs at 1x (lessons cap time acceleration), so a lesson takes its sim duration in wall time.
// Exits non-zero on a page or console error, a subsystem error, a crash, a missing screenshot moment, or a
// result other than competent (testPass for the skill test).

import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import net from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flags = { keys: false, reload: false, trace: false, params: '', timeout: 3600 };
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--keys') flags.keys = true;
  else if (a === '--reload') flags.reload = true;
  else if (a === '--trace') flags.trace = true;
  else if (a === '--params') flags.params = argv[++i];
  else if (a === '--timeout') flags.timeout = Number(argv[++i]);
  else positional.push(a);
}
const lessonId = positional[0];
if (!lessonId) {
  console.error('usage: node scripts/fly-lesson.mjs <lessonId> [outDir] [--keys] [--reload] [--params "k=v"] [--timeout s]');
  process.exit(2);
}
const outDir = resolve(positional[1] ?? `${root}/shots/school/flights/${lessonId}`);
mkdirSync(outDir, { recursive: true });

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
const consoleErrors = [];
const problems = [];
const shotsTaken = {};
let exitCode = 0;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s]`, ...a);

const query = `lesson=${lessonId}&tstore=mem&voice=0&mute=1&cam=cockpit${flags.keys ? '' : '&student=auto'}${flags.params ? `&${flags.params}` : ''}`;
const url = `http://127.0.0.1:${port}/index.html?${query}`;

try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  let p = await ctx.newPage();
  const watch = (page) => {
    page.on('console', (m) => {
      // Vite's dev-server chatter and the WebGL driver note are not errors of the app.
      if (m.type() === 'error') consoleErrors.push(`[console.error] ${m.text()}`);
    });
    page.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.stack ?? e.message}`));
  };
  watch(p);
  log(`opening ${url}`);
  await p.goto(url, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const state = () => p.evaluate(() => window.__sim.training.state());
  const shot = async (name) => {
    const file = `${outDir}/${name}.png`;
    await p.screenshot({ path: file });
    shotsTaken[name] = file;
    log(`screenshot ${name}`);
  };
  /** Poll the training state until `pred` holds (or the time runs out). */
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

  // 1. The briefing (the aircraft is positioned behind the curtain first).
  await until('the briefing', (s) => s.screen === 'briefing', 120);
  await sleep(800);
  await shot('01-briefing');
  if (flags.keys) await installKeyStudent(p);
  await p.keyboard.press('Enter');   // Start flight
  await until('the flight', (s) => s.phase === 'running', 30);

  // 2. The first demonstration ("follow me through").
  const demo = await until('a demonstration or the first student task', (s) => (s.stepKind === 'demo' && s.stepStatus === 'active') || s.authority === 'student' || s.phase !== 'running', 600);
  if (demo.stepKind === 'demo') {
    await sleep(6000);
    await shot('02-demo');
  }

  // 3. The handover offer ("You have control" - OFFERED: press Enter).
  // Solo lessons, challenges and some departures give the student control without an offer: control
  // reaching the student is just as good; only never getting it is a problem.
  const offered = (s) => s.handover === 'offered' || s.strip?.authority === 'offered';
  const offer = await until('the handover offer', (s) => offered(s) || s.authority === 'student' || s.phase !== 'running', 900);
  if (offered(offer)) await shot('03-handover');
  else if (offer.authority === 'student') log('the student had control without an offer (no handover screenshot)');
  else if (offer.phase === 'running') problems.push('the student never got control');

  // Optional: reload mid-practice and check that the lesson resumes at the same step.
  if (flags.reload) {
    const before = await until('a student task 30 s in', (s) => s.authority === 'student' && s.stepKind === 'task' && s.simT > 0 && s.stepStatus === 'active', 600);
    await sleep(30000);
    const at = await state();
    await p.evaluate(() => window.__sim.resume.save());
    log(`reloading at ${at.phaseId}/${at.stepId}`);
    await p.reload({ waitUntil: 'load' });
    await p.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
    const after = await until('the resumed lesson', (s) => s.phase === 'running' && s.stepId, 60);
    log(`resumed at ${after.phaseId}/${after.stepId}`);
    if (after.phaseId !== at.phaseId || after.stepId !== at.stepId) problems.push(`resumed at ${after.phaseId}/${after.stepId}, expected ${at.phaseId}/${at.stepId}`);
    if (!after.captions.some((c) => c.includes('Right, where were we.'))) problems.push('no "Right, where were we." after the reload');
    await shot('03b-resumed');
    void before;
    if (flags.keys) await installKeyStudent(p);
  }

  // 4. A coaching caption (the coach speaks when a target drifts; the AutoStudent is not perfect).
  const coached = await until('a coaching remark or the end', (s) => (s.hints?.count ?? 0) > 0 || s.phase !== 'running', flags.timeout);
  if ((coached.hints?.count ?? 0) > 0 && coached.phase === 'running') {
    await sleep(600);
    await shot('04-coaching');
  } else log('no coaching remark during the lesson (nothing to coach)');

  // 5. The debrief.
  const end = await until('the debrief', (s) => s.phase === 'debrief' || s.phase === 'ended' || s.outcome !== null, flags.timeout);
  await sleep(2500);
  await shot('05-debrief');
  const result = await p.evaluate(() => window.__sim.training.result());

  // 6. The logbook (home, then the logbook screen).
  await p.evaluate(() => {
    window.__sim.training.command({ kind: 'home' });
    window.__sim.training.system.school.open('logbook');
  });
  await sleep(1200);
  await shot('06-logbook');

  const errors = await p.evaluate(() => window.__sim.errors);
  // What the instructor said, the last of it (interventions and the end of the lesson read from here).
  const transcript = await p.evaluate(() => window.__sim.training.transcript().slice(-40).map((l) => (typeof l === 'string' ? l : l.text ?? JSON.stringify(l))));
  const summary = {
    lesson: lessonId, mode: flags.keys ? 'keys' : 'auto', reload: flags.reload,
    outcome: result?.outcome ?? end.outcome, stars: result?.stars ?? null,
    exercises: (result?.exercises ?? []).map((e) => ({
      id: e.exerciseId, grade: e.grade, test: e.testGrade, attempts: e.attempts,
      // Every criterion with its grade and what was measured, so a failure can be diagnosed from the summary.
      criteria: e.criteria.map((c) => ({ id: c.id, grade: c.insufficient ? null : c.grade, required: c.required, detail: c.detail })),
      faults: e.faults.map((f) => `${f.id} (${f.severity})`),
    })),
    interventions: result?.interventions ?? null, simMinutes: +(end.simT / 60).toFixed(1), wallMinutes: +((Date.now() - t0) / 60000).toFixed(1),
    shots: shotsTaken, problems, consoleErrors, errors, transcript,
  };
  writeFileSync(`${outDir}/summary.json`, JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary, null, 1));
  const pass = lessonId === 'L21' ? 'testPass' : 'competent';
  if (summary.outcome !== pass || problems.length || consoleErrors.length || errors.length) exitCode = 1;
} catch (e) {
  console.error(e);
  exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
process.exit(exitCode);

/**
 * --keys: the AutoStudent decides, real keys fly. In the page, the AutoStudent works on a shadow copy of the
 * controls (it never touches the aircraft); every 0.1 s a translator compares the real controls with the shadow
 * and queues key presses toward it (arrows for the yoke, Z/X rudder, Home/End trim, F2/F3 throttle, F5/F6 flaps,
 * Enter for acknowledgements). This script sends the queued presses as real keystrokes.
 */
async function installKeyStudent(page) {
  await page.evaluate(async () => {
    const mod = await import('/tests/training/keyStudent.ts');
    window.__keyStudent?.stop?.();
    window.__keyStudent = mod.installKeyStudent(window.__sim);
  });
  if (flags.trace) {
    void (async () => {
      for (;;) {
        await sleep(500);
        try {
          const line = await page.evaluate(() => window.__keyStudent?.trace() ?? null);
          if (line === null) return;
          log(line);
        } catch {
          return;
        }
      }
    })();
  }
  void (async () => {
    for (;;) {
      let batch;
      try {
        batch = await page.evaluate(() => window.__keyStudent?.drain() ?? null);
      } catch {
        return;   // page closed or reloaded
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
