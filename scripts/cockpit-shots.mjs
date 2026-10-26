#!/usr/bin/env node
// Usage: node scripts/cockpit-shots.mjs [--types c208,pa34] [--out dir] [--tag before] [--width 1366] [--height 768] [--dpr 1]
//          [--views default,down,downright,close] [--tod 12]
// Cockpit screenshots for comparing the 3D cockpit's furniture (quadrants, pedestals, consoles) against reference frames.
// Starts its own vite on a free port. For each type, on the runway at `tod`: the default view, a look down (pitch -40 deg),
// a look down and right (yaw -30, pitch -38) and a close-up of the engine controls (the head turned to the mean of the
// engine controls' knobs at mid travel, vertical FOV 34 deg). Writes <out>/<type>_<tag>_<view>.png and, per type, the
// renderer's draw calls and triangles of the last frame in each view and the cockpit group's mesh count (info.json).
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const types = flag('types', 'c172s,c152,pa38,da20,pa34,c208,pc12').split(',');
const out = resolve(flag('out', `${root}/shots/cockpit-shots`));
const tag = flag('tag', 'now');
const W = Number(flag('width', '1366')), H = Number(flag('height', '768')), dpr = Number(flag('dpr', '1'));
const views = flag('views', 'default,down,downright,close').split(',');
const tod = flag('tod', '12');
// --clicks 1: in each view, which panel hotspots (instruments/hotspots.ts) are on screen and whether the 3D cockpit hides
// them (a ray from the camera through the hotspot's centre meets another cockpit mesh before the panel face), and a real
// click on the flap lever / switch hotspot's upper and lower halves (controls.flaps must move).
const clicks = flag('clicks', '0') === '1';
mkdirSync(out, { recursive: true });

const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, optimizeDeps: { holdUntilCrawlEnd: true } });
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-webgl'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const infoPath = `${out}/info.json`;
const info = existsSync(infoPath) ? JSON.parse(readFileSync(infoPath, 'utf8')) : {};

/** In the page: turn the head to yaw / pitch (deg, + left / up) at a vertical FOV, at once. */
function look([yawDeg, pitchDeg, fov]) {
  const rig = window.__sim.sim.systems.cameras.cockpit;
  const d = Math.PI / 180;
  rig.targetYaw = rig.yaw = yawDeg * d;
  rig.targetPitch = rig.pitch = pitchDeg * d;
  rig.targetFov = rig.fov = fov;
}

/** In the page: head yaw / pitch (deg) that centre the mean of the engine controls' knobs at mid travel. */
function closeAim(pattern = '^(lever|knob)') {
  const re = new RegExp(pattern);
  const sim = window.__sim;
  const THREE = window.__THREE;
  const root = sim.ctx.aircraftRoot;
  let cockpit = null;
  root.traverse((o) => { if (o.name === 'cockpit' && !cockpit) o.isGroup && (cockpit = o); });
  const pts = [];
  cockpit.traverse((o) => { if (o.isMesh && re.test(o.name)) { o.geometry.computeBoundingBox(); const c = o.geometry.boundingBox.getCenter(new THREE.Vector3()); pts.push(o.localToWorld(c)); } });
  const cam = sim.ctx.camera;
  if (!pts.length) return null;
  const m = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(pts.length);
  // Into the aircraft's frame (model space: x right, y up, z aft) relative to the camera.
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const p = m.applyMatrix4(inv).sub(cam.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv));
  return [Math.atan2(-p.x, -p.z) * 180 / Math.PI, Math.atan2(p.y, Math.hypot(p.x, p.z)) * 180 / Math.PI];
}

