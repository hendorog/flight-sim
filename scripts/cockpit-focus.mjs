#!/usr/bin/env node
// Usage: node scripts/cockpit-focus.mjs [--types c172s,r44] [--out dir] [--dpr 1.5] [--quality high] [--shots 1]
//          [--views normal,focus] [--perf ms] [--params "dpr=1.25"] [--setup "<js run in the page first>"]
//          [--override '{"c172s":{"yawDeg":0,"pitchDeg":-20,"fovDeg":44}}']   (a trial focus view per type)
// The 3D cockpit at the owner's window (1920 x 991 CSS px, devicePixelRatio 1.5) on the runway at noon: for each type the
// default view and the instrument focus view (the Q key, then Q again to check it restores), a screenshot of each, and
// in each view: the on-screen size of the main dials (px: a 3-1/8 in span across the dial centre, projected from the 3D
// panel face through the camera, CSS px; casePx: the gauge's whole canvas rectangle), where the horizon ahead is (fraction
// of the frame height from the top), and per column the fraction of rows that see out (a CPU raycast against the opaque
// cockpit meshes; no GPU readback). --perf ms: rAF frame time and the GPU time of the post pipeline's frame
// (EXT_disjoint_timer_query_webgl2), with the WebGL renderer string so a software fallback shows. Writes focus.json.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const types = flag('types', 'c172s,c152,pa38,da20,pa34,c208,pc12,r22,r44,s269,md500,bo105,ah56').split(',');
const out = resolve(flag('out', `${root}/shots/cockpit-focus`));
const dpr = Number(flag('dpr', '1.5'));
const quality = flag('quality', 'high');
const shots = flag('shots', '1') === '1';
const views = flag('views', 'normal,focus').split(',');
const perfMs = Number(flag('perf', '0'));
const extra = flag('params', '');
const override = JSON.parse(flag('override', '{}'));
// --setup: JS run in the page before measuring (a trial default pitch: "const r=__sim.sim.systems.cameras.cockpit; r.defaultPitch=-0.4; r.recentre()").
const setup = flag('setup', '');
mkdirSync(out, { recursive: true });

