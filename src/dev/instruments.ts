// Instrument panel dev page: the panel canvas at 1:1, driven by the scripted mock flight.
//
// Extra URL parameters:
//   t=60            pre-roll the mock flight to this time (s) before the first frame (see instrumentsFlight.ts
//                   for the timeline: 3 cold, 20 run-up, 70 climb, 110 turn, 140 cruise, 171 stall, 240 engine out)
//   zoom=x,y,s      magnify the panel s times with panel pixel (x, y) at the top-left of the window
//   view=3d         show the panel texture on a quad in the 3D scene instead of the raw canvas
//   type=<id>       the panel of a type from the registry (c152, pa38, da20, pa34, da42), or one of the two
//                   test-bed panels of instruments/panels/testbed.ts: twin, fadec. Default: the Cessna 172S.
//                   A twin gets a second engine (a little slower, and it keeps running through the engine
//                   failure), a gear cycle (up at 50 s, down at 215 s) and slowly moving trims.
//   ias=85          hold the indicated airspeed, kt;   ias=40,200[,period]  sweep it there and back (period s, default 20)
//   rpm=2300        the same for the engine speed (a sweep runs the right engine in the opposite sense, so the
//                   needles of a twin part: at whole periods the left one is at the first value, the right one at the second)
//   map=25          the same for the manifold pressure, inHg
// With freeze=1 the pre-rolled state stays put for screenshots. window.__panelMs is the average
// InstrumentPanel.update() cost over the last 120 frames; window.__panel is the panel (its layoutWarnings
// are also shown at the bottom of the page).

import * as THREE from 'three';
import { isAircraftId, loadAircraft, loadPresentation } from '../aircraft/registry';
import type { SimContext } from '../core/context';
import { KT } from '../core/math';
import { makeMockState } from '../core/mockState';
import { copyControls, defaultControls, type AircraftState, type ControlInputs, type EngineState } from '../core/types';
import { InstrumentPanel } from '../instruments';
import type { InstrumentSystemsDef, PanelDef, Rect } from '../instruments/panelDef';
import { FADEC_TESTBED_PANEL, FADEC_TESTBED_SYSTEMS, TESTBED_PX_RECT, TWIN_TESTBED_PANEL, TWIN_TESTBED_SYSTEMS } from '../instruments/panels/testbed';
import { runHarness } from './harness';
import { MockFlight } from './instrumentsFlight';

const params = new URLSearchParams(location.search);
const preRoll = Number(params.get('t') ?? 60);
const zoom = (params.get('zoom') ?? '').split(',').map(Number);
const view3d = params.get('view') === '3d';
const type = params.get('type');

/** A held value or a sweep between two values: `a` or `a,b[,period]`. */
interface Sweep {
  from: number;
  to: number;
  period: number;
}
function sweep(key: string): Sweep | null {
  const v = (params.get(key) ?? '').split(',').map(Number);
  if (params.get(key) === null || v.some(Number.isNaN)) return null;
  return { from: v[0], to: v[1] ?? v[0], period: v[2] ?? 20 };
}
/** Value of a sweep at time t; `mirrored` runs it in the opposite sense. */
function sweepAt(s: Sweep, t: number, mirrored = false): number {
  const phase = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / s.period);
  return s.from + (s.to - s.from) * (mirrored ? 1 - phase : phase);
}
const iasSweep = sweep('ias');
const rpmSweep = sweep('rpm');
const mapSweep = sweep('map');

const flight = new MockFlight();
// Without `type` the page is what it always was: the C172S panel, built before the harness.
let panel: InstrumentPanel | null = type ? null : new InstrumentPanel({ gyrosSpunUp: false, paintLevers: !view3d });
const samples: number[] = [];
if (panel) expose(panel);

function expose(p: InstrumentPanel): void {
  p.drawOnlyInCockpit = false;
  (window as unknown as { __panel: InstrumentPanel }).__panel = p;
}

