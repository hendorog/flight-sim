// UI dev page: HUD, menus, toasts and dialogs over a plain 3D scene, driven by the scripted mock flight.
//
// Extra URL parameters:
//   t=110          pre-roll the mock flight (see instrumentsFlight.ts)
//   menu=weather   open the pause menu on a tab (flight, weather, time, display, controls, controllers)
//   loading=0.6    show the loading screen at this progress
//   crash=1        raise a crash event
//   fpsmeter=1     show the frame-time readout
//   pads=1         fake yoke + pedals on the Joysticks & yokes page (menu=controllers)
//   ap=1           fake engaged autopilot (AP chip, Flight tab toggle)
//   hints=1        show the first-flight hints card
//   type=twin      the synthetic twin of src/ui/testbed.ts: its HUD levers and read-outs, gear chip, Vyse / Vmca
//                  marks, hints rows and the control-position widget's engine block (left engine selected)
//   chooser=1      the aircraft chooser lists every catalogue row (menu=flight)
// window.__ui is the UISystem, e.g. --eval "__ui.openMenu('controls')".

import * as THREE from 'three';
import { AIRCRAFT_CATALOGUE } from '../aircraft/registry';
import { defaultControls, setEngineControl } from '../core/types';
import { KEY_BINDINGS, type AxisControl, type DeviceInfo, type InputAction } from '../input';
import type { GamepadSettings, MenuTab } from '../ui';
import { UISystem } from '../ui';
import { TWIN_TESTBED_UI, twinTestbedDefinition } from '../ui/testbed';
import { runHarness } from './harness';
import { MockFlight } from './instrumentsFlight';

const params = new URLSearchParams(location.search);
const preRoll = Number(params.get('t') ?? 110);

const BINDINGS = [
  ...KEY_BINDINGS,
  { keys: 'P', action: 'Pause / resume', category: 'Simulation' },
  { keys: 'A', action: 'Autopilot on / off', category: 'Simulation' },
  { keys: 'Escape', action: 'Menu', category: 'Simulation' },
  { keys: 'F9', action: 'HUD on / off', category: 'View' },
  { keys: 'F8', action: 'Frame-time readout', category: 'View' },
];

/** A fake yoke + pedals for the Joysticks & yokes page (pads=1). Values wobble so the live bars move. */
function mockGamepads(): GamepadSettings {
  const t0 = performance.now();
  const store = new Map<string, DeviceInfo>();
  const cal = () => ({ min: -1, center: 0, max: 1, invert: false, deadzone: 0.03, curve: 0.2 });
  const mk = (index: number, id: string, kind: DeviceInfo['kind'], controls: AxisControl[], buttons: (InputAction | null)[]): DeviceInfo => ({
    index,
    id,
    kind,
    axes: controls.map((control) => ({ control, raw: 0, value: 0, cal: cal() })),
    buttons: buttons.map((action) => ({ pressed: false, action })),
    calibrating: false,
  });
  store.set('0', mk(0, 'Honeycomb Alpha Flight Controls (Vendor: 294b Product: 1900)', 'yoke', ['aileron', 'elevator'], ['brakes', 'flapsUp', 'flapsDown', 'trimNoseDown', 'trimNoseUp', null, 'cameraNext', null]));
  store.set('1', mk(1, 'Logitech Flight Rudder Pedals (Vendor: 046d Product: c264)', 'pedals', ['brakeLeft', 'brakeRight', 'rudder'], []));
  return {
    list() {
      const t = (performance.now() - t0) / 1000;
      for (const d of store.values())
        d.axes.forEach((a, i) => {
          a.raw = Math.sin(t * (0.7 + i * 0.3) + d.index);
          a.value = a.control.startsWith('brake') ? Math.max(0, a.raw) : a.raw;
        });
      store.get('0')!.buttons[0].pressed = Math.sin(t * 3) > 0.6;
      return [...store.values()];
    },
    setAxisControl: (i, k, c) => (store.get(String(i))!.axes[k].control = c),
    setAxisOptions: (i, k, o) => Object.assign(store.get(String(i))!.axes[k].cal, o),
    setButtonAction: (i, k, a) => (store.get(String(i))!.buttons[k].action = a),
    beginCalibration: (i) => (store.get(String(i))!.calibrating = true),
    endCalibration: () => store.forEach((d) => (d.calibrating = false)),
    resetProfile: () => {},
  };
}

