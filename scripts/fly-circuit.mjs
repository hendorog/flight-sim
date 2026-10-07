#!/usr/bin/env node
// Usage: node scripts/fly-circuit.mjs [outDir] [aircraft]   (default shots/final/flight of this project, c172s)
// End-to-end circuit through window.__sim in the real app (headless Chrome, real GPU):
// take-off on 07 with the autoflight, left-hand circuit by heading/altitude/speed commands, the
// autoflight's approach/flare/roll-out, stop. Screenshots between phases; numbers to stdout as JSON.
// The circuit speeds and flap settings come from the flown type's definition (__sim.physics.definition): the
// crosswind leg at vdownwind - 10 KIAS, downwind at vdownwind - 5, abeam the threshold vapp + 5 with the first
// flap detent, base at vapp + 2 with the second, final at vapp (the Cessna 172S: 80, 85, 75, 72, 70 KIAS, flaps 10
// and 20); a retractable type puts its gear down abeam the threshold.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import net from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] ?? `${root}/shots/final/flight`;
const aircraft = process.argv[3];
mkdirSync(outDir, { recursive: true });
const port = await new Promise((res) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => res(p));
  });
});
const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null } });
await server.listen();
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
});
const log = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}] ${m.text()}`);
  });
  p.on('pageerror', (e) => console.log(`[pageerror] ${e.stack ?? e.message}`));
  await p.goto(`http://127.0.0.1:${port}/index.html?scenario=runway&cam=chase&tod=10&mute=1${aircraft ? `&aircraft=${aircraft}` : ''}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });

  // In-page helpers: a monitor that checks every step for NaNs and extremes, and a runner that steps until a
  // condition holds (0.25 s chunks, exact 240 Hz physics).
  await p.evaluate(async () => {
    const world = await import('/src/core/world.ts');
    const sim = window.__sim;
    sim.pause(true);
    const m = (window.__mon = { nan: [], crashes: [], touchdowns: [], maxRoll: 0, maxG: 0, minG: 9, minKiasAir: 999, maxKias: 0, maxAlt: 0, steps: 0, samples: [] });
    sim.ctx.events.on('crash', (e) => m.crashes.push({ t: sim.ctx.state.time, ...e }));
    sim.ctx.events.on('touchdown', (e) => m.touchdowns.push({ t: +sim.physics.state.time.toFixed(2), wheel: e.wheel, sink: +e.sinkRate.toFixed(2) }));
    const scan = (o, path, out) => {
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'number' && !Number.isFinite(v)) out.push(path + k);
        else if (v && typeof v === 'object') scan(v, path + k + '.', out);
      }
    };
    window.__rc = (s) => world.runwayCoords(s.position.x, s.position.y);
    window.__world = world;
    // The type's circuit: speeds (KIAS) and flap levers from its definition.
    const def = sim.physics.definition, ref = def.reference, f = def.controls.flaps;
    const lever = (i) => f.detents[Math.min(i, f.detents.length - 1)] / f.maxDeflection;
    window.__circuit = { id: def.id, crosswind: ref.vdownwind - 10, downwind: ref.vdownwind - 5, abeam: ref.vapp + 5, base: ref.vapp + 2, final: ref.vapp, flaps1: lever(1), flaps2: lever(2), retractable: def.geometry.gear.retractable };
    window.__run = (cond, maxS, label) => {
      const t0 = sim.physics.state.time;
      while (sim.physics.state.time - t0 < maxS) {
        sim.step(0.25);
        const s = sim.physics.state;
        const bad = [];
        scan(s, '', bad);
        if (bad.length && m.nan.length < 5) m.nan.push({ t: s.time, bad: bad.slice(0, 5) });
        m.maxRoll = Math.max(m.maxRoll, Math.abs(s.roll) * 57.3);
        if (!s.onGround) {
          m.maxG = Math.max(m.maxG, s.gLoad);
          m.minG = Math.min(m.minG, s.gLoad);
          m.minKiasAir = Math.min(m.minKiasAir, s.ias / 0.514444);
        }
        m.maxKias = Math.max(m.maxKias, s.ias / 0.514444);
        m.maxAlt = Math.max(m.maxAlt, s.altitudeMSL);
        if (Math.round(s.time * 4) % 20 === 0) {
          const rc = window.__rc(s);
          m.samples.push([+s.time.toFixed(1), Math.round(rc.along), Math.round(rc.across), Math.round(s.altitudeAGL), +(s.ias / 0.514444).toFixed(0), Math.round((s.heading * 180) / Math.PI), +((s.roll * 180) / Math.PI).toFixed(0), sim.physics.autoflight.phase]);
        }
        if (s.crashed || cond(s)) break;
      }
      const s = sim.physics.state;
      const rc = window.__rc(s);
      return { label, ...sim.summary(), along: Math.round(rc.along), across: Math.round(rc.across), flaps: sim.ctx.controls.flaps };
    };
  });

  const shot = async (name, settleMs = 1800) => {
    await p.waitForTimeout(settleMs);
    await p.screenshot({ path: `${outDir}/${name}.png` });
  };
  const phase = async (js) => {
    const r = await p.evaluate(js);
    log.push(r);
    console.log(JSON.stringify(r));
    return r;
  };

  // 1. Take-off with the autoflight's scenario plan (full power, rotate at the type's speed, Vy climb on 070).
  await phase(`(()=>{const sim=__sim;sim.reset('runway');sim.pause(true);sim.setAutoflight(true,true);return __run(s=>s.ias>25*0.5144,40,'roll to 25 kt')})()`);
  await shot('01_takeoff_roll_chase');
  await phase(`__run(s=>s.altitudeAGL>8,40,'lift-off')`);
  await p.evaluate(`__sim.setCamera('cockpit')`);
  await shot('02_liftoff_cockpit');
  await p.evaluate(`__sim.setCamera('chase')`);
  // 2. Climb straight out to 500 ft AGL, then a left crosswind turn (hold plan: heading/altitude/speed).
  await phase(`__run(s=>s.altitudeAGL>152,120,'climb to 500 ft AGL')`);
  await phase(`(()=>{const sim=__sim,W=__world;const s=sim.physics.state;sim.autoflight.engage({kind:'hold',heading:(W.AIRPORT.runway.heading-Math.PI/2+2*Math.PI)%(2*Math.PI),altitude:W.AIRPORT.elevation+1000*0.3048,kias:__circuit.crosswind},s,sim.ctx.controls);return __run(s=>__rc(s).across<-850,200,'crosswind to 900 m left')})()`);
  await shot('03_crosswind_chase');
  // 3. Downwind: heading 250, pattern altitude (C172S 85 KIAS); abeam the threshold slow down (75) and descend.
  await phase(`(()=>{const sim=__sim,W=__world;sim.autopilot.settings.heading=(W.AIRPORT.runway.heading+Math.PI)%(2*Math.PI);sim.autopilot.settings.airspeed=__circuit.downwind*0.5144;return __run(s=>__rc(s).along<-W.AIRPORT.runway.length/2,200,'downwind to abeam threshold')})()`);
  await p.evaluate(`__sim.setCamera('orbit')`);
  await shot('04_downwind_orbit');
  await p.evaluate(`__sim.setCamera('chase')`);
  await phase(`(()=>{const sim=__sim,W=__world;sim.autopilot.settings.airspeed=__circuit.abeam*0.5144;sim.autopilot.settings.altitude=W.AIRPORT.elevation+170;sim.ctx.controls.flaps=__circuit.flaps1;if(__circuit.retractable)sim.ctx.controls.gearLever='down';return __run(s=>__rc(s).along<-W.AIRPORT.runway.length/2-2600,200,'extend downwind, descend, flaps 10')})()`);
  // 4. Base: heading 160, second flap detent, then the autoflight's approach (centreline + 3 degree path, vapp).
  await phase(`(()=>{const sim=__sim,W=__world;sim.autopilot.settings.heading=(W.AIRPORT.runway.heading+Math.PI/2)%(2*Math.PI);sim.autopilot.settings.airspeed=__circuit.base*0.5144;sim.ctx.controls.flaps=__circuit.flaps2;return __run(s=>__rc(s).across>-320,200,'base leg')})()`);
  await shot('05_base_chase');
  await phase(`(()=>{const sim=__sim;sim.autoflight.engage({kind:'approach',kias:__circuit.final},sim.physics.state,sim.ctx.controls);return __run(s=>s.altitudeAGL<60,300,'final to 200 ft')})()`);
  await p.evaluate(`__sim.setCamera('cockpit')`);
  await shot('06_short_final_cockpit');
  await phase(`__run(s=>s.onGround,120,'flare and touchdown')`);
  await p.evaluate(`__sim.setCamera('chase')`);
  await shot('07_touchdown_chase');
  await phase(`__run(s=>__sim.physics.autoflight.phase==='stopped',120,'roll-out to a stop')`);
  await shot('08_stopped_chase');
  const mon = await p.evaluate(`(()=>{const m=window.__mon;return {...m,samples:undefined,sampleCount:m.samples.length,crashed:__sim.physics.state.crashed,errors:__sim.errors}})()`);
  const samples = await p.evaluate(`window.__mon.samples`);
  console.log(JSON.stringify(mon));
  writeFileSync(`${outDir}/flight.json`, JSON.stringify({ phases: log, monitor: mon, samples }, null, 1));
} finally {
  await browser.close();
  await server.close();
}
