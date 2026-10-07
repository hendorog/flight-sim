// The flight golden of a type accepted in Stage D (contract 4.5): the scripts of the C172S flight golden
// (c172Flight.golden.test.ts) flown with the type's own speeds on the frozen type rig (rigs/typeFdm.ts, maximum
// weight, flat ground, calm ISA), and pinned in tests/golden/data/<id>Flight.json to a relative 1e-9. The records
// are compared at that tolerance also under FS_GOLDEN_EXACT=1 (golden.ts `{ exact: false }`): the exact mode is
// the C172S's.
//
// Records: 'cruise' (trimmed, then an elevator doublet, an aileron step and a rudder step), 'approach' (trimmed
// with flaps 20 or the type's middle detent, a throttle chop, then full flap), 'coldStart' (cold and dark to
// running) and 'glide' (engine off, trimmed at the best-glide speed, hands off); a twin adds 'oeiCruise' (the cruise
// script on one engine, the dead one feathered). A record's speeds are the type's, written in its test file as
// literals: a later edit of the type's reference speeds must not change what the record flies.
//
// REGENERATE ONLY DELIBERATELY, after a change that is meant to alter the type's numbers (a fix whose request
// names the type, contract 4.7), and review the diff of the JSON:
//   FS_GOLDEN_UPDATE=1 npx vitest run tests/golden/<id>Flight.golden.test.ts

import { describe, it } from 'vitest';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { DEG, FT, KT } from '../../src/core/math';
import { clearEngineControl, setEngineControl, type ControlInputs } from '../../src/core/types';
import type { TrimResult } from '../../src/physics';
import { golden, type Recorder } from './golden';
import { ELEVATION, FRAME, at } from './rigs/fdm';
import { makeTypeRig, resetTypeTo, type TypeRig } from './rigs/typeFdm';

const LONG = 30_000;
const RUNWAY_HEADING = 70 * DEG;
const TOLERANCE_ONLY = { exact: false } as const;

/** The speeds a type's records fly, true airspeed in knots (the C172S golden flies 110 / 70 / 68). */
export interface TypeFlightScript {
  /** Trimmed level cruise at 3000 ft. */
  cruiseKt: number;
  /** Trimmed approach at 1500 ft, flaps 20 (the second detent of three, lever 2/3), 3 degrees down. */
  approachKt: number;
  /**
   * The approach's flap lever when the type's middle detent is not at 2/3 (the PA-38's 21 of 34 degrees, the
   * DA20's T/O); absent: 2/3.
   */
  approachFlaps?: number;
  /** Engine-off glide at 3000 ft, flaps up. */
  glideKt: number;
  /** Whether the type has an electric fuel pump the cold start switches on for the priming (2-5 s). */
  fuelPump: boolean;
  /**
   * Twins: trimmed level cruise at 3000 ft on the right engine, the left one failed and feathered (the record
   * 'oeiCruise'). A twin's cold start primes both engines with the pumps (2-6 s), then starts the left engine
   * and the right one after it, each on its own starter.
   */
  oeiCruiseKt?: number;
}

/** 1 from t0 until t1, else 0. */
const pulse = (t: number, t0: number, t1: number): number => (t >= t0 && t < t1 ? 1 : 0);

function record(r: Recorder, key: string, rig: TypeRig): void {
  const fm = rig.fm;
  r.state(key, fm.state);
  r.put(`${key}/cas`, fm.cas);
  if (fm.lastAero) r.aero(`${key}/lastAero`, fm.lastAero);
  // The state's `engine` and `propeller` are engine 0; a twin's other engine is recorded beside them.
  const st = fm.state;
  for (let i = 1; i < st.engines.length; i++) {
    r.engine(`${key}/engines[${i}]`, st.engines[i]);
    r.put(`${key}/propellers[${i}].rpm`, st.propellers[i].rpm);
    r.put(`${key}/propellers[${i}].thrust`, st.propellers[i].thrust);
    r.put(`${key}/propellers[${i}].bladePitch`, st.propellers[i].bladePitch);
    r.put(`${key}/propellers[${i}].feathered`, st.propellers[i].feathered);
  }
  if (st.engines.length > 1) {
    r.put(`${key}/propellers[0].bladePitch`, st.propellers[0].bladePitch);
    r.put(`${key}/propellers[0].feathered`, st.propellers[0].feathered);
  }
}

