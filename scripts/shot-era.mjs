#!/usr/bin/env node
// Deep Time verification shots: the Cretaceous contact sheet and the present-day "unchanged" check.
//
//   node scripts/shot-era.mjs [--out dir] [--only name,name] [--skip-era] [--present] [--main /path/to/main]
//                             [--no-sheet]
//
//   --out dir      where the PNGs, contact sheets and summary.json go (default work/era/<yyyy-mm-dd>)
//   --only         just these shots (names as listed below; era or present)
//   --skip-era     no Cretaceous shots (with --present: the present check alone)
//   --present      also render the present-day set with this checkout ("branch-*.png")
//   --main dir     ... and with that checkout (a worktree of main: its own scripts/shot.mjs, "main-*.png"), then
//                  imgdiff each pair at tolerance 0. Pages that are not deterministic run to run (index.html)
//                  are rendered on main twice to measure the main-vs-main noise floor; the branch passes when it
//                  differs from the nearer main run by at most 1.25x main-vs-main at tolerances 4, 16 and 32
//   --no-sheet     no contact-sheet montage (needs ImageMagick's `montage`)
//
// Every shot is one run of scripts/shot.mjs (headless Chrome on the GPU, a private vite server), strictly one at a
// time. Shots that need a place no scenario starts from drive window.__sim through --eval (resetTo, a fixed
// camera, polling the fauna pools until the moment happens). Times of day are fixed (tod=, clock=0).
//
// Pacing: headless Chrome reads the instrument panel's night-lighting canvas back from the GPU every frame
// (src/instruments/panel.ts updateLight), which here costs 50-500 ms a frame in either era, so a scripted 30 s
// of flight would take minutes and the sim would run at a fraction of real time. The timed era shots therefore
// stub that readback first (PANEL_STUB below; the panel's day image is unaffected). Never use it for a
// present-vs-main comparison: those pages are compared exactly as they run.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) {
  const k = argv[i].replace(/^--/, '');
  if (['present', 'skip-era', 'no-sheet'].includes(k)) flags[k] = true;
  else flags[k] = argv[++i];
}
const out = resolve(flags.out ?? join('work', 'era', new Date().toISOString().slice(0, 10)));
const only = flags.only ? new Set(flags.only.split(',')) : null;
mkdirSync(out, { recursive: true });

// ------------------------------------------------------------------------------------------------ page snippets

/** Stub the panel's GPU readback (see "Pacing" above). Returns the number of panels stubbed. */
const PANEL_STUB = `(() => {
  const seen = new Set(); let hits = 0;
  const walk = (o, d) => {
    if (!o || typeof o !== 'object' || seen.has(o) || d > 4) return;
    seen.add(o);
    if (typeof o.updateLight === 'function' && 'light' in o) { o.updateLight = () => {}; if (o.light) o.light.upload.flush = () => {}; hits++; }
    for (const k of Object.keys(o)) { try { walk(o[k], d + 1); } catch {} }
  };
  walk(window.__sim.systems, 0);
  return hits;
})()`;

/** Wrap a promise body (with `sim`, `f` (fauna), `F` (flyers), `H` (herds) and `until(cond, ms)` in scope). */
const timed = (body) => `(async () => {
  const stubbed = ${PANEL_STUB};
  const sim = window.__sim, f = sim.fauna, F = f && f.flyers, H = f && f.herds;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (cond, ms) => { const t0 = performance.now(); while (!cond()) { if (performance.now() - t0 > ms) return false; await sleep(50); } return true; };
  const result = await (async () => { ${body} })();
  return { stubbed, simTime: sim.summary().time, ...result, stats: f && f.stats };
})()`;

/** The 07 line-up from the runway scenario's start, and LINE_UP 25 (20 m inside the far threshold of 1800 m). */
const LINEUP_25 = `
  const base = sim.physics.scenario, h = base.ic.heading, p = base.ic.position, L = 1760;
  sim.physics.resetTo({ ...base, ic: { ...base.ic, position: { x: p.x + L * Math.cos(h), y: p.y + L * Math.sin(h), z: p.z }, heading: h + Math.PI } });
  await sleep(1500);
  return { heading: sim.summary().headingDeg };`;

