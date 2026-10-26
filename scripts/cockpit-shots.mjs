#!/usr/bin/env node
// Usage: node scripts/cockpit-shots.mjs [--types c172s,c208] [--out dir] [--views default,wide,down,downright,close]
//          [--width 1366] [--height 768] [--dpr 1] [--quality high] [--tag before]
// Screenshots of the 3D cockpit on the runway at noon from the pilot eye, in fixed head poses: the default view, a wide
// view a little down (framed like the MSFS reference frames), looking down at the controls, down and right at the pedestal, and a close-up aimed at the pilot's yoke (or stick) at a 28 degree
// field of view. Per type it also records the draw calls and triangles of one frame (renderer.info over every pass), the
// triangles of the control column meshes ("yoke:" / "stick:"), and which main dials the pilot's own column hides in the
// default view (a CPU raycast from the eye to each dial centre against the opaque cockpit meshes; no GPU readback).
// Writes <out>/<type>_<tag>_<view>.png and <out>/shots_<tag>.json. Starts its own vite on a free port.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const types = flag('types', 'c172s,c152,pa38,pa34,c208,pc12,da20').split(',');
const out = resolve(flag('out', `${root}/shots/cockpit-shots`));
const views = flag('views', 'default,wide,down,downright,close').split(',');
const width = Number(flag('width', '1366')), height = Number(flag('height', '768'));
const dpr = Number(flag('dpr', '1'));
const quality = flag('quality', 'high');
const tag = flag('tag', 'now');
mkdirSync(out, { recursive: true });

const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, optimizeDeps: { holdUntilCrawlEnd: true } });
await server.listen();
const port = server.httpServer.address().port;
const gpuArgs = ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-webgl'];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: gpuArgs });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {};

/** In the page: put the head at (yaw, pitch) rad and the zoom at fov deg at once; 'close' aims at the pilot's column. */
function pose([view]) {
  const THREE = window.__THREE;
  const ctx = window.__sim.ctx;
  const rig = window.__sim.sim.systems.cameras.cockpit;
  const D = Math.PI / 180;
  let yaw = 0, pitch = rig.defaultPitch, fov = rig.defaultFov;
  if (view === 'down') pitch = -42 * D;
  // Framed like the MSFS reference frames from the left seat: a little down, wide.
  if (view === 'wide') { pitch = -24 * D; fov = 66; }
  if (view === 'downright') { yaw = -38 * D; pitch = -40 * D; }
  if (view === 'close') {
    let target = null;
    ctx.aircraftRoot.traverse((o) => { if (o.isMesh && /^(yoke|stick):/.test(o.name) && !target) target = o; });
    const inv = new THREE.Matrix4().copy(ctx.aircraftRoot.matrixWorld).invert();
    // A yoke: its hub (the group origin) and a little above; a stick: the middle of its bounds.
    const c = (/^yoke/.test(target.name) ? target.parent.localToWorld(new THREE.Vector3(0, 0.04, 0)) : new THREE.Box3().setFromObject(target.parent).getCenter(new THREE.Vector3())).applyMatrix4(inv);
    const eye = ctx.camera.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    const d = c.sub(eye);
    yaw = Math.atan2(-d.x, -d.z);
    pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    fov = 40;
  }
  rig.yaw = rig.targetYaw = yaw;
  rig.pitch = rig.targetPitch = pitch;
  rig.fov = rig.targetFov = fov;
  return { yawDeg: +(yaw / D).toFixed(1), pitchDeg: +(pitch / D).toFixed(1), fov };
}

/** In the page: draw calls and triangles of one whole frame, and the column meshes' triangles. */
async function counts() {
  const r = window.__sim.ctx.renderer;
  r.info.autoReset = false;
  await new Promise((d) => requestAnimationFrame(() => d()));
  r.info.reset();
  await new Promise((d) => requestAnimationFrame(() => d()));
  const calls = r.info.render.calls, triangles = r.info.render.triangles;
  r.info.autoReset = true;
  const column = { meshes: 0, triangles: 0, vertices: 0 };
  window.__sim.ctx.aircraftRoot.traverse((o) => {
    if (!o.isMesh || !/^(yoke|stick):/.test(o.name)) return;
    column.meshes++;
    const g = o.geometry;
    column.triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    column.vertices += g.getAttribute('position').count;
  });
  return { calls, triangles, column };
}

