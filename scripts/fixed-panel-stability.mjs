#!/usr/bin/env node
// Usage: node scripts/fixed-panel-stability.mjs [aircraft=pc12] [outDir]
//   env VP=1366,768,1 (viewport width, height, device pixel ratio), FRAMES=40 (frames per window),
//   ANGLE=gl|vulkan (default: Chrome's own choice, as the owner runs it)
//
// Measures whether the gauge BODIES of the fixed 2D panel (src/ui/fixedPanel.ts) stay put, in the real app (headless
// Chrome): per measuring window of FRAMES consecutive frames it reads back the native panel canvas and the fixed
// canvas every frame, finds the source pixels that did not change during the window (bezels, dial faces, screws,
// labels: everything but needles, cards and digits), maps them through the fixed layout and requires the fixed-canvas
// pixels drawn only from them to be identical in every frame. A gauge that moves or jitters on the fixed panel changes
// those pixels; a needle cannot. Also checks that the canvas's CSS box and backing store do not change within a
// window, that the canvas sits on whole device pixels with a 1:1 backing store (no compositor resampling), and that a
// resize away and back reproduces the same image.
//
// Source integrity: every frame, no pixel of the native panel canvas may change outside the rectangles the panel
// redrew that frame (InstrumentPanel.upload.add). This is what the owner's recordings showed (2026-10-26): on Chrome's
// default Linux backend (ANGLE on OpenGL, Mesa radeonsi) drawing every gauge straight into the one large panel canvas
// put whole gauges at the wrong x, so a navcom or the cabin gauge slid 10-60 px sideways inside its fixed box. The
// body-pixel check above cannot see that (a moving source pixel counts as a needle), and the first version of this
// script forced ANGLE on Vulkan, where it does not happen. So Chrome runs with its default GPU backend here
// (ANGLE=vulkan or ANGLE=gl to force one).
//
// Windows: cruise in turbulence (Upper, entered with Shift+V), Lower (]), back to Upper, a resize round trip, Upper
// active from the saved preference at load, and the runway with power up (taxi). Prints per-window results, writes
// stability.json; exits 1 on any moving body pixel or geometry change.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import net from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readPng } from './lib/png.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const aircraft = process.argv[2] ?? 'pc12';
const out = process.argv[3] ?? `${root}/shots/fixed-panel-stability`;
mkdirSync(out, { recursive: true });
const [VW, VH, DPR] = (process.env.VP ?? '1366,768,1').split(',').map(Number);
const FRAMES = Number(process.env.FRAMES ?? 40);
const port = await new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null } });
await server.listen();
const angle = process.env.ANGLE === 'vulkan' ? ['--use-angle=vulkan', '--enable-features=Vulkan'] : process.env.ANGLE ? [`--use-angle=${process.env.ANGLE}`] : [];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', ...angle] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const failures = [];

