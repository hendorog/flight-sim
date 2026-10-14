#!/usr/bin/env node
// Deep Time performance probe: draw calls, fauna triangles / CPU / terrain calls, GPU frame time and the
// auto-exposure value at fixed era poses, optionally A/B against ?eraoff= (the era layers switched off).
//
//   node scripts/era-perf.mjs [--poses herd,safari14] [--out file.json] [--frames 300] [--quality high]
//                             [--eraoff plume,lava,...] [--ab] [--cpu-throttle N] [--runs 1] [--shots dir]
//
//   --poses     which poses (below; default herd,safari14). The G-frame poses (g1..g7) read the frame times from
//               FIRST_MINUTE_FRAMES (src/world/era/cretaceousAnchors.ts) in the page, so they follow WP8's tuning.
//   --out       write the results as JSON (also printed)
//   --frames    frames measured per pose (default 300)
//   --quality   graphics preset (default high)
//   --eraoff    add ?eraoff=<list> to every page (the dev A/B switch of the era layers)
//   --ab        run every pose twice: as given, and with eraoff=plume,lava,speckle,understorey; report both
//   --cpu-throttle  DevTools CPU throttling factor (e.g. 4)
//   --runs      repeat each measurement and keep every run (the summary is the median)
//   --shots     also keep the screenshot of each pose in this directory
//
// Every measurement is one run of scripts/shot.mjs (headless Chrome on the GPU at 1600x900, a private vite
// server) with an --eval that drives window.__sim. Per pose it reports:
//   draws      renderer.info.render.calls per whole frame (every offscreen render, shadows, scene and post
//              passes; autoReset off, counted between two rAF ticks): median, min and max over the window
//   triangles  renderer.info.render.triangles per frame, median
//   fauna      tris (sum of instance counts x LOD triangles: FaunaSystem.stats.tris once WP0b adds it, else
//              debug.triangles), visible,
//              cpu mean / p95 (stats.cpuMs per frame), terrainCalls max, deferred max, reallocs
//   gpu        post pipeline (scene + passes) GPU ms p50 / p90 with EXT_disjoint_timer_query_webgl2, or the
//              rAF-interval median as a fallback (gpuSource says which)
//   exposure   the adapted log2 luminance (AutoExposure's 1x1 target) at the end of the window
//
// Poses:
//   herd      the inc-1 herd viewpoint: the runway scenario at tod 10, a fixed camera 250 m south-west of the
//             river herd's centroid and 60 m above it, looking at it (the herd at LOD0/1, the valley behind)
//   safari14  the OLD (increment 1) safari pose at tod 10 (booted on the runway start, then reset there): along 4870, across 3450, track 35 deg, 600 ft AGL,
//             110 KIAS on the autoflight hold, cockpit view, measured from 14 s after the reset. Built
//             explicitly here, so it stays the same pose after SAFARI moves (cretaceousAnchors.ts)
//   g1..g7    the DEFAULT boot (no tod, the safari at SAFARI), cockpit, from FIRST_MINUTE_FRAMES' time
//   away-sw   (inc 2b) the runway scenario at tod 10 with a fixed camera (camPos / camLook: the streaming follows
//             the camera) at (-15000, -14000, 420) over the river floodplain SW, the densest streaming point (waterside and
//             plains Edmontosaurus, Triceratops, an Alamosaurus group, a roaming T. rex), measured after 30 s of sim
//             time (the cells probed and the herds spawned)
//   away-up   (inc 2b) the same over the lake-east Araucaria uplands (10600, 4300): Triceratops, plains
//             Edmontosaurus and the Alamosaurus groups

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) {
  const k = argv[i].replace(/^--/, '');
  if (['ab'].includes(k)) flags[k] = true;
  else flags[k] = argv[++i];
}
const poses = (flags.poses ?? 'herd,safari14').split(',').map((s) => s.trim()).filter(Boolean);
const frames = Number(flags.frames ?? 300);
const quality = flags.quality ?? 'high';
const runs = Number(flags.runs ?? 1);
const ALL_OFF = 'plume,lava,speckle,understorey';

// ------------------------------------------------------------------------------------------------ page snippets

/** Stub the panel's GPU readback (scripts/shot-era.mjs PANEL_STUB: headless Chrome pacing). */
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

