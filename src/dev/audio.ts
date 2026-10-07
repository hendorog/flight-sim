// Audio dev page.
//
//   dev/audio.html              live: the circuit flight with engine power following the pattern, full
//                               InputSystem + CameraSystem + AudioSystem. Click to start sound; C cycles
//                               cameras (cockpit = interior mix, flyby/tower = distance + Doppler).
//                               Buttons: touchdown chirp, crash, stall horn, flaps, engine stop/start.
//   dev/audio.html?analyze=1    offline render of a scripted start-up-to-shutdown sequence through the
//                               real worklet, drawn as spectrograms (for screenshots). With type=<id> the
//                               sound profile of that aircraft type, with engines=2 a two-engine variant
//                               of it (audioAnalyze.ts).

import { AudioSystem } from '../audio';
import type { CameraMode, SimContext } from '../core/context';
import { DEG } from '../core/math';
import { InputSystem } from '../input';
import { CameraSystem, DEFAULT_TOWER_NED } from '../render/cameras';
import { runAnalysis } from './audioAnalyze';
import { circuitState } from './camerasCircuit';
import { buildScenery, buildStandInAircraft } from './camerasScene';
import { runHarness } from './harness';

const params = new URLSearchParams(location.search);

if (params.get('analyze') === '1') void runAnalysis();
else void live();

async function live(): Promise<void> {
  const t0 = Number(params.get('t0') ?? 0);
  const cameras = new CameraSystem();
  const input = new InputSystem({ view: cameras });
  const audio = new AudioSystem();
  let engineOn = true;
  let horn = false;
  let wasOnGround = false;

  const ctx = await runHarness({
    subsystems: [input, cameras, audio],
    setup(c) {
      c.cameraMode = (params.get('mode') as CameraMode | null) ?? 'chase';
      buildScenery(c.scene, DEFAULT_TOWER_NED);
      buildStandInAircraft(c.aircraftRoot);
    },
    beforeUpdate(_dt, c) {
      circuitState(t0 + c.simTime, c.state);
      drivePowerplant(c, engineOn);
      c.state.stallWarning = horn;
      c.state.alpha = horn ? 15 * DEG : c.state.alpha;
      if (c.state.onGround && !wasOnGround && c.simTime > 0.5) c.events.emit('touchdown', { wheel: 'left', sinkRate: 1.2 });
      wasOnGround = c.state.onGround;
    },
  });
  (window as unknown as { __audio: AudioSystem }).__audio = audio;
  if (params.get('autostart') === '1') await audio.start();

  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;right:10px;top:10px;display:flex;flex-direction:column;gap:6px;font:13px system-ui';
  const button = (label: string, fn: () => void): void => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = (e) => {
      e.stopPropagation();
      fn();
    };
    panel.appendChild(b);
  };
  button('Start audio', () => void audio.start());
  button('Touchdown chirp', () => ctx.events.emit('touchdown', { wheel: 'left', sinkRate: 1.5 }));
  button('Crash', () => ctx.events.emit('crash', { reason: 'test' }));
  button('Stall horn on/off', () => (horn = !horn));
  button('Engine stop/start', () => (engineOn = !engineOn));
  const vol = document.createElement('input');
  vol.type = 'range';
  vol.min = '0';
  vol.max = '1';
  vol.step = '0.01';
  vol.value = String(audio.getVolume());
  vol.oninput = () => audio.setVolume(Number(vol.value));
  panel.appendChild(vol);
  document.body.appendChild(panel);
}

/** Plausible engine/propeller numbers for each part of the circuit (power follows the pattern). */
function drivePowerplant(c: SimContext, on: boolean): void {
  const s = c.state;
  const climbing = s.verticalSpeed > 0.5 || s.onGround; // full power through the touch-and-go
  const descending = s.verticalSpeed < -0.5;
  const throttle = !on ? 0 : climbing ? 1 : descending ? 0.35 : 0.7;
  const rpm = !on ? 0 : 1100 + 1300 * throttle;
  c.controls.throttle = throttle;
  const e = s.engine;
  e.running = on;
  e.rpm += (rpm - e.rpm) * 0.05;
  e.manifoldPressure = on ? 12 + 17 * throttle : 29;
  e.power = on ? 134000 * throttle * (e.rpm / 2700) : 0;
  s.propeller.rpm = e.rpm;
  s.propeller.thrust = on ? 400 + 1800 * throttle - 8 * s.tas : 0;
}
