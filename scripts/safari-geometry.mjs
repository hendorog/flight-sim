#!/usr/bin/env node
// Deep Time, the safari's first minute: the measuring and solving tool behind src/world/era/cretaceousAnchors.ts
// (increment 2, WP0a). Its outputs are written into that file by hand (numbers and the header tables); the
// tests (tests/era/safariGeometry.test.ts) re-derive what can be derived in node and pin the rest.
//
//   node scripts/safari-geometry.mjs sill [--out file.json]
//       Measure the cockpit's view limits at the default head pose (C172, cockpit camera, 1600 x 900): for every
//       bearing off the nose (body frame, 1 deg bins) the depression of the first cockpit surface below the
//       body's horizontal plane (the sill: glareshield, cowl, door frame) and the elevation of the first one
//       above it (the windscreen header), by ray casting the opaque, visible meshes under ctx.aircraftRoot
//       (glazing, propeller and compass glass excluded) in the page. Prints the SILL table.
//
//   node scripts/safari-geometry.mjs fly [--tod 18.6] [--track 27] [--across N] [--agl 400] [--seconds 120]
//       Fly the safari start hands-off in node (SimPhysics, the Cretaceous era and weather) and print the
//       trajectory every 2 s: along / across the track, AGL, pitch, ground speed. Gives SAFARI_GS and the
//       cruise pitch the anchors use.
//
//   node scripts/safari-geometry.mjs solve
//       Everything that needs the terrain or the fauna's pure functions, in node: the river herd's actual site
//       (riverHerdSite), `across` per track (closed form), the AGL clearance table, the araucaria stand search,
//       the sun / volcano / dayFactor table over the tod x track grid.
//
//   node scripts/safari-geometry.mjs sweep [--out dir] [--tods 17.8,18.3] [--tracks 20,27] [--times 2,11] [--lateral 300]
//       Shoot the default boot (cockpit, the stub content) at each tod x track at the given times, writing
//       <out>/wp0a-sweep-<tod>-<track>-<t>.png, and print each frame's measurements (sun on screen, herd / ground
//       luminance contrast, the cone / sky contrast below and above the summit, auto-exposure). A track other than
//       SAFARI's re-solves `across` (the herd --lateral m left, default HERD_LATERAL_M) and re-starts the hold there
//       in the page; SAFARI's own track flies the default boot unchanged.
//
// The TypeScript sources are loaded through vite's SSR module loader (no build step).

import { createServer } from 'vite';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [mode, ...rest] = process.argv.slice(2);
const flags = {};
for (let i = 0; i < rest.length; i++) flags[rest[i].replace(/^--/, '')] = rest[i + 1]?.startsWith('--') ? true : rest[++i];

async function ssr(fn) {
  const server = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
  try {
    return await fn((p) => server.ssrLoadModule(p));
  } finally {
    await server.close();
  }
}

const shot = (page, out, evalJs, extra = []) => {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'shot.mjs'), page, out, '--wait', '0', '--timeout', '400000', '--eval', evalJs, ...extra], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const line = text.split('\n').find((l) => l.startsWith('[eval]'));
  if (!line) throw new Error(`shot failed:\n${text.split('\n').slice(-20).join('\n')}`);
  for (const l of text.split('\n')) if (/^\[(pageerror|console\.error)\]/.test(l)) console.log('   ', l);
  return JSON.parse(line.slice(7));
};

// ------------------------------------------------------------------------------------------------ sill

/**
 * The cockpit mask: paused at the default head pose, every mesh outside ctx.aircraftRoot and every transparent one
 * inside it (glazing, propeller disc, compass glass) hidden, the scene effects (clouds, aerial perspective) off
 * and the background cleared to magenta. Whatever is not magenta in the shot is cockpit. Returns the camera's
 * attitude relative to the body (three.js frames) so the PNG can be read in body angles.
 */