const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, optimizeDeps: { holdUntilCrawlEnd: true } });
await server.listen();
const port = server.httpServer.address().port;
const gpuArgs = ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-webgl'];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: perfMs > 0 ? [...gpuArgs, '--disable-gpu-vsync', '--disable-frame-rate-limit'] : gpuArgs });
const results = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** In the page: dial sizes and the outside fraction of the current view. */
function measure() {
  const sim = window.__sim.sim;
  const ctx = window.__sim.ctx;
  const THREE = window.__THREE;
  const cam = ctx.camera;
  cam.updateMatrixWorld();
  let mesh = null;
  ctx.aircraftRoot.traverse((o) => { if (o.isMesh && o.name === 'instrumentPanel' && !mesh) mesh = o; });
  const panel = sim.systems.panel;
  const def = panel.def;
  const W = def.size.w, H = def.size.h;
  const geo = mesh.geometry, pos = geo.getAttribute('position'), uv = geo.getAttribute('uv');
  // Affine uv -> local basis from the best-conditioned triangle (instruments/panelProjection.ts).
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
  const vw = window.innerWidth, vh = window.innerHeight;
  const screen = (p) => { const s = p.clone().project(cam); return [(s.x + 1) / 2 * vw, (1 - s.y) / 2 * vh]; };
  // FRD of a canvas point: world -> aircraft root local (three model space x right, y up, z aft) -> FRD.
  const inv = new THREE.Matrix4().copy(ctx.aircraftRoot.matrixWorld).invert();
  const frd = (p) => { const l = p.clone().applyMatrix4(inv); return [-l.z, l.x, -l.y].map((v) => +v.toFixed(3)); };
  const MAIN = ['attitude', 'asi', 'altimeter', 'heading', 'hsi', 'vsi', 'turn', 'tach', 'rotorTach', 'rmi', 'customRound'];
  const dials = [];
  for (const g of def.gauges) {
    if (!MAIN.includes(g.kind)) continue;
    const r = panel.regions.get(g.id);
    if (!r) continue;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const l = screen(world(r.x, cy)), rr = screen(world(r.x + r.w, cy)), ctr = screen(world(cx, cy));
    // A 3-1/8 in (0.0794 m) span across the dial centre, whatever the gauge's own size.
    const half = (0.0794 / 2) / (du.length() * mesh.matrixWorld.getMaxScaleOnAxis() / W);
    const a8 = screen(world(cx - half, cy)), b8 = screen(world(cx + half, cy));
    dials.push({ id: g.id, kind: g.kind, canvasW: r.w, casePx: +Math.hypot(rr[0] - l[0], rr[1] - l[1]).toFixed(1), px: +Math.hypot(b8[0] - a8[0], b8[1] - a8[1]).toFixed(1), at: ctr.map((v) => Math.round(v)), frd: frd(world(cx, cy)) });
  }
  // Outside fraction at the centre column and a third of the way in from each side: the topmost row whose ray hits an
  // opaque cockpit mesh (not glass).
  const ray = new THREE.Raycaster(); ray.near = 0.02; ray.far = 6;
  const opaque = [];
  ctx.aircraftRoot.traverse((m) => {
    // The cabin lining is one mesh whose window openings are cut in its shader: not a sight-line blocker here.
    if (!m.isMesh || !m.visible || m.name === 'cabinLining') return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.every((x) => x.transparent || x.opacity < 1 || x.visible === false)) return;
    opaque.push(m);
  });
  // Per column: the fraction of rows that see out (no opaque hit), and the lowest such row (the bottom of the
  // windscreen view, as a fraction of the frame height from the top).
  const outside = [], outsideBottom = [];
  for (const nx of [-0.33, 0, 0.33]) {
    let n = 0, bottom = 0;
    for (let k = 0; k <= 200; k++) {
      const ny = 1 - (2 * k) / 200;
      ray.setFromCamera(new THREE.Vector2(nx, ny), cam);
      if (ray.intersectObjects(opaque, false).length === 0) { n++; bottom = k / 200; }
    }
    outside.push(+(n / 201).toFixed(3));
    outsideBottom.push(+bottom.toFixed(3));
  }
  const glance = sim.systems.cameras;
  // The horizon straight ahead of the aircraft (level, along its heading) as a fraction of the frame height from the top.
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(ctx.aircraftRoot.getWorldQuaternion(new THREE.Quaternion())); fwd.y = 0; fwd.normalize();
  const hz = cam.getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, 5000).project(cam);
  const horizon = +((1 - hz.y) / 2).toFixed(3);
  return { fov: +cam.fov.toFixed(2), focused: glance.focused, horizon, dials, outside, outsideBottom, eye: frd(cam.getWorldPosition(new THREE.Vector3())) };
}

/** GPU time of the post pipeline's frame (scene + passes; EXT_disjoint_timer_query_webgl2), ms, over `ms` of frames. */
async function gpuTimes(p, ms) {
  return p.evaluate(async (ms) => {
    const sim = window.__sim, gl = sim.ctx.renderer.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) return null;
    const post = sim.post, orig = post.render, queries = [], out = [];
    post.render = function (...a) {
      const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      try { return orig.apply(this, a); } finally { gl.endQuery(ext.TIME_ELAPSED_EXT); queries.push(q); }
    };
    await new Promise((done) => { const t0 = performance.now(); const tick = () => (performance.now() - t0 < ms ? requestAnimationFrame(tick) : done()); requestAnimationFrame(tick); });
    post.render = orig;
    for (let tries = 0; tries < 100 && queries.length; tries++) {
      while (queries.length && gl.getQueryParameter(queries[0], gl.QUERY_RESULT_AVAILABLE)) {
        const q = queries.shift();
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) out.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(q);
      }
      if (queries.length) await new Promise((r) => setTimeout(r, 20));
    }
    return out;
  }, ms);
}