/** In the page: the panel hotspots on screen in this view, and those a 3D part stands in front of. */
async function hotspots() {
  const sim = window.__sim;
  const THREE = window.__THREE;
  const ui = sim.sim.systems.ui;
  const clicks = ui.clicks;
  const cam = sim.ctx.camera;
  const meshes = [];
  sim.ctx.aircraftRoot.traverse((o) => { if (o.isMesh && o.visible) { const m = Array.isArray(o.material) ? o.material[0] : o.material; if (!m.transparent) meshes.push(o); } });
  const ray = new THREE.Raycaster();
  const dom = sim.ctx.renderer.domElement.getBoundingClientRect();
  const out = { onScreen: 0, hidden: [] };
  for (const s of clicks.spots) {
    const c = clicks.panelPointToClient(s.x, s.y);
    if (!c || c[0] < 0 || c[1] < 0 || c[0] > dom.width || c[1] > dom.height) continue;
    out.onScreen++;
    ray.setFromCamera(new THREE.Vector2((c[0] / dom.width) * 2 - 1, -(c[1] / dom.height) * 2 + 1), cam);
    const hit = ray.intersectObjects(meshes, false).find((h) => h.distance > 0.05);
    if (hit && hit.object.name !== 'instrumentPanel') out.hidden.push(`${s.id}<-${hit.object.name}`);
  }
  return out;
}

/** In the page: client px of the upper and lower halves of the flap hotspot, or null. */
function flapSpot() {
  const clicks = window.__sim.sim.systems.ui.clicks;
  const s = clicks.spots.find((h) => /flap/i.test(h.id) || /flap/i.test(h.name));
  if (!s) return null;
  return [clicks.panelPointToClient(s.x, s.y - s.hh / 2), clicks.panelPointToClient(s.x, s.y + s.hh / 2), s.id];
}

async function cost() {
  const sim = window.__sim;
  const info = sim.ctx.renderer.info;
  // Every render of one frame (shadows, scene, passes), not only the last.
  info.autoReset = false;
  await new Promise((r) => requestAnimationFrame(() => r()));
  info.reset();
  await new Promise((r) => requestAnimationFrame(() => r()));
  const r = { calls: info.render.calls, triangles: info.render.triangles };
  info.autoReset = true;
  let meshes = 0, tris = 0;
  sim.ctx.aircraftRoot.traverse((o) => {
    if (o.name !== 'cockpit') return;
    o.traverse((m) => { if (m.isMesh && m.visible) { meshes++; const g = m.geometry; tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3; } });
  });
  return { calls: r.calls, triangles: r.triangles, cockpitMeshes: meshes, cockpitTriangles: Math.round(tris) };
}

try {
  for (const type of types) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(`http://127.0.0.1:${port}/index.html?aircraft=${type}&scenario=runway&cam=cockpit&mute=1&quality=high&tod=${tod}&resume=0`, { waitUntil: 'load', timeout: 180000 });
    await p.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
    await p.evaluate(async () => { window.__THREE = await import('/node_modules/three/build/three.module.js'); });
    await sleep(3000);
    const rec = { errors: errs };
    const aim = await p.evaluate(closeAim);
    const trimAim = await p.evaluate(closeAim, '^trimWheel');
    for (const view of views) {
      if (view === 'down') await p.evaluate(look, [0, -40, 60]);
      else if (view === 'downright') await p.evaluate(look, [-30, -38, 60]);
      else if (view === 'floor') await p.evaluate(look, [-50, -62, 60]);
      else if (view === 'close') { if (!aim) continue; await p.evaluate(look, [aim[0], aim[1], 34]); }
      else if (view === 'trim') { if (!trimAim) continue; await p.evaluate(look, [trimAim[0], trimAim[1], 30]); }
      await sleep(700);
      rec[view] = await p.evaluate(cost);
      if (clicks && view !== 'close') rec[view].hotspots = await p.evaluate(hotspots);
      await p.screenshot({ path: `${out}/${type}_${tag}_${view}.png` });
    }
    if (clicks) {
      // Back to the default view; click the flap control's lower half (one position down), then its upper half.
      await p.evaluate(look, [0, -25, 60]);
      await sleep(600);
      const f = await p.evaluate(flapSpot);
      if (f) {
        const flaps = () => p.evaluate(() => window.__sim.ctx.controls.flaps);
        const f0 = await flaps();
        await p.mouse.click(f[1][0], f[1][1]);
        await sleep(400);
        const f1 = await flaps();
        await p.mouse.click(f[0][0], f[0][1]);
        await sleep(400);
        rec.flapClick = { id: f[2], before: f0, afterDown: f1, afterUp: await flaps() };
      }
    }
    info[`${type}_${tag}`] = rec;
    console.log(type, tag, JSON.stringify(rec));
    await ctx.close();
  }
} finally {
  writeFileSync(infoPath, JSON.stringify(info, null, 1));
  await browser.close();
  await server.close();
}