/** The river herd, low pass: aircraft 700 m west at 60 m above it heading east; camera beside the herd as it passes. */
const LOW_PASS = `
  const h = f.riverHerd, cn = H.cN[h], ce = H.cE[h], ch = H.cH[h];
  const base = sim.physics.scenario;
  sim.physics.resetTo({ ...base, ic: { ...base.ic, position: { x: cn, y: ce - 700, z: -(ch + 60) }, heading: Math.PI / 2, airspeed: 50, onGround: false } });
  sim.setCamera('chase');
  const near = await until(() => { const s = sim.summary(); return Math.hypot(s.north - cn, s.east - ce) < 60; }, 60000);
  await sleep(1200);
  // Above the riverside trees, behind and to the side: the running herd below, the aircraft pulling away.
  const s1 = sim.summary();
  sim.setFixedCamera([cn - 160, ce - 220, ch + 75], [(cn + s1.north) / 2, ce + 40, ch + 15]);
  await sleep(300);
  let running = 0;
  for (let k = 0; k < H.size[h]; k++) if (H.speed[h * H.memberCap + k] > 2) running++;
  return { near, fleeing: H.fleeing[h], running, herd: H.size[h], agl: sim.summary().altitudeAGL };`;

/** A kettle close: the camera 70 m from the first large azhdarchid circling. */
const KETTLE = `
  let i = -1;
  await until(() => sim.summary().time > 3, 20000);
  await until(() => { for (let k = 0; k < F.capacity; k++) if (F.active[k] && F.mode[k] === 4 && F.size[k] > 0.8) { i = k; return true; } return false; }, 20000);
  if (i < 0) for (let k = 0; k < F.capacity; k++) if (F.active[k] && F.mode[k] === 4) { i = k; break; }
  if (i < 0) return { kettle: false };
  // Paused, so the frame shows the bird where the camera was aimed (it flies ~15 m/s).
  sim.pause(true);
  await sleep(100);
  const R = 45, n = F.n[i], e = F.e[i], a = F.alt[i];
  sim.setFixedCamera([n - R, e - R * 0.5, a - R * 0.25], [n, e, a]);
  await sleep(400);
  let circling = 0;
  for (let k = 0; k < F.capacity; k++) if (F.active[k] && F.mode[k] === 4) circling++;
  return { kettle: true, bird: i, circling, agl: Math.round(a - F.ground[i]) };`;

/** The resting pair launching on the 07 take-off roll (autoflight), seen from beside the strip. */
const PAIR_LAUNCH = `
  const pair = [];
  for (let k = 0; k < F.capacity; k++) if (F.active[k] && F.mode[k] <= 1) pair.push(k);
  if (!pair.length) return { pair: 0 };
  const h = sim.physics.scenario.ic.heading;
  const fwd = [Math.cos(h), Math.sin(h)], right = [-Math.sin(h), Math.cos(h)];
  const i = pair[0], n = F.n[i], e = F.e[i], g = F.ground[i];
  // Camera beside the pair, outboard of the strip and a little ahead of them, looking back down the runway.
  const cam = [n + 70 * fwd[0] + 60 * right[0], e + 70 * fwd[1] + 60 * right[1], g + 5];
  const look = [n - 90 * fwd[0] - 40 * right[0], e - 90 * fwd[1] - 40 * right[1], g + 8];
  sim.setCamera('chase'); // the exterior model is drawn outside the cockpit view
  sim.setFixedCamera(cam, look);
  sim.setAutoflight(true);
  const launched = await until(() => pair.some((k) => F.mode[k] === 2), 60000);
  await sleep(2000);
  // Frame the launching bird and the rolling aircraft behind it.
  const s = sim.summary();
  sim.setFixedCamera(cam, [(F.n[i] * 2 + s.north) / 3, (F.e[i] * 2 + s.east) / 3, g + 6]);
  await sleep(200);
  return { pair: pair.length, launched, modes: pair.map((k) => F.mode[k]), birdAgl: pair.map((k) => +(F.alt[k] - F.ground[k]).toFixed(1)), aircraft: { onGround: s.onGround, kias: s.kias, dist: Math.round(Math.hypot(s.north - n, s.east - e)) } };`;