const SILL_EVAL = `(async () => {
  const sim = window.__sim;
  sim.setCamera('cockpit');
  await new Promise((r) => setTimeout(r, 1500));
  sim.pause(true);
  const scene = sim.ctx.scene, rootObj = sim.ctx.aircraftRoot, cam0 = sim.ctx.camera;
  // Only layer 7 is drawn: the opaque meshes of the aircraft and every light (lights are layer-filtered too).
  let kept = 0;
  rootObj.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    const transparent = m && (Array.isArray(m) ? m.some((x) => x.transparent) : m.transparent || m.opacity < 0.99);
    if (!transparent) { o.layers.enable(7); kept++; }
  });
  scene.traverse((o) => { if (o.isLight) o.layers.enable(7); });
  cam0.layers.set(7);
  scene.background = null;
  sim.post.effects.length = 0;
  // HDR scene units (sunlight ~1e4): a bright magenta that survives the exposure.
  let C = null; rootObj.traverse((o) => { if (!C && o.material && o.material.color) C = o.material.color.constructor; });
  sim.ctx.renderer.setClearColor(new C(Number(window.__SILL_CLEAR ?? 600), 0, Number(window.__SILL_CLEAR ?? 600)), 1);
  const hidden = kept;
  await new Promise((r) => setTimeout(r, 2500));
  const cam = sim.ctx.camera, o = sim.ctx.state.orientation;
  // Body attitude (three.js) and the camera's world attitude: q_rel = q_body^-1 * q_cam.
  const qb = [o.y, -o.z, -o.x, o.w], qc = [cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w];
  const s = sim.summary();
  return { pitchDeg: s.pitchDeg, rollDeg: s.rollDeg, fov: cam.fov, aspect: cam.aspect, W: innerWidth, H: innerHeight, hidden, qb, qc };
})()`;

/** Quaternion helpers ([x, y, z, w]). */
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
const qrot = (q, v) => {
  const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qconj(q));
  return [p[0], p[1], p[2]];
};

