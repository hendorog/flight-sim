// Camera system dev page: a box-model aircraft flying a touch-and-go circuit, viewed through CameraSystem.
//
// URL parameters (on top of the harness's):
//   mode=chase       initial camera mode (cockpit | chase | orbit | flyby | tower)
//   t0=0             start time within the circuit, s (final starts at 0, touchdown ~39 s, liftoff ~62 s,
//                    crosswind turn ~89 s, downwind ~120 s, base turn ~209 s, lap 241 s)
//   turb=0.1         turbulence 0..1 (cockpit shake)
//   stall=0          stall buffet fraction override 0..1
// Keys: the full InputSystem is active, so C / Shift+C cycle cameras and the mouse wheel zooms.

import * as THREE from 'three';
import type { CameraMode } from '../core/context';
import { InputSystem } from '../input';
import { CameraSystem, DEFAULT_TOWER_NED } from '../render/cameras';
import { circuitState } from './camerasCircuit';
import { buildScenery, buildStandInAircraft } from './camerasScene';
import { runHarness } from './harness';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (params.has(k) ? Number(params.get(k)) : d);
const t0 = num('t0', 0);
const stall = num('stall', 0);

const cameras = new CameraSystem();
const input = new InputSystem({ view: cameras });

const label = document.createElement('div');
label.style.cssText =
  'position:fixed;left:12px;top:10px;font:13px/1.4 system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px #000;pointer-events:none;white-space:pre';

void runHarness({
  subsystems: [input, cameras],
  setup(ctx) {
    ctx.cameraMode = (params.get('mode') as CameraMode | null) ?? 'chase';
    ctx.weather.turbulence = num('turb', 0.1);
    ctx.scene.background = new THREE.Color(0.55, 0.7, 0.92);
    buildScenery(ctx.scene, DEFAULT_TOWER_NED);
    buildStandInAircraft(ctx.aircraftRoot);
    circuitState(t0, ctx.state);
    document.body.appendChild(label);
  },
  beforeUpdate(_dt, ctx) {
    circuitState(t0 + ctx.simTime, ctx.state);
    ctx.state.stallFraction = stall;
    const s = ctx.state;
    label.textContent =
      `${ctx.cameraMode}   t=${(t0 + ctx.simTime).toFixed(1)} s   AGL ${(s.altitudeAGL - 1.25).toFixed(0)} m   ` +
      `bank ${((s.roll * 180) / Math.PI).toFixed(0)}°   fov ${ctx.camera.fov.toFixed(1)}°`;
  },
});
