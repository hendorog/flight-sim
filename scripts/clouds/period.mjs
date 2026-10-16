#!/usr/bin/env node
// Cloud flicker spectrum: grabs N (64) consecutive moving frames of one dev cloud scenario at a fixed time step
// and reports how the frame-to-frame luminance change is spread over temporal frequency, to look for
// periodic pulsing (a peak) as opposed to broadband shimmer.
//   node scripts/clouds/period.mjs <outPrefix> [scenario]   env: N, Q, EXTRA (scenarios as in measure.mjs)
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

const N = +(process.env.N ?? 64);
try {
  const q = SCENARIOS[only ?? 'close'];
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await p.goto(`http://127.0.0.1:${port}/dev/clouds.html?${q}&step=0.016667&q=${process.env.Q ?? 'high'}&${process.env.EXTRA ?? ''}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  const r = await p.evaluate(async (N) => {
    const d = window.__cloudsDev;
    await d.frames(60);
    const F = [], pngs = [];
    await new Promise((res) => d.pending.push((gl) => {
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const lum = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) lum[i] = (px[i * 4] * 54 + px[i * 4 + 1] * 183 + px[i * 4 + 2] * 19) / 256;
      F.push(lum);
      if (F.length <= 8) pngs.push(gl.canvas.toDataURL('image/png'));
      if (F.length < N) return false;
      res(); return true;
    }));
    // Spectrum of the second-difference residual, averaged over pixels.
    const n = F[0].length, K = N - 2, spec = new Float64Array(K / 2 + 1);
    const res = new Float32Array(K);
    for (let i = 0; i < n; i += 7) {
      let e = 0;
      for (let k = 0; k < K; k++) { res[k] = F[k + 1][i] - 0.5 * (F[k][i] + F[k + 2][i]); e += Math.abs(res[k]); }
      if (e / K < 0.5) continue;
      for (let f = 1; f <= K / 2; f++) {
        let re = 0, im = 0;
        for (let k = 0; k < K; k++) { const a = 2 * Math.PI * f * k / K; re += res[k] * Math.cos(a); im += res[k] * Math.sin(a); }
        spec[f] += re * re + im * im;
      }
    }
    return { spec: Array.from(spec), pngs };
  }, N);
  const tot = r.spec.reduce((a, b) => a + b, 0);
  const K = N - 2;
  console.log(r.spec.map((v, f) => f ? `${(K / f).toFixed(1)}f:${(100 * v / tot).toFixed(1)}` : '').filter(Boolean).join(' '));
  r.pngs.forEach((u, i) => writeFileSync(`${outPrefix}-f${i}.png`, Buffer.from(u.split(',')[1], 'base64')));
  await ctx.close();
} finally {
  await browser.close();
  await server.close();
}