/** In the page: one measuring window. Returns per-pane counts of body pixels that changed, and the geometry seen. */
async function measure(p, name, reference) {
  const r = await p.evaluate(async ({ frames, keepImage }) => {
    const fp = __sim.systems.ui.fixedPanel;
    const src = __sim.systems.panel.canvas;
    const fc = fp.canvas;
    const sec = fp.section;
    if (!sec) return { error: `no fixed section (panelView ${__sim.ctx.panelView})` };
    const SW = src.width, SH = src.height, W = fc.width, H = fc.height;
    const geometry = new Set();
    const geom = () => { const b = fc.getBoundingClientRect(); return JSON.stringify({ x: b.x, y: b.y, w: b.width, h: b.height, bw: fc.width, bh: fc.height, view: __sim.ctx.panelView, iw: innerWidth, ih: innerHeight }); };
    // Never read back the app's own canvases: repeated getImageData makes Chrome move a canvas off the GPU, whose
    // drawImage then filters differently (every static edge changes once). Copy 1:1 into probe-owned canvases.
    const copier = (c) => { const k = document.createElement('canvas'); k.width = c.width; k.height = c.height; const g = k.getContext('2d', { willReadFrequently: true }); return () => { g.globalCompositeOperation = 'copy'; g.drawImage(c, 0, 0); return g.getImageData(0, 0, k.width, k.height).data; }; };
    const readSource = copier(src), readFixed = copier(fc);
    const s0 = readSource(), f0 = readFixed();
    const sChanged = new Uint8Array(SW * SH), fChanged = new Uint8Array(W * H);
    const differs = (a, b, k, tol) => Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2]) > tol;
    // Source integrity: the rectangles the panel redraws each frame; nothing outside them may change.
    const panel = __sim.systems.panel;
    const redrawn = [];
    const add = panel.upload.add;
    panel.upload.add = function (r) { redrawn.push({ x: r.x, y: r.y, w: r.w, h: r.h }); return add.call(this, r); };
    const inRedrawn = new Uint8Array(SW * SH);
    const stray = { frames: 0, px: 0, box: null };
    let sPrev = s0;
    geometry.add(geom());
    try {
      for (let i = 0; i < frames; i++) {
        await new Promise((res) => requestAnimationFrame(res));
        geometry.add(geom());
        const s = readSource(), f = readFixed();
        inRedrawn.fill(0);
        for (const r of redrawn.splice(0)) {
          const x0 = Math.max(0, Math.floor(r.x) - 1), y0 = Math.max(0, Math.floor(r.y) - 1), x1 = Math.min(SW, Math.ceil(r.x + r.w) + 1), y1 = Math.min(SH, Math.ceil(r.y + r.h) + 1);
          for (let y = y0; y < y1; y++) inRedrawn.fill(1, y * SW + x0, y * SW + x1);
        }
        let n = 0;
        for (let j = 0, k = 0; j < SW * SH; j++, k += 4) {
          if (!sChanged[j] && differs(s, s0, k, 0)) sChanged[j] = 1;
          if (!inRedrawn[j] && differs(s, sPrev, k, 6)) {
            n++;
            const x = j % SW, y = (j / SW) | 0, b = stray.box ??= [x, y, x, y];
            b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
          }
        }
        if (n) { stray.frames++; stray.px += n; }
        sPrev = s;
        for (let j = 0, k = 0; j < W * H; j++, k += 4) if (!fChanged[j] && differs(f, f0, k, 6)) fChanged[j] = 1;
      }
    } finally {
      panel.upload.add = add;
    }
    // A fixed pixel is "body" when every source pixel within 2 px of its footprint stayed unchanged.
    const sx = W / sec.size.w, sy = H / sec.size.h;
    const panes = sec.panes.map((pn) => ({ ...pn, moved: 0, body: 0 }));
    // Map for inspection: red = a body pixel that changed, green tint = body pixel, grey = the rest (last frame).
    const map = new ImageData(W, H);
    const last = readFixed();
    for (let k = 0; k < W * H * 4; k += 4) { const v = (last[k] + last[k + 1] + last[k + 2]) / 6; map.data[k] = map.data[k + 1] = map.data[k + 2] = v; map.data[k + 3] = 255; }
    for (const pn of panes) {
      const { source: s, target: t } = pn;
      const X0 = Math.ceil(t.x * sx), X1 = Math.floor((t.x + t.w) * sx), Y0 = Math.ceil(t.y * sy), Y1 = Math.floor((t.y + t.h) * sy);
      for (let Y = Y0; Y < Y1; Y++) for (let X = X0; X < X1; X++) {
        const ux = s.x + X / sx - t.x, uy = s.y + Y / sy - t.y;
        let stat = true;
        for (let yy = Math.floor(uy - 2); stat && yy <= Math.ceil(uy + 1 / sy + 2); yy++) for (let xx = Math.floor(ux - 2); xx <= Math.ceil(ux + 1 / sx + 2); xx++) {
          if (xx < s.x || yy < s.y || xx >= s.x + s.w || yy >= s.y + s.h || sChanged[yy * SW + xx]) { stat = false; break; }
        }
        if (!stat) continue;
        pn.body++;
        const k = (Y * W + X) * 4;
        if (fChanged[Y * W + X]) { pn.moved++; map.data[k] = 255; map.data[k + 1] = 0; map.data[k + 2] = 0; } else map.data[k + 1] += 40;
      }
    }
    const b = fc.getBoundingClientRect(), dpr = devicePixelRatio;
    // Layout works in 1/64 CSS px, so a box on whole device pixels at DPR 1.5 can read up to ~0.02 device px off.
    // The canvas hangs from the bottom of the window (whose emulated height can be a fractional number of device
    // pixels), so its top is checked as "bottom edge on the window's bottom", the rest as whole device pixels.
    const whole = (v) => Math.abs(v * dpr - Math.round(v * dpr)) < 0.05;
    const snapped = whole(b.x) && whole(b.width) && whole(b.height) && Math.abs(b.bottom - fc.closest('#fsui').getBoundingClientRect().bottom) < 0.05
      && Math.round(b.width * dpr) === W && Math.round(b.height * dpr) === H;
    return {
      geometry: [...geometry],
      snapped,
      stray,
      panes: panes.map((pn) => ({ at: [pn.source.x, pn.source.y, pn.source.w, pn.source.h], body: pn.body, moved: pn.moved })),
      image: keepImage ? fc.toDataURL() : null,
      compass: sec.compass ? [sec.compass.x * sx, sec.compass.y * sy, (sec.compass.x + sec.compass.w) * sx, (sec.compass.y + sec.compass.h) * sy] : null,
      map: (() => { const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').putImageData(map, 0, 0); return c.toDataURL(); })(),
    };
  }, { frames: FRAMES, keepImage: true });
  if (r.error) { failures.push(`${name}: ${r.error}`); console.log(name, r.error); return null; }
  writeFileSync(`${out}/${results.length}-map.png`, Buffer.from(r.map.split(',')[1], 'base64'));
  const moving = r.panes.filter((x) => x.moved > 0);
  const row = { name, geometry: r.geometry, snapped: r.snapped, bodyPixels: r.panes.reduce((a, x) => a + x.body, 0), moving, stray: r.stray };
  if (reference) {
    // Same image up to GPU rounding (a channel off by a few levels): no pixel may differ by more than 6 in R+G+B.
    // The magnetic compass is left out: its float keeps settling while the simulation is paused.
    for (const [n, u] of [['before', reference], ['after', r.image]]) writeFileSync(`${out}/roundtrip-${n}.png`, Buffer.from(u.split(',')[1], 'base64'));
    const [a, b] = ['before', 'after'].map((n) => readPng(`${out}/roundtrip-${n}.png`));
    let differing = a.width === b.width && a.height === b.height ? 0 : Infinity;
    const [cx0, cy0, cx1, cy1] = r.compass ?? [0, 0, -1, -1];
    for (let k = 0; differing !== Infinity && k < a.data.length; k += 4) {
      const x = (k / 4) % a.width, y = Math.floor(k / 4 / a.width);
      if (x >= cx0 - 2 && x <= cx1 + 2 && y >= cy0 - 2 && y <= cy1 + 2) continue;
      if (Math.abs(a.data[k] - b.data[k]) + Math.abs(a.data[k + 1] - b.data[k + 1]) + Math.abs(a.data[k + 2] - b.data[k + 2]) > 6) differing++;
    }
    row.sameAsBefore = differing === 0;
    row.roundTripDifferingPx = differing;
  }
  results.push(row);
  console.log(`${name}: ${row.bodyPixels} body px, ${moving.length ? `MOVING ${JSON.stringify(moving)}` : 'no body pixel changed'}; geometry ${r.geometry.length === 1 ? 'constant' : `CHANGED ${r.geometry.join(' -> ')}`}; whole device pixels ${r.snapped}; source changed outside redrawn rects ${r.stray.px ? `IN ${r.stray.frames}/${FRAMES} FRAMES (${r.stray.px} px, box ${r.stray.box})` : 'never'}${reference ? `; identical after the round trip ${row.sameAsBefore}` : ''}`);
  if (r.stray.px) failures.push(`${name}: the native panel canvas changed outside the redrawn rectangles in ${r.stray.frames} frames (${r.stray.px} px within ${r.stray.box}): gauges drawn in the wrong place`);
  if (moving.length) failures.push(`${name}: gauge bodies changed ${JSON.stringify(moving)}`);
  if (r.geometry.length !== 1) failures.push(`${name}: canvas geometry changed within the window`);
  if (!r.snapped) failures.push(`${name}: canvas not on whole device pixels / backing store not 1:1 (${r.geometry[0]})`);
  if (reference && !row.sameAsBefore) failures.push(`${name}: the image differs after a resize round trip`);
  return r.image;
}

