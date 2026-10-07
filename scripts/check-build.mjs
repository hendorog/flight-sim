#!/usr/bin/env node
// Smoke-test the PRODUCTION build (run `npm run build` first): serves dist/ with `vite preview`, loads
// index.html in headless Chrome on the GPU, waits for window.__ready, presses a key (starts the audio
// worklet from its Blob URL), and prints console errors, failed requests and a state summary. Exits
// non-zero on page errors, failed requests, the console text "bake worker failed" (the livery worker could not
// bake the airframe: the page falls back to baking on the main thread, decision B-B4a-01), or if the page never
// becomes ready.
//
//   node scripts/check-build.mjs ["scenario=cruise&cam=chase"] [out.png]
//   node scripts/check-build.mjs "aircraft=pa34&scenario=runway&cam=chase"
//
// With `aircraft=<id>` the page must fly that type: the shell falls back to the Cessna 172S when a type's chunk
// fails to load, so a summary naming another aircraft fails the check.
//
// With `lesson=` in the query the Flight School must run that lesson in the built app: it waits for the
// briefing (or, with `brief=0`, for the lesson to be flying with a step under way, 20 s in) and fails if the
// lesson never gets there.

import { preview } from 'vite';
import { chromium } from 'playwright-core';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const query = process.argv[2] ?? 'scenario=cruise&cam=chase';
const out = process.argv[3];
const server = await preview({ root, preview: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--autoplay-policy=no-user-gesture-required'],
});
let bad = 0;
try {
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  p.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}] ${m.text()}`);
    if (m.text().includes('bake worker failed')) {
      bad++;
      if (m.type() !== 'error' && m.type() !== 'warning') console.log(`[console.${m.type()}] ${m.text()}`);
    }
  });
  p.on('pageerror', (e) => {
    bad++;
    console.log('[pageerror]', e.stack ?? e.message);
  });
  p.on('requestfailed', (r) => {
    bad++;
    console.log('[requestfailed]', r.url());
  });
  await p.goto(`${url}index.html?${query}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await p.keyboard.press('KeyL');
  await p.waitForTimeout(1500);
  const r = await p.evaluate(() => ({
    terrain: window.__sim.systems.terrain.stats,
    audioRunning: window.__sim.systems.audio.running,
    errors: window.__sim.errors,
    summary: window.__sim.summary(),
  }));
  console.log(JSON.stringify(r, null, 1));
  if (!r.audioRunning || r.errors.length) bad++;
  const aircraft = new URLSearchParams(query).get('aircraft');
  if (aircraft && r.summary.aircraft !== aircraft) {
    bad++;
    console.log(`[check-build] asked for aircraft=${aircraft}, the page flies ${r.summary.aircraft}`);
  }
  if (/(^|&)lesson=/.test(query)) {
    const flying = !/(^|&)brief=0/.test(query) ? null : true;
    const ok = await p
      .waitForFunction((fly) => {
        const st = window.__sim.training?.state?.();
        return !!st && (fly ? st.phase === 'running' && !!st.stepId && st.simT > 20 : st.screen === 'briefing');
      }, flying, { timeout: 180000, polling: 500 })
      .then(() => true, () => false);
    const st = await p.evaluate(() => {
      const x = window.__sim.training?.state?.();
      return x && { lesson: x.lesson, phase: x.phase, screen: x.screen, phaseId: x.phaseId, stepId: x.stepId, authority: x.authority, simT: x.simT, captions: x.captions?.slice(-4) };
    });
    console.log('[lesson]', JSON.stringify(st, null, 1));
    if (!ok) {
      bad++;
      console.log('[check-build] the lesson did not run');
    }
  }
  if (out) await p.screenshot({ path: resolve(out) });
} catch (e) {
  bad++;
  console.log('[check-build]', e.message);
} finally {
  await browser.close();
  await server.close();
}
process.exit(bad ? 1 : 0);
