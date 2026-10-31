#!/usr/bin/env node
// Screenshots of every Career page (docs/career.md "UI pages"): opens dev/career.html?screen=<each> at 1280x720 and
// 1600x900, by day (tod=10) and night (tod=22), and writes <out>/<screen>_<w>x<h>_<day|night>.png. It is also the
// pages' layout check: it exits non-zero if any page logs a page error or a console error, or if any element under
// .cr-root (or the job strip) is wider inside than its box (scrollWidth > clientWidth + 1: something would scroll
// sideways or be cut off), and prints each offender with its page, class and widths.
//
//   node scripts/career-shots.mjs [--screens hub,board] [--sizes 1280x720,1600x900] [--times day,night] [--out dir]
//                                 [--chromium path] [--software]
//
// Starts its own vite on a free port and headless Chrome (as scripts/shot.mjs does); FS_CHROMIUM or --chromium
// launches another Chromium build, --software uses SwiftShader where the host has no Vulkan GPU.

import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
// Keep in step with FIXTURE_SCREENS in src/career/ui/fixtures.ts.
const ALL = [
  'locked', 'create', 'seed', 'hub', 'hub-job', 'hub-first', 'board', 'reposition', 'dispatch', 'dispatch-switch', 'fleet', 'market',
  'pilot', 'logbook', 'stop', 'bankrupt', 'debrief', 'debrief-crash', 'strip', 'strip-heli',
];
const screens = flag('screens', ALL.join(',')).split(',').filter(Boolean);
const sizes = flag('sizes', '1280x720,1600x900').split(',').map((s) => s.split('x').map(Number));
const times = flag('times', 'day,night').split(',');
const TOD = { day: 10, night: 22 };
const out = resolve(flag('out', `${root}/shots/career`));
const software = argv.includes('--software');
const chromiumPath = flag('chromium', process.env.FS_CHROMIUM);
mkdirSync(out, { recursive: true });

const server = await createServer({
  root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, optimizeDeps: { holdUntilCrawlEnd: true },
});
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({
  ...(chromiumPath ? { executablePath: chromiumPath } : { channel: 'chrome' }),
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl',
    ...(software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=vulkan', '--enable-features=Vulkan'])],
});

/** In the page: every element under a Career root (or the strip) whose content is wider than its box. */
function overflowing() {
  const bad = [];
  const roots = document.querySelectorAll('.cr-root, .cr-strip:not(.hidden)');
  for (const r of roots) {
    for (const e of [r, ...r.querySelectorAll('*')]) {
      if (!(e instanceof HTMLElement)) continue;
      const cs = getComputedStyle(e);
      if (cs.display === 'inline' || cs.display === 'none' || cs.display === 'contents') continue;
      if (e.scrollWidth > e.clientWidth + 1) {
        bad.push({ tag: e.tagName.toLowerCase(), cls: e.className, text: (e.textContent ?? '').trim().slice(0, 60), scrollWidth: e.scrollWidth, clientWidth: e.clientWidth });
      }
    }
  }
  return { roots: roots.length, bad };
}

let failures = 0;
try {
  for (const [w, h] of sizes) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    for (const time of times) {
      for (const screen of screens) {
        const p = await ctx.newPage();
        const errors = [];
        p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
        p.on('console', (m) => {
          if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
        });
        const url = `http://127.0.0.1:${port}/dev/career.html?screen=${screen}&tod=${TOD[time] ?? 10}&freeze=1`;
        await p.goto(url, { waitUntil: 'load', timeout: 60000 });
        try {
          await p.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
        } catch {
          errors.push('the page never set window.__ready');
        }
        await p.waitForTimeout(350);
        const { roots, bad } = await p.evaluate(overflowing);
        const file = resolve(out, `${screen}_${w}x${h}_${time}.png`);
        await p.screenshot({ path: file });
        const tag = `${screen} ${w}x${h} ${time}`;
        if (roots === 0) errors.push('no .cr-root or job strip on the page');
        for (const b of bad) errors.push(`overflow: <${b.tag} class="${b.cls}"> ${b.scrollWidth} > ${b.clientWidth} "${b.text}"`);
        if (errors.length) {
          failures++;
          console.log(`FAIL ${tag}`);
          for (const e of errors) console.log(`  ${e}`);
        } else console.log(`ok   ${tag} -> ${file}`);
        await p.close();
      }
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `${failures} page(s) failed` : 'every page clean');
process.exit(failures ? 1 : 0);