/** The panel named by `type`, what feeds it, how many engines the mock state needs and the panel face it must fit. */
async function typedPanel(id: string): Promise<{ def: PanelDef; systems: InstrumentSystemsDef; engines: number; pxRect?: Rect; geared: boolean }> {
  if (id === 'twin') return { def: TWIN_TESTBED_PANEL, systems: TWIN_TESTBED_SYSTEMS, engines: 2, pxRect: TESTBED_PX_RECT, geared: false };
  if (id === 'fadec') return { def: FADEC_TESTBED_PANEL, systems: FADEC_TESTBED_SYSTEMS, engines: 2, pxRect: TESTBED_PX_RECT, geared: true };
  if (!isAircraftId(id)) throw new Error(`type=${id}: not an aircraft id, 'twin' or 'fadec'`);
  const [def, presentation] = await Promise.all([loadAircraft(id), loadPresentation(id)]);
  return {
    def: presentation.panel,
    systems: presentation.instrumentSystems,
    engines: def.engineCount,
    pxRect: presentation.visual.cockpit.panel.pxRect,
    geared: presentation.instrumentSystems.tachShaft === 'propeller',
  };
}

let geared = false;
let retractable = false;
/** The last state of the left engine while it was healthy: what the right engine of a twin keeps doing after the failure. */
let healthy: EngineState | null = null;

/**
 * What the mock flight does not script, for the panels that show it: a second engine, the propeller shaft of a
 * geared engine, FADEC figures, a gear cycle, moving trims, and the ias= / rpm= / map= overrides.
 */
function extendFlight(s: AircraftState, c: ControlInputs): void {
  const t = flight.t;
  const e0 = s.engines[0];
  // A geared diesel: the propeller turns at 1 / 1.69 of the crank; load follows the power lever; liquid cooling.
  e0.propRpm = geared ? e0.rpm / 1.69 : e0.rpm;
  e0.loadPercent = e0.running ? 100 * c.throttle : 0;
  e0.cht = e0.running ? 120 + 80 * c.throttle : Math.max(20, e0.cht - 0.02);
  e0.fuelPressure = e0.running ? 24 : c.fuelPump ? 20 : 0;
  if (geared) {
    e0.coolantTemp = e0.oilTemp * 0.95;
    e0.gearboxTemp = e0.oilTemp * 0.8;
  }
  if (s.engines.length > 1) {
    if (t < 200 || !healthy) healthy = { ...e0 };
    const live = t < 200 ? e0 : healthy;
    for (let i = 1; i < s.engines.length; i++) {
      Object.assign(s.engines[i], live);
      // Not quite synchronised: the needles of a twin gauge show side by side.
      s.engines[i].rpm = live.rpm * 0.97;
      s.engines[i].propRpm = live.propRpm * 0.97;
      s.engines[i].manifoldPressure = live.manifoldPressure - 0.6;
      s.propellers[i].rpm = s.engines[i].propRpm;
    }
    const amps = s.electrical.alternatorAmps;
    s.electrical.alternators[0] = e0.running ? amps * 0.55 : 0;
    s.electrical.alternators[1] = amps * 0.45;
    s.fuel.right = 52;
  }
  if (retractable) {
    // Up after take-off, down again in the glide; each way takes 7 s, the nose leg locking last.
    const lever = t > 50 && t < 215 ? 'up' : 'down';
    const travel = lever === 'up' ? Math.min(1, Math.max(0, (t - 50) / 7)) : t >= 215 ? 1 - Math.min(1, (t - 215) / 7) : 0;
    const down = 1 - travel;
    c.gearLever = lever;
    s.gear.retractable = true;
    s.gear.lever = lever;
    s.gear.extension = [down, down, down];
    s.gear.locked = [down >= 1, down >= 0.95, down >= 0.95];
    s.gear.inTransit = down > 0 && down < 1;
  }
  c.elevatorTrim = 0.35 * Math.sin(t / 9);
  c.rudderTrim = 0.5 * Math.sin(t / 13);
  if (iasSweep) s.ias = sweepAt(iasSweep, t) * KT;
  for (let i = 0; i < s.engines.length; i++) {
    const e = s.engines[i];
    if (rpmSweep) {
      e.rpm = sweepAt(rpmSweep, t, i % 2 === 1);
      e.propRpm = geared ? e.rpm / 1.69 : e.rpm;
      e.running = e.rpm > 300;
      s.propellers[i].rpm = e.propRpm;
    }
    if (mapSweep) e.manifoldPressure = sweepAt(mapSweep, t, i % 2 === 1);
  }
}

