// Golden master of the C172 powerplant (src/physics/propulsion): the propeller coefficient maps, the propeller
// loads and slipstream, and the PropulsionSystem stepped through a start, throttle transients and settle(),
// pinned in tests/golden/data/c172Propulsion.json to a relative 1e-9 (tests/golden/golden.ts). Driven at fixed
// flight conditions with the frozen propulsion rig (tests/golden/rigs/propulsion.ts: ISA, 240 Hz).
//
// REGENERATE ONLY DELIBERATELY, after a change that is meant to alter the engine or the propeller, and review
// the diff of the JSON:
//   FS_GOLDEN_UPDATE=1 npx vitest run tests/golden/c172Propulsion.golden.test.ts

import { describe, it } from 'vitest';
import { C172 } from '../../src/core/c172';
import { DEG } from '../../src/core/math';
import type { ControlInputs } from '../../src/core/types';
import type { Slipstream } from '../../src/physics/interfaces';
import { PropulsionSystem } from '../../src/physics/propulsion';
import { Propeller } from '../../src/physics/propulsion/propeller';
import { SWIRL_BINS, sharedPropellerMap } from '../../src/physics/propulsion/propellerMap';
import { DT, makeInput, run, runningSystem } from './rigs/propulsion';
import { golden, type Recorder } from './golden';

const FILE = 'c172Propulsion';
const RPM = Math.PI / 30;

/** A step's output plus the tank contents, the shaft speed and the starter current behind it. */
function record(r: Recorder, key: string, sys: PropulsionSystem): void {
  r.put(`${key}/rpm`, sys.rpm);
  r.put(`${key}/fuelLeft`, sys.fuelLeft);
  r.put(`${key}/fuelRight`, sys.fuelRight);
  r.put(`${key}/starterAmps`, sys.electrical.state.starterAmps);
}

/**
 * Step `sys` for `seconds` at 240 Hz with `controls` at a fixed airspeed and altitude, recording the output
 * every `every` seconds under `${key}/t...` (time counted from `t0`).
 */
function stepAndRecord(
  r: Recorder,
  key: string,
  sys: PropulsionSystem,
  c: { ktas?: number; altitudeFt?: number; alpha?: number; controls: Partial<ControlInputs> },
  t0: number,
  seconds: number,
  every: number,
): void {
  const input = makeInput(c);
  const steps = Math.round(seconds / DT);
  const stride = Math.round(every / DT);
  for (let i = 1; i <= steps; i++) {
    const out = sys.step(input);
    if (i % stride === 0) {
      const k = `${key}/t${(t0 + i * DT).toFixed(2).padStart(5, '0')}`;
      r.propulsion(k, out);
      record(r, k, sys);
    }
  }
}