function recordMass(r: Recorder, key: string, rig: TypeRig): void {
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

/** As c172Flight.golden.test.ts: FRAME steps, `script` before every frame, samples before that frame's step. */
function fly(rig: TypeRig, r: Recorder, seconds: number, samples: readonly number[], script: (t: number, c: ControlInputs, frame: number) => void): void {
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

/** The four records of a single-engine type (five of a twin, `s.oeiCruiseKt`), in tests/golden/data/<def.id>Flight.json. */
export function describeTypeFlightGolden(def: AircraftDefinition, s: TypeFlightScript): void {
  const file = `${def.id}Flight`;
  describe(`${def.shortName} flight model golden master`, () => {
    it('trimmed cruise, then an elevator doublet, an aileron step and a rudder step', () => {
      golden(file, 'cruise', (r) => {
        const rig = makeTypeRig(def);
        resetTypeTo(rig, { airspeed: s.cruiseKt * KT, position: at(ELEVATION + 3000 * FT), heading: 1 });
        recordMass(r, 'start', rig);
        recordTrim(r, 'start/trim', rig.fm.lastTrim!);
        r.controls('start/trimControls', rig.fm.trimControls);
        const trim = { ...rig.fm.trimControls };
        fly(rig, r, 20, [0, 1, 1.5, 2, 2.5, 3, 5, 7, 8, 9, 11, 13, 14, 16, 18, 20], (t, c) => {
          c.elevator = trim.elevator + 0.08 * (pulse(t, 1, 2) - pulse(t, 2, 3));
          c.aileron = trim.aileron + 0.12 * pulse(t, 7, 9);
          c.rudder = trim.rudder + 0.3 * pulse(t, 13, 16);
        });
      }, TOLERANCE_ONLY);
    }, LONG);

    it('trimmed approach with flaps 20, a throttle chop, then full flap', () => {
      golden(file, 'approach', (r) => {
        const rig = makeTypeRig(def);
        resetTypeTo(rig, { airspeed: s.approachKt * KT, flaps: s.approachFlaps ?? 2 / 3, flightPathAngle: -3 * DEG, position: at(ELEVATION + 1500 * FT) });
        recordTrim(r, 'start/trim', rig.fm.lastTrim!);
        r.controls('start/trimControls', rig.fm.trimControls);
        fly(rig, r, 20, [0, 2, 4, 4.5, 5, 6, 8, 10, 11, 13, 15, 17, 20], (t, c) => {
          if (t >= 4) c.throttle = 0;
          if (t >= 10) c.flaps = 1;
        });
      }, TOLERANCE_ONLY);
    }, LONG);

    if (s.oeiCruiseKt !== undefined) {
      const oeiKt = s.oeiCruiseKt;
      it('one engine inoperative: trimmed cruise on the right engine, the left feathered, then the cruise inputs', () => {
        golden(file, 'oeiCruise', (r) => {
          const rig = makeTypeRig(def);
          resetTypeTo(rig, { airspeed: oeiKt * KT, position: at(ELEVATION + 3000 * FT), heading: 1, enginesRunning: [false, true], feathered: [true, false] });
          recordTrim(r, 'start/trim', rig.fm.lastTrim!);
          r.controls('start/trimControls', rig.fm.trimControls);
          const trim = { ...rig.fm.trimControls };
          fly(rig, r, 20, [0, 1, 1.5, 2, 2.5, 3, 5, 7, 8, 9, 11, 13, 14, 16, 18, 20], (t, c) => {
            c.elevator = trim.elevator + 0.08 * (pulse(t, 1, 2) - pulse(t, 2, 3));
            c.aileron = trim.aileron + 0.12 * pulse(t, 7, 9);
            c.rudder = trim.rudder + 0.3 * pulse(t, 13, 16);
          });
        }, TOLERANCE_ONLY);
      }, LONG);
    }

    if (def.engineCount > 1) {
      it('cold-and-dark start: master, pumps to prime, mixtures, magnetos, the left starter, then the right', () => {
        golden(file, 'coldStart', (r) => {
          const rig = makeTypeRig(def);
          resetTypeTo(rig, { onGround: true, heading: RUNWAY_HEADING, engineRunning: false });
          const st = rig.fm.state;
          recordMass(r, 'start', rig);
          r.controls('start/trimControls', rig.fm.trimControls);
          Object.assign(rig.controls, { masterBattery: false, alternator: false, avionics: false, throttle: 0.1, starter: false });
          // The parked engines' own magnetos and mixtures (engineStopControls) follow the scalars the script sets.
          clearEngineControl(rig.controls, 'magnetos');
          clearEngineControl(rig.controls, 'mixture');
          // Primed the handbook way (DECISIONS-D3a2): pumps on with the mixtures rich for 4 s, pumps off, then crank.
          const firedAt = [-1, -1];
          fly(rig, r, 20, [0, 0.5, 1.5, 2.5, 4, 6, 6.25, 6.5, 6.75, 7, 7.5, 8, 9, 10, 11, 12, 13, 15, 17, 20], (t, c, frame) => {
            c.masterBattery = c.alternator = t >= 1;
            c.fuelPump = t >= 2 && t < 6;
            c.mixture = t >= 2 ? 1 : 0;
            c.magnetos = t >= 4 ? 3 : 0;
            c.avionics = t >= 9 && firedAt[1] >= 0;
            for (let i = 0; i < 2; i++) if (firedAt[i] < 0 && st.engines[i].running) firedAt[i] = frame;
            setEngineControl(c, 0, 'starter', t >= 6 && firedAt[0] < 0);
            setEngineControl(c, 1, 'starter', firedAt[0] >= 0 && firedAt[1] < 0);
          });
          r.put('firedAtFrame', firedAt[0]);
          r.put('firedAtFrame[1]', firedAt[1]);
        }, TOLERANCE_ONLY);
      }, LONG);
    } else {
      it('cold-and-dark start: master, mixture, magnetos, starter held until the engine runs', () => {
        golden(file, 'coldStart', (r) => {
          const rig = makeTypeRig(def);
          resetTypeTo(rig, { onGround: true, heading: RUNWAY_HEADING, engineRunning: false });
          const st = rig.fm.state;
          recordMass(r, 'start', rig);
          r.controls('start/trimControls', rig.fm.trimControls);
          Object.assign(rig.controls, { masterBattery: false, alternator: false, avionics: false, throttle: 0.1 });
          let firedAt = -1;
          fly(rig, r, 15, [0, 0.5, 1.5, 2.5, 4, 6, 6.25, 6.5, 6.75, 7, 7.5, 8, 9, 10, 12, 15], (t, c, frame) => {
            c.masterBattery = c.alternator = t >= 1;
            if (s.fuelPump) c.fuelPump = t >= 2 && t < 5;
            c.mixture = t >= 3 ? 1 : 0;
            c.magnetos = t >= 4 ? 3 : 0;
            c.avionics = t >= 9;
            if (firedAt < 0 && st.engine.running) firedAt = frame;
            c.starter = t >= 6 && firedAt < 0;
          });
          r.put('firedAtFrame', firedAt);
        }, TOLERANCE_ONLY);
      }, LONG);
    }

    it('engine-off glide: trimmed at the best-glide speed, flaps up, hands off', () => {
      golden(file, 'glide', (r) => {
        const rig = makeTypeRig(def);
        resetTypeTo(rig, { airspeed: s.glideKt * KT, engineRunning: false, position: at(ELEVATION + 3000 * FT) });
        recordTrim(r, 'start/trim', rig.fm.lastTrim!);
        r.controls('start/trimControls', rig.fm.trimControls);
        fly(rig, r, 20, [0, 1, 2, 4, 6, 8, 10, 13, 16, 20], () => {});
      }, TOLERANCE_ONLY);
    }, LONG);
  });
}