async function sill() {
  const { readPng } = await import('./lib/png.mjs');
  const out = flags.out ?? join(root, 'work', 'sill.json');
  const png = out.replace(/\.json$/, '.png');
  mkdirSync(dirname(resolve(out)), { recursive: true });
  const r = shot('index.html?era=cretaceous&scenario=safari&tod=12&clock=0&mute=1&resume=0&ui=0', png, SILL_EVAL);
  const img = readPng(png);
  const { W, H } = r;
  const f = H / 2 / Math.tan((r.fov * Math.PI) / 360);
  const qrel = qmul(qconj(r.qb), r.qc);
  // Body angles of a pixel: the camera-space ray (x right, y up, -z forward) rotated into the body frame.
  const body = (x, y) => {
    const d = qrot(qrel, [x + 0.5 - W / 2, H / 2 - (y + 0.5), -f]);
    return [(Math.atan2(d[0], -d[2]) * 180) / Math.PI, (Math.atan2(d[1], Math.hypot(d[0], d[2])) * 180) / Math.PI];
  };
  const cockpit = (x, y) => {
    const i = (y * W + x) * 4, R = img.data[i], G = img.data[i + 1], B = img.data[i + 2];
    return !(R > G + 60 && B > G + 60);
  };
  // Per column: the row of the body horizon, then the first cockpit pixel below it (the sill) and above it.
  const cols = [];
  for (let x = 0; x < W; x++) {
    let y0 = 0, best = Infinity;
    for (let y = 0; y < H; y++) {
      const e = Math.abs(body(x, y)[1]);
      if (e < best) [best, y0] = [e, y];
    }
    const bearing = body(x, y0)[0];
    if (cockpit(x, y0)) {
      cols.push({ x, bearing, blocked: true });
      continue;
    }
    let lo = null, hi = null;
    for (let y = y0; y < H; y++) if (cockpit(x, y)) { lo = body(x, y); break; }
    for (let y = y0; y >= 0; y--) if (cockpit(x, y)) { hi = body(x, y); break; }
    const bot = body(x, H - 1), top = body(x, 0);
    // Each limit is binned by the bearing AT the limit (a column of a pitched camera is not a line of bearing).
    cols.push({ x, bearing, blocked: false, sillDeg: -(lo ?? bot)[1], sillBearing: (lo ?? bot)[0], sillIsFrame: lo === null, headerDeg: (hi ?? top)[1], headerBearing: (hi ?? top)[0], headerIsFrame: hi === null });
  }
  writeFileSync(out, JSON.stringify({ ...r, f, cols }, null, 1));
  // 1-degree bins of bearing: the sill is the HIGHEST (least depression) in the bin, so a target above it is
  // visible across the whole bin; the header the LOWEST.
  const bins = new Map();
  const bin = (b) => {
    if (!bins.has(b)) bins.set(b, { bearing: b, blocked: 0, n: 0, sill: Infinity, header: Infinity, frame: false });
    return bins.get(b);
  };
  for (const c of cols) {
    const e = bin(Math.round(c.bearing));
    e.n++;
    if (c.blocked) {
      e.blocked++;
      continue;
    }
    const s = bin(Math.round(c.sillBearing));
    s.sill = Math.min(s.sill, c.sillDeg);
    s.frame ||= c.sillIsFrame;
    const h = bin(Math.round(c.headerBearing));
    h.header = Math.min(h.header, c.headerDeg);
  }
  // A bin is blocked when the body horizon is cockpit in most of its columns.
  for (const e of bins.values()) e.isBlocked = e.n > 0 && e.blocked * 2 > e.n;
  const rows = [...bins.values()].sort((a, b) => a.bearing - b.bearing);
  console.log(`pitch ${r.pitchDeg} roll ${r.rollDeg} fov ${r.fov} ${W}x${H}, f ${f.toFixed(1)} px, hidden ${r.hidden}`);
  console.log('bearing  sill(dep)  header(elev)  blocked   (sill = frame bottom: *)');
  for (const e of rows) console.log(`${String(e.bearing).padStart(5)}  ${e.sill === Infinity ? '    - ' : e.sill.toFixed(1).padStart(6)}${e.frame ? '*' : ' '}  ${e.header === Infinity ? '    - ' : e.header.toFixed(1).padStart(6)}   ${e.blocked}/${e.n}${e.isBlocked ? ' BLOCKED' : ''}`);
  // The table for cretaceousAnchors.ts: [bearing, sill depression, header elevation] (body frame, deg), null = blocked.
  const table = rows.filter((e) => e.bearing >= -45 && e.bearing <= 45).map((e) => (e.isBlocked || e.sill === Infinity ? `[${e.bearing}, null, null]` : `[${e.bearing}, ${e.sill.toFixed(1)}, ${e.header === Infinity ? 'null' : e.header.toFixed(1)}]`));
  console.log(`SILL_PROFILE = [${table.join(', ')}]`);
}

// ------------------------------------------------------------------------------------------------ fly

