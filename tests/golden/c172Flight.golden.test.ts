// Golden master of the complete Cessna 172S flight model (src/physics/c172FlightModel.ts): scripted, open-loop
// runs on the frozen fdm rig (tests/golden/rigs/fdm.ts: flat ground, calm ISA, typical loading at maximum weight) whose numbers are pinned
// in tests/golden/data/c172Flight.json to a relative 1e-9 (tests/golden/golden.ts).
//
// These are regression records, not handbook checks: the scripts are fixed control schedules, flown badly on
// purpose in places (a rotation into the stall warning, a spiral after the throttle chop) so that the ground
// roll, the lift-off, the stall and the out-of-trim regimes are all inside the record. A failure prints the
// worst relative difference and its key: 1e-13 is a change in the order of some arithmetic, 1e-3 is a change
// in the model.
//
// REGENERATE ONLY DELIBERATELY, after a change that is meant to alter the aircraft's numbers, and review the
// diff of the JSON:
//   FS_GOLDEN_UPDATE=1 npx vitest run tests/golden/c172Flight.golden.test.ts

import { describe, it } from 'vitest';
import { DEG, FT, KT } from '../../src/core/math';
import type { ControlInputs } from '../../src/core/types';
import type { TrimResult, TrimSpec } from '../../src/physics';
import { ELEVATION, FRAME, at, makeRig, resetTo, type Rig } from './rigs/fdm';
import { golden, type Recorder } from './golden';

const FILE = 'c172Flight';
const RUNWAY_HEADING = 70 * DEG;
const LONG = 30_000;

/** 0 before t0, 1 after t1, linear between. */
const ramp = (t: number, t0: number, t1: number): number => Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
/** 1 from t0 until t1, else 0. */
const pulse = (t: number, t0: number, t1: number): number => (t >= t0 && t < t1 ? 1 : 0);

/** The whole published state plus what the model exposes beside it (calibrated airspeed, last aerodynamic output). */
function record(r: Recorder, key: string, rig: Rig): void {
  const fm = rig.fm;
  r.state(key, fm.state);
  r.put(`${key}/cas`, fm.cas);
  if (fm.lastAero) r.aero(`${key}/lastAero`, fm.lastAero);
}

/** Mass, CG and inertia the model flies with (rebuilt from the fuel on board). */
function recordMass(r: Recorder, key: string, rig: Rig): void {
  const mp = rig.fm.massProperties;
  r.put(`${key}/mass`, mp.mass);
  r.vec(`${key}/cgOffset`, mp.cgOffset);
  r.put(`${key}/inertia.Ixx`, mp.inertia.Ixx);
  r.put(`${key}/inertia.Iyy`, mp.inertia.Iyy);
  r.put(`${key}/inertia.Izz`, mp.inertia.Izz);
  r.put(`${key}/inertia.Ixz`, mp.inertia.Ixz);
}

function recordTrim(r: Recorder, key: string, t: TrimResult): void {
  r.put(`${key}/converged`, t.converged);
  r.put(`${key}/iterations`, t.iterations);
  r.put(`${key}/alpha`, t.alpha);
  r.put(`${key}/beta`, t.beta);
  r.put(`${key}/roll`, t.roll);
  r.put(`${key}/pitch`, t.pitch);
  r.put(`${key}/heading`, t.heading);
  r.put(`${key}/flightPathAngle`, t.flightPathAngle);
  r.put(`${key}/elevator`, t.elevator);
  r.put(`${key}/aileron`, t.aileron);
  r.put(`${key}/rudder`, t.rudder);
  r.put(`${key}/throttle`, t.throttle);
  r.put(`${key}/flaps`, t.flaps);
  r.quat(`${key}/orientation`, t.orientation);
  r.vec(`${key}/velocityBody`, t.velocityBody);
}

/**
 * Fly `seconds` in FRAME steps. `script` sets the controls before every frame from the scripted time (the
 * frame count times FRAME, not the model's clock); the state is recorded when the scripted time reaches each
 * of `samples` (s, whole frames), before that frame's script and step.
 */
function fly(rig: Rig, r: Recorder, seconds: number, samples: readonly number[], script: (t: number, c: ControlInputs, frame: number) => void): void {
  const frames = Math.round(seconds / FRAME);
  const due = new Map(samples.map((t) => [Math.round(t / FRAME), t]));
  for (let i = 0; i <= frames; i++) {
    const t = due.get(i);
    if (t !== undefined) record(r, `t${t.toFixed(2).padStart(5, '0')}`, rig);
    if (i === frames) break;
    script(i * FRAME, rig.controls, i);
    rig.fm.step(FRAME, rig.controls, rig.env);
  }
}