/** The measurement window, run after the pose's setup (`sim`, `f`, `sleep`, `until` in scope). */
const MEASURE = (n) => `
  const gl = sim.ctx.renderer.getContext();
  const renderer = sim.ctx.renderer;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const post = sim.post, orig = post.render;
  const queries = [], cpu = [], calls = [], defer = [], raf = [], drawList = [], triList = [];
  let tris = 0, visible = 0, k = 0, last = 0;
  post.render = function (...a) {
    let q = null;
    if (ext) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
    try { return orig.apply(this, a); }
    finally { if (ext) { gl.endQuery(ext.TIME_ELAPSED_EXT); queries.push(q); } }
  };
  // Whole-frame counts: info accumulates between two ticks of this loop (one frame: every system's offscreen
  // renders, the shadow maps, the scene and the post passes).
  const autoReset = renderer.info.autoReset;
  renderer.info.autoReset = false;
  renderer.info.reset();
  await new Promise((done) => {
    const tick = (t) => {
      if (last) raf.push(t - last);
      last = t;
      if (f) {
        cpu.push(f.stats.cpuMs);
        calls.push(f.stats.terrainCalls);
        defer.push(f.debug.deferred);
        tris = Math.max(tris, f.stats.tris ?? f.debug.triangles);
        visible = Math.max(visible, f.stats.visible);
      }
      if (k > 0) { drawList.push(renderer.info.render.calls); triList.push(renderer.info.render.triangles); }
      renderer.info.reset();
      if (++k <= ${n}) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  });
  post.render = orig;
  renderer.info.autoReset = autoReset;
  const gpu = [];
  for (let tries = 0; tries < 100 && queries.length; tries++) {
    while (queries.length && gl.getQueryParameter(queries[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = queries.shift();
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
    }
    if (queries.length) await sleep(20);
  }
  const pct = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  // The adapted exposure: AutoExposure's 1x1 float target (log2 of the adapted luminance, scene units).
  let exposure = NaN;
  try {
    const ae = post.exposure, px = new Float32Array(4);
    renderer.readRenderTargetPixels(ae.adapted[0], 0, 0, 1, 1, px);
    exposure = px[0];
  } catch (e) {}
  const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
  return {
    simTime: sim.summary().time, tod: sim.summary().timeOfDay, frames: k - 1,
    draws: pct(drawList, 0.5), drawsMax: pct(drawList, 1), drawsMin: pct(drawList, 0), triangles: pct(triList, 0.5),
    fauna: f ? { tris, visible, cpuMean: r3(mean(cpu)), cpuP95: r3(pct(cpu, 0.95)), terrainCallsMax: Math.max(...calls), deferredMax: Math.max(...defer), reallocs: f.stats.reallocs } : null,
    gpu: gpu.length ? { source: 'timer', p50: r3(pct(gpu, 0.5)), p90: r3(pct(gpu, 0.9)), n: gpu.length } : { source: 'raf', p50: r3(pct(raf, 0.5)), p90: r3(pct(raf, 0.9)), n: raf.length },
    exposure: r3(exposure),
  };`;

const wrap = (setup, n) => `(async () => {
  const stubbed = ${PANEL_STUB};
  const sim = window.__sim, f = sim.fauna;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (cond, ms) => { const t0 = performance.now(); while (!cond()) { if (performance.now() - t0 > ms) return false; await sleep(50); } return true; };
  const pose = await (async () => { ${setup} })();
  const m = await (async () => { ${MEASURE(n)} })();
  return { stubbed, pose, ...m };
})()`;

const HERD = `
  const H = f.herds, h = f.riverHerd, cn = H.cN[h], ce = H.cE[h], ch = H.cH[h];
  sim.setFixedCamera([cn - 177, ce - 177, ch + 60], [cn, ce, ch + 2]);
  await sleep(2500);
  return { herd: [Math.round(cn), Math.round(ce), Math.round(ch)] };`;

/** The increment-1 safari pose, rebuilt explicitly (see the header). */
const SAFARI14 = `
  const D = Math.PI / 180, rwy = 70 * D, along = 4870, across = 3450, track = 35 * D, agl = 600 * 0.3048;
  const n = along * Math.cos(rwy) - across * Math.sin(rwy), e = along * Math.sin(rwy) + across * Math.cos(rwy);
  const heading = (rwy + Math.PI + track) % (2 * Math.PI);
  const base = sim.physics.scenario;
  const reset = (alt) => sim.physics.resetTo({ ...base, id: 'safari', ic: { ...base.ic, position: { x: n, y: e, z: -alt }, heading, onGround: false, engineRunning: true }, autoflight: { kind: 'hold', heading, altitude: alt, kias: 110 } });
  reset(1000);
  const s0 = sim.summary(), ground = s0.altitudeMSL - s0.altitudeAGL;
  reset(ground + agl);
  sim.setCamera('cockpit');
  sim.setAutoflight(true);
  sim.post.snapExposure();
  const t0 = sim.summary().time;
  await until(() => sim.summary().time - t0 >= 14, 120000);
  const s = sim.summary();
  return { start: [Math.round(n), Math.round(e), Math.round(ground + agl)], t: +(s.time - t0).toFixed(1), agl: Math.round(s.altitudeAGL), heading: s.headingDeg };`;

/** A G frame of the default boot, at FIRST_MINUTE_FRAMES' time (a dynamic import in the page). */
const GFRAME = (id) => `
  const mod = await import('/src/world/era/cretaceousAnchors.ts');
  const fr = mod.FIRST_MINUTE_FRAMES.find((x) => x.id === '${id.toUpperCase()}');
  if (!fr) return { error: 'no frame ${id}' };
  await until(() => sim.summary().time >= fr.t, 300000);
  return { frame: fr.id, t: sim.summary().time };`;