describe('C172 propulsion golden master', () => {
  it('propeller coefficient map samples and swirl profiles', () => {
    golden(FILE, 'propellerMap', (r) => {
      const map = sharedPropellerMap();
      const s = { ct: 0, cq: 0, cf: 0, cm: 0 };
      // (advance angle deg, in-plane fraction, reference Mach): static, climb, cruise, windmilling, stopped,
      // reversed flow, inclined inflow; on and between the map's nodes.
      const points: [number, number, number][] = [
        [0, 0, 0.49],
        [3, 0, 0.49],
        [7.5, 0, 0.5],
        [10, 0, 0.52],
        [13, 0, 0.55],
        [15.5, 0, 0.57],
        [18, 0, 0.6],
        [21, 0, 0.63],
        [25, 0, 0.4],
        [32, 0, 0.3],
        [47, 0, 0.2],
        [72, 0, 0.12],
        [90, 0, 0.1],
        [-10, 0, 0.3],
        [-55, 0, 0.1],
        [9, 0.03, 0.5],
        [12, 0.08, 0.53],
        [14, 0.18, 0.5],
        [6, 0.35, 0.33],
        [20, 0.6, 0.25],
        [40, 0.9, 0.08],
        [11, 0.1, 0.68],
        [11, 0.1, 0.75],
      ];
      points.forEach(([betaDeg, eta, mach], i) => {
        map.sample(betaDeg * DEG, eta, mach, s);
        const k = `sample${String(i).padStart(2, '0')}(beta=${betaDeg},eta=${eta},mach=${mach})`;
        r.put(`${k}/ct`, s.ct);
        r.put(`${k}/cq`, s.cq);
        r.put(`${k}/cf`, s.cf);
        r.put(`${k}/cm`, s.cm);
      });
      const profile = new Float64Array(SWIRL_BINS);
      for (const advanceDeg of [0, 3, 10, 15.5, 20, 31]) r.list(`swirlProfile(beta=${advanceDeg})`, map.swirlProfile(advanceDeg * DEG, profile));
    });
  });

  it('propeller loads and slipstream at fixed inflow and shaft speed', () => {
    golden(FILE, 'propeller', (r) => {
      const prop = new Propeller();
      const empty = (): Slipstream => ({ origin: { x: 0, y: 0, z: 0 }, radius: 0, inducedVelocity: 0, swirlRate: 0 });
      // Air velocity relative to the hub (body axes, m/s), rpm, density, speed of sound.
      const cases: Record<string, [{ x: number; y: number; z: number }, number, number, number]> = {
        static2350: [{ x: 0, y: 0, z: 0 }, 2350, 1.225, 340.3],
        climb2450: [{ x: -38, y: 0, z: 0 }, 2450, 1.225, 340.3],
        cruise2500: [{ x: -57, y: 0, z: 0 }, 2500, 1.1, 336],
        dive2700: [{ x: -75, y: 0, z: 0 }, 2700, 1.225, 340.3],
        climbInclined: [{ x: -36, y: 1.5, z: -6 }, 2450, 1.225, 340.3],
        sideInflow: [{ x: -30, y: -8, z: 2 }, 2300, 1.2, 339],
        idleGlide: [{ x: -35, y: 0, z: -3 }, 1100, 1.225, 340.3],
        windmilling: [{ x: -40, y: 0, z: 0 }, 900, 1.225, 340.3],
        stopped: [{ x: -30, y: 0, z: -2 }, 0, 1.225, 340.3],
        tailwind: [{ x: 6, y: 0, z: 0 }, 1500, 1.225, 340.3],
      };
      for (const [name, [air, rpm, rho, a]] of Object.entries(cases)) {
        const L = prop.evaluate(air, rpm * RPM, rho, a);
        r.put(`${name}/thrust`, L.thrust);
        r.put(`${name}/torque`, L.torque);
        r.vec(`${name}/inPlaneForce`, L.inPlaneForce);
        r.vec(`${name}/hubMoment`, L.hubMoment);
        r.put(`${name}/axialSpeed`, L.axialSpeed);
        r.put(`${name}/advanceRatio`, L.advanceRatio);
        const ss = prop.slipstream(C172.prop.hub, empty());
        r.vec(`${name}/slipstream.origin`, ss.origin);
        r.put(`${name}/slipstream.radius`, ss.radius);
        r.put(`${name}/slipstream.inducedVelocity`, ss.inducedVelocity);
        r.put(`${name}/slipstream.swirlRate`, ss.swirlRate);
        r.list(`${name}/slipstream.swirlProfile`, ss.swirlProfile!);
      }
    });
  });

  it('start from cold: cranking, firing, fast idle', () => {
    golden(FILE, 'startUp', (r) => {
      const sys = new PropulsionSystem();
      sys.reset({ running: false, fuelLeft: 72, fuelRight: 72 });
      const input = makeInput({ controls: { throttle: 0.1, starter: true } });
      let firedAt = -1;
      const steps = Math.round(6 / DT);
      for (let i = 1; i <= steps; i++) {
        const out = sys.step(input);
        if (out.engine.running && firedAt < 0) {
          firedAt = i;
          input.controls.starter = false;
        }
        // Every 0.1 s through the cranking and the catch, then every second.
        if (i % (i <= 480 ? 24 : 240) === 0) {
          const k = `t${(i * DT).toFixed(2).padStart(5, '0')}`;
          r.propulsion(k, out);
          record(r, k, sys);
        }
      }
      r.put('firedAtStep', firedAt);
    });
  });

  it('throttle transients, a magneto check, leaning, mixture cut-off and tank selection', () => {
    golden(FILE, 'transients', (r) => {
      // Static run-up: idle, slam to full throttle, back to 1800 rpm, right magneto, leaned.
      const ground = runningSystem(700);
      stepAndRecord(r, 'ground/idle', ground, { controls: { throttle: 0 } }, 0, 3, 1);
      stepAndRecord(r, 'ground/fullThrottle', ground, { controls: { throttle: 1 } }, 3, 3, 0.25);
      stepAndRecord(r, 'ground/partThrottle', ground, { controls: { throttle: 0.45 } }, 6, 2, 0.5);
      stepAndRecord(r, 'ground/rightMagneto', ground, { controls: { throttle: 0.45, magnetos: 1 } }, 8, 2, 1);
      stepAndRecord(r, 'ground/leaned', ground, { controls: { throttle: 0.45, mixture: 0.6, fuelPump: true, pitotHeat: true } }, 10, 2, 1);

      // In flight at 5000 ft: cruise power on the left tank, a chop to idle, mixture to cut-off (windmilling),
      // then rich again (relight), inflow inclined as in a climb, alternator off.
      const air = runningSystem(2400);
      stepAndRecord(r, 'air/cruiseLeftTank', air, { ktas: 105, altitudeFt: 5000, controls: { throttle: 0.7, mixture: 0.8, fuelSelector: 'left' } }, 0, 3, 1);
      stepAndRecord(r, 'air/chop', air, { ktas: 105, altitudeFt: 5000, controls: { throttle: 0, mixture: 0.8, fuelSelector: 'left' } }, 3, 2, 0.5);
      stepAndRecord(r, 'air/cutOff', air, { ktas: 80, altitudeFt: 5000, controls: { throttle: 0.5, mixture: 0 } }, 5, 3, 1);
      stepAndRecord(r, 'air/relight', air, { ktas: 80, altitudeFt: 5000, controls: { throttle: 0.5, mixture: 1 } }, 8, 3, 0.5);
      stepAndRecord(r, 'air/climbAlternatorOff', air, { ktas: 74, altitudeFt: 5000, alpha: 0.12, controls: { throttle: 1, alternator: false, fuelSelector: 'right' } }, 11, 3, 1);
    });
  });

  it('settle() at three throttle and airspeed points, and long steady runs', () => {
    golden(FILE, 'settle', (r) => {
      const points: Record<string, { ktas: number; altitudeFt: number; throttle: number }> = {
        staticFullThrottle: { ktas: 0, altitudeFt: 0, throttle: 1 },
        climb74FullThrottle: { ktas: 74, altitudeFt: 2000, throttle: 1 },
        cruise110PartThrottle: { ktas: 110, altitudeFt: 6000, throttle: 0.65 },
        glide65Idle: { ktas: 65, altitudeFt: 1000, throttle: 0 },
      };
      for (const [name, p] of Object.entries(points)) {
        const sys = runningSystem(2300);
        const out = sys.settle(makeInput({ ktas: p.ktas, altitudeFt: p.altitudeFt, controls: { throttle: p.throttle } }));
        r.propulsion(name, out);
        record(r, name, sys);
      }
      // The same full-throttle points reached by stepping (the engine tests' way), with the thermal state moving.
      const stat = runningSystem(2000);
      r.propulsion('run/static20s', run(stat, {}, 20));
      record(r, 'run/static20s', stat);
      const cruise = runningSystem(2500);
      r.propulsion('run/110ktas15s', run(cruise, { ktas: 110 }, 15));
      record(r, 'run/110ktas15s', cruise);
    });
  });
});