async function frameTimes(p, ms) {
  return p.evaluate((ms) => new Promise((res) => {
    const t = []; let last = performance.now(); const t0 = last;
    const tick = () => { const n = performance.now(); t.push(n - last); last = n; if (n - t0 < ms) requestAnimationFrame(tick); else res(t); };
    requestAnimationFrame(tick);
  }), ms);
}

try {
  for (const type of types) {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 991 }, deviceScaleFactor: dpr });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(`http://127.0.0.1:${port}/index.html?aircraft=${type}&scenario=runway&cam=cockpit&mute=1&quality=${quality}&tod=12&resume=0${extra ? '&' + extra : ''}`, { waitUntil: 'load', timeout: 180000 });
    await p.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
    await p.evaluate(async () => { window.__THREE = await import('/node_modules/three/build/three.module.js'); });
    if (override[type]) {
      await p.evaluate(([f]) => {
        const cams = window.__sim.sim.systems.cameras;
        cams.cockpit.focusView = { yaw: f.yawDeg * Math.PI / 180, pitch: f.pitchDeg * Math.PI / 180, fov: f.fovDeg };
      }, [override[type]]);
    }
    if (setup) await p.evaluate(setup);
    await sleep(2500);
    const r = { type, renderer: await p.evaluate(() => { const gl = window.__sim.ctx.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; }),
      pixelRatio: await p.evaluate(() => window.__sim.ctx.renderer.getPixelRatio()),
      anisotropy: await p.evaluate(() => [window.__sim.sim.systems.panel.texture.anisotropy, window.__sim.ctx.renderer.capabilities.getMaxAnisotropy()]) };
    for (const view of views) {
      if (view === 'focus') { await p.keyboard.press('KeyQ'); await sleep(900); }
      r[view] = await p.evaluate(measure);
      if (shots) await p.screenshot({ path: `${out}/${type}_${view}.png` });
      if (perfMs > 0) {
        await frameTimes(p, 1000);
        const t = (await frameTimes(p, perfMs)).sort((x, y) => x - y);
        r[view].frameMs = { median: +t[Math.floor(t.length / 2)].toFixed(2), p95: +t[Math.floor(t.length * 0.95)].toFixed(2), frames: t.length };
        const g = (await gpuTimes(p, perfMs))?.sort((x, y) => x - y);
        if (g?.length) r[view].gpuMs = { median: +g[Math.floor(g.length / 2)].toFixed(2), p90: +g[Math.floor(g.length * 0.9)].toFixed(2), n: g.length };
      }
      if (view === 'focus') { await p.keyboard.press('KeyQ'); await sleep(900); r.restored = await p.evaluate(() => ({ fov: +window.__sim.ctx.camera.fov.toFixed(3), focused: window.__sim.sim.systems.cameras.focused })); }
    }
    r.errors = errs;
    results[type] = r;
    const brief = (v) => v && `fov ${v.fov} horizon ${v.horizon} outside ${v.outside.join('/')} bottom ${v.outsideBottom.join('/')} dials ${v.dials.map((d) => `${d.id}:${d.px}`).join(' ')}${v.frameMs ? ` frame ${v.frameMs.median}/${v.frameMs.p95} ms` : ''}${v.gpuMs ? ` gpu ${v.gpuMs.median}/${v.gpuMs.p90} ms (${v.gpuMs.n})` : ''}`;
    console.log(`${type} [${r.renderer.slice(0, 40)}] pr ${r.pixelRatio} aniso ${r.anisotropy.join('/')}`);
    for (const v of views) console.log(`  ${v}: ${brief(r[v])}`);
    if (errs.length) console.log('  errors:', errs.slice(0, 3));
    await ctx.close();
  }
} finally {
  writeFileSync(`${out}/focus.json`, JSON.stringify(results, null, 1));
  await browser.close();
  await server.close();
}
