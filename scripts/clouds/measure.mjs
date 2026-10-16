#!/usr/bin/env node
// Cloud artefact measurement: flies the dev cloud page with a fixed time step and reports
//   flicker  mean |F(k) - (F(k-1) + F(k+1)) / 2| over a run of moving frames (shimmer; linear motion cancels)
//   grain    RMS of (last moving frame - the same view after 150 still frames) (noise/smear while moving)
// and writes <out>-<scenario>-{moving,still,flicker}.png.
//   node scripts/clouds/measure.mjs <outPrefix> [scenario,...]
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [outPrefix = 'work/m', only] = process.argv.slice(2);
const W = +(process.env.W ?? 960), H = +(process.env.H ?? 540);

export const SCENARIOS = {
  // Under the base, flying toward the clouds ahead and above.
  base: 'cam=0,0,1350&look=3000,0,1700&fly=60&wind=0,0',
  // Level with the layer, close to cloud flanks, flying through gaps.
  close: 'cam=0,0,1900&look=3000,400,1950&fly=60&wind=0,0',
  // Above the tops, looking down across the turrets.
  tops: 'cam=0,0,3300&look=3000,0,2600&fly=60&wind=0,0',
  // Distant view, turning.
  far: 'cam=0,0,600&look=4000,0,1800&yaw=4&wind=0,0',
  // Skimming just over the turrets, as the sim's cruise above a low layer.
  skim: 'cam=0,0,2950&look=3000,0,2750&fly=60&wind=0,0',
  // Flying through cloud.
  inside: 'cam=0,0,1900&look=3000,0,1900&fly=60&wind=0,0&cover=1',
  // Inside a broken layer, wisps and flanks tens of metres away.
  broken: 'cam=0,0,2100&look=3000,0,2150&fly=60&wind=0,0&cover=0.6',
};

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.once('error', rej);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
});
const port = await freePort();
const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null }, optimizeDeps: { holdUntilCrawlEnd: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-webgl', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
mkdirSync(dirname(resolve(outPrefix)), { recursive: true });
const results = {};
try {
  for (const [name, q] of Object.entries(SCENARIOS)) {
    if (only && !only.split(',').includes(name)) continue;
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') console.log(`[console] ${m.text()}`); });
    await p.goto(`http://127.0.0.1:${port}/dev/clouds.html?${q.replace("wind=0,0", "wind=" + (process.env.WIND ?? "0,0"))}&step=0.016667&q=${process.env.Q ?? 'high'}&${process.env.EXTRA ?? ''}`, { waitUntil: 'load' });
    await p.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
    const r = await p.evaluate(async () => {
      const d = window.__cloudsDev, ctx = window.__ctx, cam = ctx.camera;
      const N = 16, SETTLE = 64;
      await d.frames(60);
      const lumOf = (gl) => {
        const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const lum = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) lum[i] = (px[i * 4] * 54 + px[i * 4 + 1] * 183 + px[i * 4 + 2] * 19) >> 8;
        return lum;
      };
      const M = [], poses = [];
      let movingPng = null;
      await new Promise((res) => d.pending.push((gl) => {
        M.push(lumOf(gl));
        poses.push([cam.position.clone(), cam.quaternion.clone(), ctx.simTime, d.getDrift()]);
        if (M.length === N / 2) movingPng = gl.canvas.toDataURL('image/png');
        if (M.length < N) return false;
        res(); return true;
      }));
      d.moving = false;
      const R = [], S1 = [];
      let stillPng = null;
      for (let k = 0; k < N; k++) {
        cam.position.copy(poses[k][0]); cam.quaternion.copy(poses[k][1]); ctx.simTime = poses[k][2]; d.setDrift(poses[k][3]);
        cam.updateMatrixWorld(true);
        await d.frames(SETTLE);
        const acc = new Float32Array(M[0].length);
        let still1 = null;
        await new Promise((res) => { let c = 0; d.pending.push((gl) => { const l = lumOf(gl); if (!still1) still1 = l; for (let i = 0; i < l.length; i++) acc[i] += l[i] / 16; if (k === N / 2 && c === 0) stillPng = gl.canvas.toDataURL('image/png'); if (++c < 16) return false; res(); return true; }); });
        R.push(acc); S1.push(still1);
      }
      const n = M[0].length;
      const flick = (F) => { let s = 0; for (let k = 1; k < F.length - 1; k++) for (let i = 0; i < n; i++) s += Math.abs(F[k][i] - 0.5 * (F[k - 1][i] + F[k + 1][i])); return s / (n * (F.length - 2)); };
      let err = 0, err2 = 0;
      const map = new Float32Array(n);
      for (let k = 0; k < N; k++) for (let i = 0; i < n; i++) { const e = M[k][i] - R[k][i]; err += Math.abs(e); err2 += e * e; map[i] += Math.abs(e); }
      // Temporal error: the part of the error that changes from frame to frame (shimmer), as opposed to a steady offset (smear).
      let terr = 0;
      for (let k = 1; k < N; k++) for (let i = 0; i < n; i++) terr += Math.abs((M[k][i] - R[k][i]) - (M[k - 1][i] - R[k - 1][i]));
      const w = cam && document.querySelector('canvas').width, h = document.querySelector('canvas').height;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const c2 = c.getContext('2d'); const img = c2.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = Math.min(255, (map[(h - 1 - y) * w + x] / N) * 12);
        const o = (y * w + x) * 4; img.data[o] = v; img.data[o + 1] = v; img.data[o + 2] = v; img.data[o + 3] = 255;
      }
      c2.putImageData(img, 0, 0);
      let serr = 0; for (let k = 0; k < N; k++) for (let i = 0; i < n; i++) serr += Math.abs(S1[k][i] - R[k][i]);
      return { stillErr: serr / (n * N), flicker: flick(M), flickerRef: flick(R), err: err / (n * N), rms: Math.sqrt(err2 / (n * N)), terr: terr / (n * (N - 1)), moving: movingPng, still: stillPng, flickerPng: c.toDataURL('image/png') };
    });
    for (const k of ['moving', 'still']) writeFileSync(`${outPrefix}-${name}-${k}.png`, Buffer.from(r[k].split(',')[1], 'base64'));
    writeFileSync(`${outPrefix}-${name}-flicker.png`, Buffer.from(r.flickerPng.split(',')[1], 'base64'));
    results[name] = Object.fromEntries(['terr', 'err', 'rms', 'stillErr', 'flicker', 'flickerRef'].map((k) => [k, +r[k].toFixed(3)]));
    console.log(name, JSON.stringify(results[name]));
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}