describe('C172 flight model golden master', () => {
  it('take-off roll from rest at full throttle, rotation and lift-off on a fixed control schedule', () => {
    golden(FILE, 'takeoff', (r) => {
      const rig = makeRig();
      resetTo(rig, { onGround: true, heading: RUNWAY_HEADING });
      recordMass(r, 'start', rig);
      r.controls('start/trimControls', rig.fm.trimControls);
      rig.controls.parkingBrake = false;
      rig.controls.throttle = 1;
      fly(rig, r, 26, [0, 0.5, 2, 5, 10, 15, 19, 20.5, 21, 22, 24, 26], (t, c) => {
        // Right pedal against the swing, eased as the fin gains authority; the yoke comes back at ~50 KIAS,
        // lifts the aircraft off in the stall warning at ~21 s and is then relaxed a little.
        c.rudder = 0.12 * ramp(t, 0, 2) + 0.1 * ramp(t, 2, 11) - 0.04 * ramp(t, 13, 17);
        c.elevator = 0.3 * ramp(t, 18, 20) - 0.1 * ramp(t, 21, 23);
        c.aileron = 0.04 * ramp(t, 21, 23);
      });
      recordMass(r, 'end', rig);
    });
  }, LONG);

  it('trimmed cruise, then an elevator doublet, an aileron step and a rudder step', () => {
    golden(FILE, 'cruise', (r) => {
      const rig = makeRig();
      resetTo(rig, { airspeed: 110 * KT, position: at(ELEVATION + 3000 * FT), heading: 1 });
      recordTrim(r, 'start/trim', rig.fm.lastTrim!);
      r.controls('start/trimControls', rig.fm.trimControls);
      const trim = { ...rig.fm.trimControls };
      fly(rig, r, 20, [0, 1, 1.5, 2, 2.5, 3, 5, 7, 8, 9, 11, 13, 14, 16, 18, 20], (t, c) => {
        c.elevator = trim.elevator + 0.08 * (pulse(t, 1, 2) - pulse(t, 2, 3));
        c.aileron = trim.aileron + 0.12 * pulse(t, 7, 9);
        c.rudder = trim.rudder + 0.3 * pulse(t, 13, 16);
      });
    });
  }, LONG);

  it('trimmed approach with flaps 20, a throttle chop, then full flap', () => {
    golden(FILE, 'approach', (r) => {
      const rig = makeRig();
      resetTo(rig, { airspeed: 70 * KT, flaps: 2 / 3, flightPathAngle: -3 * DEG, position: at(ELEVATION + 1500 * FT) });
      recordTrim(r, 'start/trim', rig.fm.lastTrim!);
      r.controls('start/trimControls', rig.fm.trimControls);
      fly(rig, r, 20, [0, 2, 4, 4.5, 5, 6, 8, 10, 11, 13, 15, 17, 20], (t, c) => {
        // Hands and feet stay where the trim left them: the chop leaves the aircraft out of trim in yaw and roll.
        if (t >= 4) c.throttle = 0;
        if (t >= 10) c.flaps = 1;
      });
    });
  }, LONG);

  it('cold-and-dark start: master, pump, mixture, magnetos, starter held until the engine runs', () => {
    golden(FILE, 'coldStart', (r) => {
      const rig = makeRig();
      resetTo(rig, { onGround: true, heading: RUNWAY_HEADING, engineRunning: false });
      const s = rig.fm.state;
      r.controls('start/trimControls', rig.fm.trimControls);
      Object.assign(rig.controls, { masterBattery: false, alternator: false, avionics: false, throttle: 0.1 });
      let firedAt = -1;
      fly(rig, r, 15, [0, 0.5, 1.5, 2.5, 4, 6, 6.25, 6.5, 6.75, 7, 7.5, 8, 9, 10, 12, 15], (t, c, frame) => {
        c.masterBattery = c.alternator = t >= 1;
        c.fuelPump = t >= 2 && t < 5;
        c.mixture = t >= 3 ? 1 : 0;
        c.magnetos = t >= 4 ? 3 : 0;
        c.avionics = t >= 9;
        if (firedAt < 0 && s.engine.running) firedAt = frame;
        c.starter = t >= 6 && firedAt < 0;
      });
      // The frame the engine was first seen running (the starter is released there).
      r.put('firedAtFrame', firedAt);
    });
  }, LONG);

  it('trim solutions: cruise, Vy climb at full throttle, power-off glide', () => {
    golden(FILE, 'trims', (r) => {
      // In-flight resets, each on a new rig: the trim the reset solved, the controls it leaves and the state it
      // publishes. 'climb' asks for more than the aircraft can do: the throttle is pinned at full and the path
      // solved. 'glide' has the engine stopped and the propeller windmilling.
      const resets = {
        cruise: { airspeed: 110 * KT, position: at(ELEVATION + 3000 * FT) },
        climb: { airspeed: 74 * KT, flightPathAngle: 15 * DEG, position: at(ELEVATION + 1000 * FT) },
        glide: { airspeed: 68 * KT, engineRunning: false, position: at(ELEVATION + 3000 * FT) },
      };
      for (const [name, ic] of Object.entries(resets)) {
        const one = makeRig();
        resetTo(one, ic);
        recordTrim(r, `${name}/trim`, one.fm.lastTrim!);
        r.controls(`${name}/trimControls`, one.fm.trimControls);
        record(r, `${name}/state`, one);
      }

      // The solver called directly, as the performance tests call it, again on a new rig each time: a model
      // that has been reset or trimmed before carries some aerodynamic state over, and a trim solved on it
      // differs from this one in the eighth digit.
      const alt = ELEVATION + 3000 * FT;
      const solves: Record<string, TrimSpec> = {
        vyClimb: { tas: 74 * KT, altitude: alt, throttle: 1 },
        idleGlide: { tas: 68 * KT, altitude: alt, throttle: 0 },
        level: { tas: 95 * KT, altitude: alt, flightPathAngle: 0 },
        flaps30: { tas: 62 * KT, altitude: alt, flaps: 30 * DEG, flightPathAngle: -3 * DEG },
        zeroSideslipClimb: { tas: 80 * KT, altitude: alt, throttle: 1, lateral: 'zeroSideslip' },
        steadySlip: { tas: 75 * KT, altitude: alt, lateral: 'steadySlip', rudder: 0.5, flightPathAngle: 0 },
      };
      for (const [name, spec] of Object.entries(solves)) {
        const one = makeRig();
        resetTo(one, { airspeed: 100 * KT });
        recordTrim(r, `solve/${name}`, one.fm.solveTrim(spec, one.env));
      }
    });
  }, LONG);
});