/** In the page: the main dials whose centre the eye cannot see past an opaque mesh, and what hides them. */
function hidden() {
  const THREE = window.__THREE;
  const sim = window.__sim.sim, ctx = window.__sim.ctx, cam = ctx.camera;
  cam.updateMatrixWorld();
  let mesh = null;
  ctx.aircraftRoot.traverse((o) => { if (o.isMesh && o.name === 'instrumentPanel' && !mesh) mesh = o; });
  const panel = sim.systems.panel, def = panel.def, W = def.size.w, H = def.size.h;
  const geo = mesh.geometry, pos = geo.getAttribute('position'), uv = geo.getAttribute('uv');
  const index = geo.index; let best = -1, area = 0;
  for (let t = 0; t + 2 < (index?.count ?? pos.count); t += 3) {
    const [a, b, c] = [t, t + 1, t + 2].map((i) => (index ? index.getX(i) : i));
    const det = Math.abs((uv.getX(b) - uv.getX(a)) * (uv.getY(c) - uv.getY(a)) - (uv.getX(c) - uv.getX(a)) * (uv.getY(b) - uv.getY(a)));
    if (det > area) { area = det; best = t; }
  }
  const [a, b, c] = [best, best + 1, best + 2].map((i) => (index ? index.getX(i) : i));
  const u1 = uv.getX(b) - uv.getX(a), v1 = uv.getY(b) - uv.getY(a), u2 = uv.getX(c) - uv.getX(a), v2 = uv.getY(c) - uv.getY(a);
  const det = u1 * v2 - u2 * v1;
  const o = new THREE.Vector3().fromBufferAttribute(pos, a);
  const e1 = new THREE.Vector3().fromBufferAttribute(pos, b).sub(o), e2 = new THREE.Vector3().fromBufferAttribute(pos, c).sub(o);
  const du = e1.clone().multiplyScalar(v2).addScaledVector(e2, -v1).divideScalar(det);
  const dv = e2.clone().multiplyScalar(u1).addScaledVector(e1, -u2).divideScalar(det);
  o.addScaledVector(du, -uv.getX(a)).addScaledVector(dv, -uv.getY(a));
  mesh.updateMatrixWorld();
  const world = (px, py) => o.clone().addScaledVector(du, px / W).addScaledVector(dv, 1 - py / H).applyMatrix4(mesh.matrixWorld);
  const opaque = [];
  ctx.aircraftRoot.traverse((m) => {
    if (!m.isMesh || !m.visible || m.name === 'cabinLining' || m.name.startsWith('occupants') || m === mesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.every((x) => x.transparent || x.opacity < 1 || x.visible === false)) return;
    opaque.push(m);
  });
  const eye = cam.getWorldPosition(new THREE.Vector3());
  const ray = new THREE.Raycaster();
  const MAIN = ['attitude', 'asi', 'altimeter', 'heading', 'hsi', 'vsi', 'turn', 'tach', 'rmi'];
  const out = [];
  for (const g of def.gauges) {
    if (!MAIN.includes(g.kind)) continue;
    const r = panel.regions.get(g.id);
    if (!r) continue;
    // Five points: the centre and four points 3/4 of the way to a 3-1/8 in dial's rim.
    const half = (0.0794 / 2) / (du.length() * mesh.matrixWorld.getMaxScaleOnAxis() / W) * 0.75;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    let blocked = 0; const by = new Set();
    for (const [px, py] of [[cx, cy], [cx - half, cy], [cx + half, cy], [cx, cy - half], [cx, cy + half]]) {
      const p = world(px, py);
      const dir = p.clone().sub(eye); const dist = dir.length(); dir.normalize();
      ray.set(eye, dir); ray.near = 0.02; ray.far = dist - 0.004;
      const hit = ray.intersectObjects(opaque, false)[0];
      if (hit) { blocked++; by.add(hit.object.name); }
    }
    if (blocked) out.push({ id: g.id, blocked5: blocked, by: [...by] });
  }
  return out;
}

try {
  for (const type of types) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(`http://127.0.0.1:${port}/index.html?aircraft=${type}&scenario=runway&cam=cockpit&mute=1&quality=${quality}&tod=12&resume=0`, { waitUntil: 'load', timeout: 180000 });
    await p.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
    await p.evaluate(async () => { window.__THREE = await import('/node_modules/three/build/three.module.js'); });
    await sleep(2500);
    const r = { counts: await p.evaluate(counts), views: {} };
    for (const view of views) {
      r.views[view] = await p.evaluate(pose, [view]);
      await sleep(700);
      if (view === 'default') r.hidden = await p.evaluate(hidden);
      await p.screenshot({ path: `${out}/${type}_${tag}_${view}.png` });
    }
    r.errors = errs;
    results[type] = r;
    console.log(`${type}: calls ${r.counts.calls} tris ${r.counts.triangles} column ${JSON.stringify(r.counts.column)} hidden ${JSON.stringify(r.hidden)}${errs.length ? ' errors ' + errs.slice(0, 2) : ''}`);
    await ctx.close();
  }
} finally {
  writeFileSync(`${out}/shots_${tag}.json`, JSON.stringify(results, null, 1));
  await browser.close();
  await server.close();
}
