#!/usr/bin/env node
// Usage: node scripts/panel-shader-dump.mjs c172s,c208,r44 <out dir> [tod]
// Dumps the instrument panel's compiled program (vertex and fragment source as WebGL received them, the program cache
// key) and its panel uniforms per type, from the 3D cockpit on the runway, frozen. Two dumps that compare equal (cmp)
// show a refactor left the panel's rendering unchanged, without the run-to-run noise of screenshots. No pixel readback.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [types, out] = [process.argv[2].split(','), process.argv[3]];
const tod = process.argv[4] ?? '12';
mkdirSync(out, { recursive: true });
const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, optimizeDeps: { holdUntilCrawlEnd: true } });
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-webgl'] });
try {
  for (const type of types) {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 991 }, deviceScaleFactor: 1.5 });
    const p = await ctx.newPage();
    await p.goto(`http://127.0.0.1:${port}/index.html?aircraft=${type}&scenario=runway&cam=cockpit&mute=1&quality=high&tod=${tod}&resume=0&freeze=1&ui=0`, { waitUntil: 'load', timeout: 180000 });
    await p.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
    await new Promise((r) => setTimeout(r, 2500));
    const r = await p.evaluate(() => {
      const ctx = window.__sim.ctx, renderer = ctx.renderer, gl = renderer.getContext();
      let mesh = null;
      ctx.aircraftRoot.traverse((o) => { if (o.isMesh && o.name === 'instrumentPanel' && !mesh) mesh = o; });
      const m = mesh.material;
      const prog = renderer.properties.get(m).currentProgram;
      const src = gl.getAttachedShaders(prog.program).map((s) => gl.getShaderSource(s));
      const u = {};
      for (const [k, v] of Object.entries(renderer.properties.get(m).uniforms ?? {})) {
        if (!/^panel|cockpit/.test(k)) continue;
        const val = v.value;
        u[k] = Array.isArray(val) ? val.map((x) => x.toArray ? x.toArray() : x) : val?.toArray ? val.toArray() : val;
      }
      return { name: m.name, cacheKey: prog.cacheKey, vs: src[0], fs: src[1], uniforms: u, emissive: m.emissive.toArray(), map: !!m.map, emissiveMap: !!m.emissiveMap };
    });
    writeFileSync(`${out}/${type}.vs.glsl`, r.vs);
    writeFileSync(`${out}/${type}.fs.glsl`, r.fs);
    delete r.vs; delete r.fs;
    writeFileSync(`${out}/${type}.json`, JSON.stringify(r, null, 1));
    console.log(type, r.name, r.cacheKey.length, Object.keys(r.uniforms));
    await ctx.close();
  }
} finally { await browser.close(); await server.close(); }
