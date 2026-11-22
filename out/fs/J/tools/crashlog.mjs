// crashlog.mjs ROOT QUERY: load index.html?QUERY from ROOT (vite on V2_PORT) in headless Chrome, print every console
// message (page and workers), page errors and the crash, with timestamps.
import { createServer } from '/home/roger/github/fs-exp/streams3/node_modules/vite/dist/node/index.js';
import { chromium } from '/home/roger/github/fs-exp/streams3/node_modules/playwright-core/index.mjs';
const [root, query] = process.argv.slice(2);
const port = Number(process.env.V2_PORT);
const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null }, optimizeDeps: { holdUntilCrawlEnd: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-webgl', ...(process.env.CL_ARGS ? process.env.CL_ARGS.split(' ') : [])] });
const t0 = Date.now();
const ts = () => ((Date.now() - t0) / 1000).toFixed(1);
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const p = await ctx.newPage();
  p.on('console', (m) => console.log(`${ts()} [${m.type()}] ${m.text().slice(0, 300)}`));
  p.on('pageerror', (e) => console.log(`${ts()} [pageerror] ${e.stack ?? e.message}`));
  p.on('crash', () => console.log(`${ts()} [CRASH]`));
  p.on('worker', (w) => { console.log(`${ts()} [worker+] ${w.url().slice(-60)}`); w.on('close', () => console.log(`${ts()} [worker-] ${w.url().slice(-60)}`)); });
  await p.goto(`http://127.0.0.1:${port}/index.html?${query}`, { waitUntil: 'load', timeout: 120000 });
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 240000 }).then(() => console.log(`${ts()} READY`)).catch((e) => console.log(`${ts()} not ready: ${e.message.slice(0, 200)}`));
} finally {
  await browser.close();
  await server.close();
}