async function fly() {
  await ssr(async (load) => {
    const { setEra } = await load('/src/world/era/eraState.ts');
    setEra('cretaceous');
    const { SimPhysics } = await load('/src/sim/SimPhysics.ts');
    const { defaultWeather } = await load('/src/core/types.ts');
    const { applyEraWeather } = await load('/src/sim/eraChoice.ts').catch(() => ({}));
    const sc = await load('/src/sim/scenarios.ts');
    const A = await load('/src/world/era/cretaceousAnchors.ts').catch(() => null);
    const w = applyEraWeather ? applyEraWeather(defaultWeather(), (await load('/src/world/era/cretaceous.ts')).CRETACEOUS.weather) : defaultWeather();
    w.timeOfDay = Number(flags.tod ?? 18.6);
    const p = new SimPhysics({ weather: w });
    const S = A?.SAFARI;
    const track = Number(flags.track ?? S?.trackDeg ?? 35);
    const across = Number(flags.across ?? S?.across ?? 3450);
    const along = Number(flags.along ?? S?.along ?? 4870);
    const agl = Number(flags.agl ?? S?.aglFt ?? 600);
    const base = sc.buildScenario('safari', p.env);
    const D = Math.PI / 180, rwy = 70 * D;
    const n = along * Math.cos(rwy) - across * Math.sin(rwy), e = along * Math.sin(rwy) + across * Math.cos(rwy);
    const { terrainHeight } = await load('/src/world/terrain/heightfield.ts');
    const alt = terrainHeight(n, e) + agl * 0.3048;
    const hdg = (rwy + Math.PI + track * D) % (2 * Math.PI);
    // No overrides: the safari scenario itself (SAFARI, its hold engaged by the reset), as the default boot flies it.
    const custom = flags.track !== undefined || flags.across !== undefined || flags.agl !== undefined || flags.along !== undefined;
    if (custom) {
      p.resetTo({ ...base, ic: { ...base.ic, position: { x: n, y: e, z: -alt }, heading: hdg, airspeed: sc.kiasToTas(110, alt, p.env) }, autoflight: { kind: 'hold', heading: hdg, altitude: alt, kias: 110 }, engageAutoflight: false });
      if (flags.ap) p.setAutoflight(true);
    } else p.reset('safari');
    const T = Number(flags.seconds ?? 120);
    const fx = Math.cos(hdg), fy = Math.sin(hdg);
    console.log(`start n ${n.toFixed(0)} e ${e.toFixed(0)} alt ${alt.toFixed(0)} hdg ${(hdg / D).toFixed(1)} TAS ${sc.kiasToTas(110, alt, p.env).toFixed(2)} tod ${w.timeOfDay} wind ${w.windDirectionDeg}/${w.windSpeedKt}`);
    for (let t = 0; t <= T; t += Number(flags.step ?? 2)) {
      const s = p.state;
      const dn = s.position.x - n, de = s.position.y - e;
      console.log(`t ${String(t).padStart(3)}  along ${(dn * fx + de * fy).toFixed(1).padStart(8)}  across ${(-dn * fy + de * fx).toFixed(1).padStart(7)}  agl ${s.altitudeAGL.toFixed(1).padStart(6)}  pitch ${(s.pitch / D).toFixed(2)}  roll ${(s.roll / D).toFixed(2)}  hdg ${(s.heading / D).toFixed(1)}  gs ${s.groundSpeed.toFixed(2)}  ias ${(s.ias / 0.514444).toFixed(1)}`);
      p.step(Number(flags.step ?? 2));
    }
  });
}

// ------------------------------------------------------------------------------------------------ main

if (mode === 'sill') await sill();
else if (mode === 'fly') await fly();
else if (mode === 'solve') {
  const { solve, timeline, place } = await import('./safari-geometry-solve.mjs');
  await ssr((load) => (flags.timeline ? timeline(load, flags) : flags.place ? place(load, flags) : solve(load, flags)));
} else if (mode === 'sweep') {
  const { sweep } = await import('./safari-geometry-sweep.mjs');
  const { acrossFor } = await import('./safari-geometry-solve.mjs');
  const tracks = String(flags.tracks ?? '20,27,35').split(',').map(Number);
  const { across, safari } = await ssr(async (load) => ({
    across: await acrossFor(load, tracks, flags.lateral === undefined ? undefined : Number(flags.lateral)),
    safari: { ...(await load('/src/world/era/cretaceousAnchors.ts')).SAFARI },
  }));
  console.log(`across per track: ${JSON.stringify(Object.fromEntries(Object.entries(across).map(([k, v]) => [k, Math.round(v)])))} (SAFARI: track ${safari.trackDeg}, across ${safari.across})`);
  await sweep({ root, flags, shot, tracks, across, safari });
} else {
  console.error('usage: node scripts/safari-geometry.mjs sill|fly|solve|sweep [...]');
  process.exit(2);
}