async function open(query, savedView = null) {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR });
  if (savedView) await ctx.addInitScript((v) => localStorage.setItem('fs.panelView', v), savedView);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => failures.push(`page error: ${e}`));
  await p.goto(`http://127.0.0.1:${port}/index.html?aircraft=${aircraft}&${query}&cam=cockpit&mute=1`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await p.mouse.click(VW / 2, 80).catch(() => {});
  await sleep(300);
  return { ctx, p };
}

try {
  {
    const { ctx, p } = await open('scenario=cruise&turb=0.6');
    // The owner's path: Shift+V from the 3D cockpit, then ] through the sections.
    await p.keyboard.press('Shift+KeyV');
    await sleep(800);
    await measure(p, `cruise turb 0.6, ${await p.evaluate(() => __sim.ctx.panelView)} (Shift+V)`);
    await p.keyboard.press('BracketRight');
    await sleep(800);
    await measure(p, `cruise turb 0.6, ${await p.evaluate(() => __sim.ctx.panelView)} (])`);
    await p.keyboard.press('BracketRight'); await sleep(300);
    await p.keyboard.press('BracketRight'); await sleep(800);
    // Freeze the instruments for the round trip so the before/after images can be compared exactly.
    await p.evaluate(() => { __sim.ctx.paused = true; });
    await sleep(500);
    const before = await measure(p, `paused, ${await p.evaluate(() => __sim.ctx.panelView)} before resize`);
    for (const [w, h] of [[Math.round(VW * 0.8), Math.round(VH * 0.9)], [VW + 37, VH - 21], [VW, VH]]) {
      await p.setViewportSize({ width: w, height: h });
      await sleep(400);
    }
    await measure(p, 'paused, after a resize round trip', before);
    await p.evaluate(() => { __sim.ctx.paused = false; });
    await p.setViewportSize({ width: Math.round(VW * 0.77), height: Math.round(VH * 0.83) });
    await sleep(600);
    await measure(p, `cruise turb 0.6 at ${Math.round(VW * 0.77)}x${Math.round(VH * 0.83)}`);
    await ctx.close();
  }
  {
    // The usual load: the fixed view saved from the last session is active from the first frame.
    const { ctx, p } = await open('scenario=cruise&turb=0.6', 'upper');
    const m = await p.evaluate(() => { const fp = __sim.systems.ui.fixedPanel; return { view: __sim.ctx.panelView, fitTop: fp.fit?.top, top: fp.top, rectTop: fp.canvas.getBoundingClientRect().top }; });
    console.log(`saved preference: ${JSON.stringify(m)}`);
    if (m.view !== 'upper' || !(m.top > 0) || Math.abs(m.fitTop - m.rectTop) > 0.05) failures.push(`saved preference: the mouse mapping's top does not match the canvas ${JSON.stringify(m)}`);
    await measure(p, 'cruise turb 0.6, upper from the saved preference');
    await ctx.close();
  }
  {
    const { ctx, p } = await open('scenario=runway');
    await p.evaluate(() => __sim.ctx.commands.setPanelView('lower'));
    await p.keyboard.down('F2'); await sleep(1500); await p.keyboard.up('F2');
    await measure(p, 'runway, power up (taxi), lower');
    await p.evaluate(() => __sim.ctx.commands.setPanelView('upper'));
    await sleep(500);
    await measure(p, 'runway, power up (taxi), upper');
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}
writeFileSync(`${out}/stability.json`, JSON.stringify({ aircraft, viewport: [VW, VH, DPR], frames: FRAMES, results, failures }, null, 2));
if (failures.length) {
  console.log(`FAIL (${failures.length}):\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('PASS: every gauge body was pixel-stable');
