#!/usr/bin/env node
// Usage: node scripts/yoke/shoot.mjs <out.png> [styles] [--stick]
// Screenshot of scripts/yoke/preview.html (the yoke and stick styles of src/render/aircraft/yoke.ts) on its own vite.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [outPath, styles = '', ...rest] = process.argv.slice(2);
const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false, watch: null } });
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan'] });
try {
  const p = await browser.newPage({ viewport: { width: 1600, height: 400 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`http://127.0.0.1:${port}/scripts/yoke/preview.html?styles=${styles}${rest.includes('--stick') ? '&stick=1' : ''}`, { timeout: 120000 });
  await p.waitForFunction(() => window.__done === true, null, { timeout: 120000 }).catch(() => {});
  await p.screenshot({ path: resolve(outPath), fullPage: true });
  if (errs.length) console.log(errs.join('\n'));
} finally {
  await browser.close();
  await server.close();
}