/** Scale: the resting pair beside the C172 (paused, so they do not launch), from a chase-like camera behind both. */
const PAIR_SCALE = `
  const pair = [];
  for (let k = 0; k < F.capacity; k++) if (F.active[k] && F.mode[k] <= 1) pair.push(k);
  if (!pair.length) return { pair: 0 };
  sim.pause(true);
  const i = pair[0], n = F.n[i], e = F.e[i], g = F.ground[i];
  const base = sim.physics.scenario, h = base.ic.heading;
  const fwd = [Math.cos(h), Math.sin(h)], right = [-Math.sin(h), Math.cos(h)];
  // The aircraft 18 m inboard of the bird (toward the centreline), on the ground, nose along the strip.
  const an = n - 18 * right[0], ae = e - 18 * right[1];
  sim.physics.resetTo({ ...base, ic: { ...base.ic, position: { x: an, y: ae, z: base.ic.position.z }, heading: h } });
  sim.setCamera('chase');
  await sleep(300);
  // Behind and a little above, looking at the midpoint of the two.
  const mn = (n + an) / 2, me = (e + ae) / 2;
  sim.setFixedCamera([mn - 45 * fwd[0] - 6 * right[0], me - 45 * fwd[1] - 6 * right[1], g + 7], [mn, me, g + 3]);
  await sleep(600);
  const s = sim.summary();
  return { pair: pair.length, modes: pair.map((k) => F.mode[k]), sep: Math.round(Math.hypot(s.north - n, s.east - e)), size: +F.size[i].toFixed(2), onGround: s.onGround };`;

/** The valley overview: wait for the fauna to stream in, then report how many animals are drawn (stats.visible). */
const SETTLE = `await sleep(3500); return {};`;

/** Wait for the first Field Guide toast. */
const TOAST = `
  const ok = await until(() => [...document.querySelectorAll('.toast')].some((t) => /Field Guide/.test(t.textContent)), 60000);
  await sleep(400);
  return { toast: ok, text: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ') };`;

/** The safari after `ms` of flight: where the herd and kettle are (distance m, bearing deg off the nose). */
const SAFARI_AT = (ms) => `
  await sleep(${ms});
  const s = sim.summary(), hd = s.headingDeg * Math.PI / 180;
  const rel = (n, e) => { const dn = n - s.north, de = e - s.east; let b = Math.atan2(de, dn) - hd; b = Math.atan2(Math.sin(b), Math.cos(b)); return [Math.round(Math.hypot(dn, de)), Math.round(b * 57.3)]; };
  const h = f.riverHerd, kettle = [];
  for (let k = 0; k < F.capacity; k++) if (F.active[k] && F.mode[k] === 4) kettle.push(rel(F.n[k], F.e[k]));
  kettle.sort((a, b) => a[0] - b[0]);
  return { herd: rel(H.cN[h], H.cE[h]), nearestKettleBirds: kettle.slice(0, 3), agl: s.altitudeAGL };`;

/** Present-day facts: era, no fauna, no fauna group in the scene. */
const PRESENT_FACTS = `(() => { const s = window.__sim; let faunaGroup = false; s.ctx.scene.traverse((o) => { if (o.name === 'fauna') faunaGroup = true; }); return { era: s.era, fauna: s.fauna, faunaGroup, training: !!s.training.system }; })()`;

// ------------------------------------------------------------------------------------------------ shot lists