const ui = new UISystem({ bindings: BINDINGS });
if (params.get('pads') === '1') ui.setGamepads(mockGamepads());
if (params.get('ap') === '1') {
  let on = true;
  ui.autopilot = { engaged: () => on, mode: () => 'HDG 070 ALT 3000 IAS 90', toggle: () => (on = !on) };
}
if (params.get('chooser') === '1') ui.aircraftChoices = AIRCRAFT_CATALOGUE.map((r) => ({ ...r, available: true }));
(window as unknown as { __ui: UISystem }).__ui = ui;
const twin = params.get('type') === 'twin';
const flight = new MockFlight();
const aircraft = new THREE.Group();

void runHarness({
  setup(ctx) {
    ctx.cameraMode = 'chase';
    ctx.commands.setCameraMode = (m) => {
      ctx.cameraMode = m;
      ctx.events.emit('cameraMode', { mode: m });
    };
    ctx.commands.setQuality = (q) => {
      ctx.quality = q;
      ctx.events.emit('qualityChanged', { quality: q });
    };
    ctx.commands.reset = (s) => ctx.events.emit('reset', { scenario: s });
    if (twin) {
      ctx.aircraft = twinTestbedDefinition(ctx.aircraft);
      ctx.presentation = { ...ctx.presentation, ui: TWIN_TESTBED_UI };
      ctx.controls = defaultControls(ctx.aircraft);
      setEngineControl(ctx.controls, 1, 'throttle', 0.6);
      setEngineControl(ctx.controls, 1, 'propeller', 0.8);
      ctx.controls.rudderTrim = 0.3;
      const s = ctx.state;
      s.engines.push({ ...s.engine });
      s.propellers.push({ ...s.propeller });
      s.gear = { retractable: true, lever: 'down', extension: [1, 1, 1], locked: [true, true, true], inTransit: false, warning: false };
      ctx.engineSelection = 0;
    }
    const h = 1 / 60;
    for (let t = 0; t < preRoll; t += h) flight.step(h, ctx.state, ctx.controls);
  },
  beforeUpdate(dt, ctx) {
    flight.step(dt, ctx.state, ctx.controls);
    // The mock flies engine 0; the twin's right engine turns a little slower.
    if (twin) Object.assign(ctx.state.engines[1], ctx.state.engine, { rpm: ctx.state.engine.rpm * 0.96 });
  },
  subsystems: [
    {
      init(ctx) {
        const ground = new THREE.Mesh(
          new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2),
          new THREE.MeshStandardMaterial({ color: 0x5d7f45, roughness: 1 }),
        );
        ground.position.y = 120;
        ctx.scene.add(ground);
        const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
        const fuselage = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.2, 7.5), white);
        const wing = new THREE.Mesh(new THREE.BoxGeometry(11, 0.14, 1.5), white);
        wing.position.set(0, 0.7, -0.3);
        const tail = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, 1), white);
        tail.position.set(0, 0.2, 3.4);
        aircraft.add(fuselage, wing, tail);
        ctx.aircraftRoot.add(aircraft);
      },
      update(_dt, ctx) {
        // Simple chase camera 25 m behind and 6 m above.
        const back = new THREE.Vector3(0, 0, 1).applyQuaternion(ctx.aircraftRoot.quaternion).setY(0).normalize();
        ctx.camera.position.copy(ctx.aircraftRoot.position).addScaledVector(back, 25).add(new THREE.Vector3(0, 6, 0));
        ctx.camera.lookAt(ctx.aircraftRoot.position);
      },
    },
    ui,
  ],
}).then((ctx) => {
  const loading = params.get('loading');
  if (loading !== null) ui.setLoadingProgress(Number(loading), 'Generating terrain…');
  else ui.hideLoading();
  const tab = params.get('menu');
  if (tab) ui.openMenu(tab as MenuTab);
  if (params.get('crash') === '1') ctx.events.emit('crash', { reason: 'left wingtip struck the ground' });
  if (params.get('fpsmeter') === '1') ui.fpsVisible = true;
  ui.showToast('Parking brake released');
});