/** One step of the mock flight; the extras only where a typed panel or an override asks for them. */
function stepFlight(dt: number, ctx: SimContext): void {
  // Frozen: the state stays as the pre-roll left it.
  if (dt <= 0) return;
  flight.step(dt, ctx.state, ctx.controls);
  if (type || iasSweep || rpmSweep || mapSweep) extendFlight(ctx.state, ctx.controls);
}

const info = document.createElement('div');
info.style.cssText =
  'position:fixed;right:8px;bottom:8px;z-index:3;font:12px system-ui;color:#ddd;background:rgba(0,0,0,.6);padding:4px 8px;border-radius:4px';
const warnings = document.createElement('div');
warnings.style.cssText =
  'position:fixed;left:8px;bottom:8px;z-index:3;font:12px system-ui;color:#fc6;background:rgba(0,0,0,.75);padding:4px 8px;border-radius:4px;white-space:pre';

void runHarness({
  async setup(ctx) {
    if (type) {
      const typed = await typedPanel(type);
      geared = typed.geared;
      retractable = typed.def.gauges.some((g) => g.kind === 'gearLights');
      // The mock state and the controls of that many engines.
      Object.assign(ctx.state, makeMockState({ engines: typed.engines }));
      copyControls(ctx.controls, defaultControls({ engineCount: typed.engines, controlDefaults: {} }));
      panel = new InstrumentPanel({ def: typed.def, systems: typed.systems, pxRect: typed.pxRect, gyrosSpunUp: false, paintLevers: !view3d });
      expose(panel);
      warnings.textContent = panel.layoutWarnings.join('\n');
    }
    // Pre-roll at 120 Hz so the lagging instruments are in a realistic state.
    const h = 1 / 120;
    for (let t = 0; t < preRoll; t += h) {
      stepFlight(h, ctx);
      ctx.simTime += h;
      panel!.update(h, ctx);
    }
  },
  beforeUpdate(dt, ctx) {
    stepFlight(dt, ctx);
  },
  subsystems: [
    {
      init(ctx) {
        const p = panel!;
        if (view3d) {
          // Panel face 1.04 m x 0.40 m, 0.75 m in front of the camera.
          const quad = new THREE.Mesh(
            new THREE.PlaneGeometry(1.04, 0.4),
            new THREE.MeshStandardMaterial({ map: p.texture, roughness: 0.6, metalness: 0 }),
          );
          ctx.camera.add(quad);
          quad.position.set(0, -0.05, -0.75);
          ctx.scene.add(ctx.camera);
          return;
        }
        const c = p.canvas;
        c.style.cssText = 'position:fixed;left:0;top:0;z-index:2;transform-origin:0 0';
        if (zoom.length === 3 && zoom.every(Number.isFinite)) {
          const [x, y, s] = zoom;
          c.style.transform = `scale(${s}) translate(${-x}px, ${-y}px)`;
        }
        document.body.appendChild(c);
        document.body.appendChild(info);
        if (warnings.textContent) document.body.appendChild(warnings);
      },
      update(dt, ctx) {
        const p = panel!;
        p.update(dt, ctx);
        samples.push(p.lastUpdateMs);
        if (samples.length > 120) samples.shift();
        const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
        (window as unknown as { __panelMs: number }).__panelMs = avg;
        info.textContent = `t=${flight.t.toFixed(1)} s  ${flight.phase}  panel ${avg.toFixed(2)} ms`;
      },
    },
  ],
});