const CRET = 'index.html?era=cretaceous&clock=0&mute=1&resume=0';
const ERA_SHOTS = [
  { name: 'flats-lineup-0900', label: 'Flats, line-up 07, tod 9', page: `${CRET}&scenario=runway&tod=9&cam=chase&ui=0`, wait: 2500 },
  { name: 'flats-lineup25-1936', label: 'Flats, line-up 25, tod 19.6 (volcano backlit)', page: `${CRET}&scenario=runway&tod=19.6&cam=chase&ui=0`, evalJs: timed(LINEUP_25), wait: 1500 },
  { name: 'safari-start-1000', label: 'Safari start, tod 10, 8 s in (herd, left window)', page: `${CRET}&tod=10&ui=0`, evalJs: timed(SAFARI_AT(8000)), wait: 0 },
  { name: 'safari-herd-1400', label: 'Safari start, tod 10, 14 s in (herd abeam left)', page: `${CRET}&tod=10&ui=0`, evalJs: timed(SAFARI_AT(14000)), wait: 0 },
  { name: 'safari-kettle-1000', label: 'Safari, tod 10, 36 s in (kettle ahead right)', page: `${CRET}&tod=10&ui=0`, evalJs: timed(SAFARI_AT(36000)), wait: 0 },
  { name: 'herd-lowpass', label: 'Low pass over the river herd (flee)', page: `${CRET}&tod=10&ui=0`, evalJs: timed(LOW_PASS), wait: 0 },
  { name: 'kettle-close', label: 'Kettle of azhdarchids, 45 m', page: `${CRET}&tod=10&ui=0`, evalJs: timed(KETTLE), wait: 0 },
  { name: 'pair-scale', label: 'Scale: the resting pair beside the C172', page: `${CRET}&scenario=runway&tod=10&ui=0`, evalJs: timed(PAIR_SCALE), wait: 0 },
  { name: 'pair-launch', label: 'Resting pair launching on the 07 roll', page: `${CRET}&scenario=runway&tod=10&ui=0`, evalJs: timed(PAIR_LAUNCH), wait: 0 },
  { name: 'volcano-close', label: 'Volcano from 3000 m', page: 'dev/terrain.html?era=cretaceous&cam=7000,-9500,3000&look=2000,-17500,1700&tod=10&freeze=1', wait: 2500 },
  { name: 'valley-1500ft', label: 'Valley overview, 1500 ft above the Flats, toward the river herd', page: `${CRET}&tod=10&ui=0&camPos=-2600,-1400,580&camLook=-1622,4315,130`, evalJs: timed(SETTLE), wait: 500 },
  { name: 'night-2200', label: 'Night, tod 22 (safari, chase)', page: `${CRET}&tod=22&cam=chase&ui=0`, wait: 3000 },
  { name: 'forest-close', label: 'Cretaceous trees (dev/terraintrees)', page: 'dev/terraintrees.html?era=cretaceous&tod=10&freeze=1', wait: 2500 },
  { name: 'field-guide-toast', label: 'Field Guide toast (safari)', page: `${CRET}&tod=10`, evalJs: timed(TOAST), wait: 0 },
];

const PRES = 'index.html?clock=0&mute=1&resume=0&freeze=1';
const PRESENT_SHOTS = [
  // Deterministic harness pages: tolerance 0, expected 0 px.
  { name: 'terrain-valley', page: 'dev/terrain.html?cam=-2000,1200,600&look=3000,0,100&tod=10&freeze=1', exact: true },
  { name: 'terrain-strip', page: 'dev/terrain.html?cam=-301,-827,270&look=300,830,120&tod=10&freeze=1', exact: true },
  { name: 'terrain-volcano-site', page: 'dev/terrain.html?cam=7000,-9500,3000&look=2000,-17500,1700&tod=10&freeze=1', exact: true },
  { name: 'trees', page: 'dev/terraintrees.html?tod=10&freeze=1', exact: true },
  // index.html (not deterministic run to run): judged against the main-vs-main noise floor.
  { name: 'index-runway-0900', page: `${PRES}&scenario=runway&tod=9&cam=chase&ui=0`, facts: true },
  { name: 'index-valley-1000', page: `${PRES}&scenario=runway&tod=10&ui=0&camPos=-2600,-1400,580&camLook=3000,2600,150` },
  { name: 'index-night-2200', page: `${PRES}&scenario=cruise&tod=22&cam=chase&ui=0` },
];

// ------------------------------------------------------------------------------------------------ running

const summary = { out, era: [], present: [] };

function shot(checkout, page, file, { evalJs, wait = 1500 } = {}) {
  const args = [join(checkout, 'scripts', 'shot.mjs'), page, file, '--wait', String(wait), '--timeout', '180000'];
  if (evalJs) args.push('--eval', evalJs);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, { cwd: checkout, encoding: 'utf8', maxBuffer: 1 << 26 });
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const evalLine = text.split('\n').find((l) => l.startsWith('[eval]'));
  let result = null;
  if (evalLine) {
    try {
      result = JSON.parse(evalLine.slice(7));
    } catch {
      result = evalLine.slice(7);
    }
  }
  const problems = text.split('\n').filter((l) => /^\[(pageerror|console\.error)\]|never set window.__ready/.test(l));
  return { ok: r.status === 0 && existsSync(file), seconds: Math.round((Date.now() - t0) / 1000), result, problems };
}

function imgdiff(a, b, tol = 0) {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'imgdiff.mjs'), a, b, '--tol', String(tol), '--strict', '--no-rules'], { encoding: 'utf8' });
  const text = r.stdout ?? '';
  const m = text.match(/(\d+) of (\d+) pixels differ/);
  const d = text.match(/largest channel difference (\d+)/);
  return { pixels: m ? Number(m[1]) : NaN, maxChannel: d ? Number(d[1]) : 0, line: text.trim().split('\n')[0] ?? '' };
}