const CRET = (q) => `index.html?era=cretaceous&clock=0&mute=1&resume=0&ui=0&quality=${quality}${q}`;
const POSES = {
  herd: { page: CRET('&scenario=runway&tod=10'), setup: HERD },
  // Booted from the runway start (not the safari, which moves with SAFARI) so the streaming history before the
  // teleport is the same before and after a change of SAFARI.
  safari14: { page: CRET('&scenario=runway&tod=10'), setup: SAFARI14 },
};
for (let g = 1; g <= 7; g++) POSES[`g${g}`] = { page: CRET(''), setup: GFRAME(`g${g}`) };

/** Away from the start (inc 2b): wait for 30 s of sim time at a fixed camera, so the habitat cells are streamed. */
const AWAY = `
  await until(() => sim.summary().time > 30, 300000);
  return { t: sim.summary().time, herds: f ? f.herds.count() : 0, animals: f ? f.herds.members() : 0, agents: f ? f.agents.count() : 0 };`;
POSES['away-sw'] = { page: CRET('&scenario=runway&tod=10&camPos=-15000,-14000,420&camLook=-14301,-13749,110'), setup: AWAY };
POSES['away-up'] = { page: CRET('&scenario=runway&tod=10&camPos=10600,4300,720&camLook=13106,6726,660'), setup: AWAY };

// ------------------------------------------------------------------------------------------------ running

function measure(name, eraoff) {
  const pose = POSES[name];
  if (!pose) throw new Error(`unknown pose ${name} (have ${Object.keys(POSES).join(', ')})`);
  const page = pose.page + (eraoff ? `&eraoff=${eraoff}` : '');
  const shotsDir = flags.shots ? resolve(flags.shots) : null;
  if (shotsDir) mkdirSync(shotsDir, { recursive: true });
  const file = shotsDir ? join(shotsDir, `${name}${eraoff ? '-off' : ''}.png`) : join(tmpdir(), `era-perf-${process.pid}-${name}.png`);
  const args = [join(root, 'scripts', 'shot.mjs'), page, file, '--wait', '0', '--timeout', '400000', '--eval', wrap(pose.setup, frames)];
  if (flags['cpu-throttle']) args.push('--cpu-throttle', String(flags['cpu-throttle']));
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (!shotsDir && existsSync(file)) rmSync(file);
  const line = text.split('\n').find((l) => l.startsWith('[eval]'));
  const problems = text.split('\n').filter((l) => /^\[(pageerror|console\.error)\]|never set window.__ready/.test(l));
  if (!line) return { ok: false, page, problems, tail: text.split('\n').slice(-15) };
  return { ok: r.status === 0, page, ...JSON.parse(line.slice(7)), problems };
}

const median = (a) => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
function summarise(list) {
  const ok = list.filter((x) => x.ok);
  if (!ok.length) return null;
  return {
    draws: median(ok.map((x) => x.draws)),
    drawsMax: Math.max(...ok.map((x) => x.drawsMax)),
    triangles: median(ok.map((x) => x.triangles)),
    faunaTris: median(ok.map((x) => x.fauna?.tris)),
    faunaCpuMean: median(ok.map((x) => x.fauna?.cpuMean)),
    faunaCpuP95: median(ok.map((x) => x.fauna?.cpuP95)),
    terrainCallsMax: median(ok.map((x) => x.fauna?.terrainCallsMax)),
    gpuP50: median(ok.map((x) => x.gpu?.p50)),
    gpuSource: ok[0].gpu?.source,
    exposure: median(ok.map((x) => x.exposure)),
  };
}

const result = { when: new Date().toISOString(), quality, frames, cpuThrottle: Number(flags['cpu-throttle'] ?? 1), eraoff: flags.eraoff ?? null, poses: {} };
for (const name of poses) {
  const variants = flags.ab ? [['on', flags.eraoff ?? ''], ['off', ALL_OFF]] : [['on', flags.eraoff ?? '']];
  result.poses[name] = {};
  for (const [label, off] of variants) {
    const list = [];
    for (let k = 0; k < runs; k++) {
      const m = measure(name, off);
      list.push(m);
      console.log(`[era-perf] ${name}${label === 'off' ? ' (eraoff)' : ''} run ${k + 1}: ${m.ok ? 'ok' : 'FAILED'} ${JSON.stringify({ draws: [m.drawsMin, m.draws, m.drawsMax], fauna: m.fauna, gpu: m.gpu, exposure: m.exposure, pose: m.pose })}`);
      for (const p of m.problems ?? []) console.log(`      ${p}`);
      if (!m.ok && m.tail) console.log(m.tail.join('\n'));
    }
    result.poses[name][label] = { summary: summarise(list), runs: list };
  }
}
if (flags.out) {
  mkdirSync(dirname(resolve(flags.out)), { recursive: true });
  writeFileSync(resolve(flags.out), JSON.stringify(result, null, 2));
  console.log(`[era-perf] wrote ${resolve(flags.out)}`);
}
for (const [name, v] of Object.entries(result.poses)) for (const [label, x] of Object.entries(v)) console.log(`[era-perf] ${name} ${label}: ${JSON.stringify(x.summary)}`);
