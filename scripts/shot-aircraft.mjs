#!/usr/bin/env node
// Contact sheet of one aircraft type: the model from the side, front, top and three-quarter rear, the cockpit,
// a gear close-up, and the 2D instrument panel, rendered by the dev pages in headless Chrome (GPU) and laid out
// on one picture with a caption under each view. For a quick look at a type's geometry, livery and panel.
//
//   node scripts/shot-aircraft.mjs <id> [out.png] [--params "gear=0&feather=all"]
//
//   <id>       a type id (c172s, c152, pa38, da20, pa34, da42) or a synthetic airframe of the dev page (syn-twin)
//   out.png    default shots/aircraft/<id>.png of this project
//   --params   extra URL parameters for dev/aircraft.html (gear=, pitch=, feather=, rpm2=, flaps=, ...)
//
// The views are frozen (freeze=1, hash=1: the same picture on every run). Exits non-zero when a page never became
// ready or printed a page error.

import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i];
  else positional.push(argv[i]);
}
const [id, outArg] = positional;
if (!id || !/^[a-z0-9-]+$/.test(id)) {
  console.error('usage: node scripts/shot-aircraft.mjs <id> [out.png] [--params "gear=0"]');
  process.exit(2);
}
const out = resolve(outArg ?? `${root}/shots/aircraft/${id}.png`);
const extra = flags.params ? `&${flags.params}` : '';

/** [caption, page] of every view, in the order of the sheet. */
const VIEWS = [
  ['side', `dev/aircraft.html?type=${id}&freeze=1&hash=1&view=side${extra}`],
  ['front', `dev/aircraft.html?type=${id}&freeze=1&hash=1&view=front${extra}`],
  ['top', `dev/aircraft.html?type=${id}&freeze=1&hash=1&view=top${extra}`],
  ['rear', `dev/aircraft.html?type=${id}&freeze=1&hash=1&view=rear${extra}`],
  ['gear', `dev/aircraft.html?type=${id}&freeze=1&hash=1&view=gear${extra}`],
  ['cockpit', `dev/aircraft.html?type=${id}&freeze=1&hash=1&view=cockpit${extra}`],
  ['panel', `dev/instruments.html?type=${id}&freeze=1&t=60`],
];
const W = 1600, H = 900;

const port = await new Promise((res, rej) => {
  const s = net.createServer();
  s.once('error', rej);
  s.listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => res(p));
  });
});
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
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-webgl'],
});

let bad = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const shots = [];
  for (const [caption, page] of VIEWS) {
    const p = await ctx.newPage();
    p.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') console.log(`[${caption}] [console.${m.type()}] ${m.text()}`);
    });
    p.on('pageerror', (e) => {
      bad++;
      console.log(`[${caption}] [pageerror] ${e.stack ?? e.message}`);
    });
    await p.goto(`http://127.0.0.1:${port}/${page}`, { waitUntil: 'load', timeout: 60000 });
    const ready = await p.waitForFunction(() => window.__ready === true, null, { timeout: 60000 }).then(() => true, () => false);
    if (!ready) {
      bad++;
      console.log(`[${caption}] page never set window.__ready; capturing anyway`);
    }
    await p.waitForTimeout(800);
    shots.push([caption, (await p.screenshot()).toString('base64')]);
    await p.close();
    console.log(`[shot-aircraft] ${caption}: ${page}`);
  }
  // The sheet: two columns of half-size views with captions.
  const sheet = await ctx.newPage();
  await sheet.setViewportSize({ width: W, height: Math.ceil(shots.length / 2) * (H / 2 + 28) + 40 });
  const cells = shots.map(([c, b64]) => `<figure><img src="data:image/png;base64,${b64}"><figcaption>${c}</figcaption></figure>`).join('');
  await sheet.setContent(
    `<!doctype html><html><body style="margin:0;background:#1d1f22;color:#ddd;font:14px system-ui,sans-serif">` +
      `<div style="padding:10px 12px;font-size:16px">${id}${extra ? ` (${extra.slice(1)})` : ''}</div>` +
      `<div style="display:grid;grid-template-columns:1fr 1fr">${cells}</div>` +
      `<style>figure{margin:0}img{display:block;width:${W / 2}px;height:${H / 2}px}figcaption{padding:4px 8px 6px}</style></body></html>`,
  );
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, await sheet.screenshot({ fullPage: true }));
  console.log(`[shot-aircraft] wrote ${out}`);
} catch (e) {
  bad++;
  console.log('[shot-aircraft]', e.message);
} finally {
  await browser.close();
  await server.close();
}
process.exit(bad ? 1 : 0);