const want = (name) => !only || only.has(name);

if (!flags['skip-era']) {
  for (const s of ERA_SHOTS.filter((x) => want(x.name))) {
    const file = join(out, `${s.name}.png`);
    const r = shot(root, s.page, file, s);
    summary.era.push({ name: s.name, label: s.label, page: s.page, file, ...r });
    console.log(`[era] ${s.name}: ${r.ok ? 'ok' : 'FAILED'} in ${r.seconds}s ${r.result ? JSON.stringify(r.result).slice(0, 400) : ''}`);
    for (const p of r.problems) console.log(`      ${p}`);
  }
}

if (flags.present) {
  const presentDir = join(out, 'present');
  mkdirSync(presentDir, { recursive: true });
  const mainDir = flags.main ? resolve(flags.main) : null;
  for (const s of PRESENT_SHOTS.filter((x) => want(x.name))) {
    const branch = join(presentDir, `branch-${s.name}.png`);
    const entry = { name: s.name, page: s.page, branch, ...shot(root, s.page, branch, { wait: 2500 }) };
    if (s.facts) entry.facts = shot(root, s.page, join(presentDir, `facts-${s.name}.png`), { evalJs: PRESENT_FACTS, wait: 500 }).result;
    if (mainDir) {
      const runs = s.exact ? 1 : 2;
      entry.main = [];
      for (let k = 0; k < runs; k++) {
        const file = join(presentDir, `main-${s.name}${k ? `-${k + 1}` : ''}.png`);
        shot(mainDir, s.page, file, { wait: 2500 });
        entry.main.push(file);
      }
      entry.branchVsMain = imgdiff(entry.main[0], branch, 0);
      if (!s.exact) {
        // The noise floor: main against itself, and the branch against main, at a few tolerances. The branch
        // passes when it differs from main no more than main differs from itself.
        entry.mainVsMain = imgdiff(entry.main[0], entry.main[1], 0);
        // One floor sample is itself noisy (+-25% run to run here), so the branch is compared with the nearer of
        // the two main runs and allowed a 25% margin over the main-vs-main count.
        entry.floor = [4, 16, 32].map((tol) => ({
          tol,
          branchVsMain: Math.min(imgdiff(entry.main[0], branch, tol).pixels, imgdiff(entry.main[1], branch, tol).pixels),
          mainVsMain: imgdiff(entry.main[0], entry.main[1], tol).pixels,
        }));
        entry.withinNoise = entry.floor.every((f) => f.branchVsMain <= 1.25 * f.mainVsMain);
      }
    }
    summary.present.push(entry);
    const d = entry.branchVsMain ? ` branch-vs-main tol0 ${entry.branchVsMain.pixels} px` : '';
    const n = entry.floor ? `; main-vs-main tol0 ${entry.mainVsMain.pixels} px; ${entry.floor.map((f) => `tol${f.tol} branch ${f.branchVsMain} / main ${f.mainVsMain}`).join(', ')}: ${entry.withinNoise ? 'within the noise floor' : 'ABOVE the noise floor'}` : '';
    console.log(`[present] ${s.name}: ${entry.ok ? 'ok' : 'FAILED'}${d}${n}${entry.facts ? ` facts ${JSON.stringify(entry.facts)}` : ''}`);
  }
}

writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));

if (!flags['no-sheet'] && summary.era.some((e) => e.ok)) {
  // Contact sheets of 6 (3 x 2) labelled tiles each.
  const tiles = summary.era.filter((e) => e.ok);
  for (let k = 0; k * 6 < tiles.length; k++) {
    const part = tiles.slice(k * 6, k * 6 + 6);
    const sheet = join(out, `contact-${k + 1}.png`);
    const args = [];
    for (const t of part) args.push('-label', t.label, t.file);
    args.push('-tile', '3x', '-geometry', '800x450+6+6', '-pointsize', '20', '-background', '#202020', '-fill', '#e8e8e8', sheet);
    const r = spawnSync('montage', args, { encoding: 'utf8' });
    console.log(r.status === 0 ? `[sheet] ${sheet}` : `[sheet] montage failed: ${r.stderr}`);
  }
}
console.log(`[shot-era] summary: ${join(out, 'summary.json')}`);
