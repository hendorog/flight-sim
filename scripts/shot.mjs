#!/usr/bin/env node
// Render a page of this project in headless Chrome (GPU accelerated) and save a screenshot.
//
//   node scripts/shot.mjs <page-and-query> <out.png> [--w 1600] [--h 900] [--wait 1500] [--timeout 60000]
//                         [--eval "js expression"] [--keys "KeyW,Space"] [--fps] [--cpu-throttle 4]
//
//   <page-and-query>  e.g. "dev/terrain.html?cam=0,0,900&look=3000,0,100" or "index.html?scenario=cruise"
//   --wait            extra milliseconds to let the scene settle after window.__ready becomes true
//   --eval            JavaScript evaluated in the page after ready (before the extra wait); its result is printed
//   --keys            comma-separated KeyboardEvent codes to press after ready
//   --fps             measure frame time over --frames N (120) frames: drained CPU+GPU throughput, rAF interval
//                     (overstates speed without vsync), and GPU time of the post pipeline (timer queries)
//   --cpu-throttle    slow the page's CPU down by this factor (DevTools CPU throttling), e.g. 4 for a slow laptop
//
// Starts a private vite dev server on a free port, so several invocations can run at once.
// Prints browser console errors and page errors; exits non-zero if the page never became ready.

import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const positional = [];
const flags = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const key = argv[i].slice(2);
    if (key === 'fps') flags.fps = true;
    else flags[key] = argv[++i];
  } else positional.push(argv[i]);
}
if (positional.length < 2) {
  console.error('usage: node scripts/shot.mjs <page-and-query> <out.png> [--w N] [--h N] [--wait ms] [--eval js] [--keys codes] [--fps] [--cpu-throttle N]');
  process.exit(2);
}
const [page, out] = positional;
const width = Number(flags.w ?? 1600);
const height = Number(flags.h ?? 900);
const wait = Number(flags.wait ?? 1500);
const timeout = Number(flags.timeout ?? 60000);
const cpuThrottle = flags['cpu-throttle'] === undefined ? 1 : Number(flags['cpu-throttle']);
if (!(cpuThrottle >= 1)) {
  console.error('--cpu-throttle wants a factor of 1 or more');
  process.exit(2);
}

const freePort = () =>
  new Promise((res, rej) => {
    const srv = net.createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });

const port = await freePort();
const server = await createServer({
  root,
  logLevel: 'error',
  server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null },
  optimizeDeps: { holdUntilCrawlEnd: true },
});
await server.listen();

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--use-angle=vulkan',
    '--enable-features=Vulkan',
    '--enable-webgl',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-gpu-vsync',
    '--disable-frame-rate-limit',
  ],
});

let exitCode = 0;
try {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('console', (m) => {
    if (flags.fps && /GPU stall due to ReadPixels/.test(m.text())) return; // the --fps drain itself
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}] ${m.text()}`);
  });
  p.on('pageerror', (e) => console.log(`[pageerror] ${e.stack ?? e.message}`));
  if (cpuThrottle > 1) {
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
    console.log(`[shot] CPU throttled ${cpuThrottle}x`);
  }
  await p.goto(`http://127.0.0.1:${port}/${page.replace(/^\//, '')}`, { waitUntil: 'load', timeout });
  try {
    await p.waitForFunction(() => window.__ready === true, null, { timeout });
  } catch {
    console.log('[shot] page never set window.__ready; capturing anyway');
    exitCode = 1;
  }
  if (flags.keys) for (const code of flags.keys.split(',')) await p.keyboard.press(code.trim());
  if (flags.eval) console.log('[eval]', JSON.stringify(await p.evaluate(flags.eval)));
  await p.waitForTimeout(wait);
  if (flags.fps) {
    // rAF alone overstates throughput 2-5x here: with --disable-gpu-vsync --disable-frame-rate-limit the
    // browser does not back-pressure rAF on the GPU, so frames queue up. Instead: drain the GPU with a
    // readPixels, time N frames, drain again (the true CPU+GPU throughput), and time the post pipeline's
    // render (scene + every pass) on the GPU with EXT_disjoint_timer_query_webgl2.
    const r = await p.evaluate(
      (n) =>
        new Promise((res) => {
          const sim = window.__sim;
          const gl = sim?.ctx?.renderer?.getContext?.() ?? document.querySelector('canvas')?.getContext('webgl2');
          const ext = gl?.getExtension('EXT_disjoint_timer_query_webgl2');
          const px = new Uint8Array(4);
          const drain = () => gl?.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          const post = sim?.post;
          const orig = post?.render;
          const queries = [];
          if (ext && post && orig) {
            post.render = function (...a) {
              const q = gl.createQuery();
              gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
              try {
                return orig.apply(this, a);
              } finally {
                gl.endQuery(ext.TIME_ELAPSED_EXT);
                queries.push(q);
              }
            };
          }
          let k = 0;
          let t0 = 0;
          let rafFirst = 0;
          let rafLast = 0;
          const tick = (t) => {
            if (k === 0) {
              drain();
              t0 = performance.now();
              rafFirst = t;
            }
            rafLast = t;
            if (++k <= n) return requestAnimationFrame(tick);
            drain();
            const throughput = (performance.now() - t0) / n;
            if (post && orig) post.render = orig;
            const gpu = [];
            const collect = (tries) => {
              while (queries.length && gl.getQueryParameter(queries[0], gl.QUERY_RESULT_AVAILABLE)) {
                const q = queries.shift();
                if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
                gl.deleteQuery(q);
              }
              if (queries.length && tries > 0) return setTimeout(() => collect(tries - 1), 20);
              gpu.sort((a, b) => a - b);
              const pct = (f) => (gpu.length ? gpu[Math.min(gpu.length - 1, Math.floor(f * gpu.length))] : NaN);
              res({ throughput, raf: (rafLast - rafFirst) / n, gpuP10: pct(0.1), gpuP50: pct(0.5), gpuN: gpu.length });
            };
            collect(100);
          };
          requestAnimationFrame(tick);
        }),
      Number(flags.frames ?? 120),
    );
    console.log(`[fps] ${r.throughput.toFixed(2)} ms/frame (${(1000 / r.throughput).toFixed(1)} fps, drained throughput) at ${width}x${height}; rAF interval ${r.raf.toFixed(2)} ms`);
    if (r.gpuN) console.log(`[gpu] post pipeline (scene + passes) p10 ${r.gpuP10.toFixed(2)} ms, p50 ${r.gpuP50.toFixed(2)} ms over ${r.gpuN} frames`);
  }
  const gl = await p.evaluate(() => {
    const c = document.createElement('canvas').getContext('webgl2');
    const ext = c?.getExtension('WEBGL_debug_renderer_info');
    return c && ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'no webgl2';
  });
  console.log(`[gl] ${gl}`);
  mkdirSync(dirname(resolve(out)), { recursive: true });
  await p.screenshot({ path: resolve(out) });
  console.log(`[shot] wrote ${resolve(out)}`);
} finally {
  await browser.close();
  await server.close();
}
process.exit(exitCode);
