// Golden master of what the cockpit shows and sounds like for a given flight: the instrument dynamics
// (src/instruments/dynamics InstrumentSet.step -> readings) and the audio mapping (src/audio/mapping.ts
// SoundTracker / fillSynthParams -> the synthesiser's parameter block), fed frame by frame from scripted runs of
// the flight model on the frozen fdm rig (tests/golden/rigs/fdm.ts: flat ground, calm ISA), plus the audio mapping at fixed hand-written
// states. Pinned in tests/golden/data/c172Instruments.json to a relative 1e-9 (tests/golden/golden.ts).
//
// The flight runs here repeat c172Flight.golden.test.ts in outline: if that file fails too, look there first; if
// only this one fails, the instruments or the audio mapping changed.
//
// REGENERATE ONLY DELIBERATELY, after a change that is meant to alter the instruments, the sounds or the
// aircraft, and review the diff of the JSON:
//   FS_GOLDEN_UPDATE=1 npx vitest run tests/golden/c172Instruments.golden.test.ts

import { describe, it } from 'vitest';
import {
  airAbsorptionCutoff,
  brakeSqueal,
  buffet,
  chirpAmplitude,
  crankRpm,
  distanceGain,
  engineLoad,
  fillSynthParams,
  flapMotorRunning,
  makeParamBlock,
  propLoad,
  propagationDelay,
  rolling,
  roughness,
  SoundTracker,
  stallHorn,
  stepGyro,
  tipMach,
  windNoise,
  type SoundContext,
} from '../../src/audio/mapping';
import { P, type SynthParamName } from '../../src/audio/params';
import { DEG, FT, KT } from '../../src/core/math';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls, type AircraftState, type ControlInputs } from '../../src/core/types';
import { InstrumentSet, type InstrumentReadings } from '../../src/instruments/dynamics/instrumentSet';
import { ELEVATION, FRAME, at, calmWeather, makeRig, resetTo, type Rig } from './rigs/fdm';
import { golden, type Recorder } from './golden';

const FILE = 'c172Instruments';
const LONG = 30_000;

/** 1 from t0 until t1, else 0. */
const pulse = (t: number, t0: number, t1: number): number => (t >= t0 && t < t1 ? 1 : 0);

/** Every field of the readings, listed one by one (a field added later does not disturb the record). */
function recordReadings(r: Recorder, key: string, x: InstrumentReadings): void {
  const k = (name: string) => `${key}/${name}`;
  r.put(k('airspeedKt'), x.airspeedKt);
  r.put(k('altitudeFt'), x.altitudeFt);
  r.put(k('kollsmanInHg'), x.kollsmanInHg);
  r.put(k('verticalSpeedFpm'), x.verticalSpeedFpm);
  r.put(k('attitudeRoll'), x.attitudeRoll);
  r.put(k('attitudePitch'), x.attitudePitch);
  r.put(k('headingDeg'), x.headingDeg);
  r.put(k('headingBugDeg'), x.headingBugDeg);
  r.put(k('turnRate'), x.turnRate);
  r.put(k('ball'), x.ball);
  r.put(k('turnFlag'), x.turnFlag);
  r.put(k('rpm'), x.rpm);
  r.put(k('tachHours'), x.tachHours);
  r.put(k('fuelLeftGal'), x.fuelLeftGal);
  r.put(k('fuelRightGal'), x.fuelRightGal);
  r.put(k('oilTempF'), x.oilTempF);
  r.put(k('oilPressurePsi'), x.oilPressurePsi);
  r.put(k('egtF'), x.egtF);
  r.put(k('fuelFlowGph'), x.fuelFlowGph);
  r.put(k('suctionInHg'), x.suctionInHg);
  r.put(k('ammeterAmps'), x.ammeterAmps);
  r.put(k('busPowered'), x.busPowered);
  r.put(k('avionicsPowered'), x.avionicsPowered);
  r.put(k('annunciators.lowFuelLeft'), x.annunciators.lowFuelLeft);
  r.put(k('annunciators.lowFuelRight'), x.annunciators.lowFuelRight);
  r.put(k('annunciators.oilPress'), x.annunciators.oilPress);
  r.put(k('annunciators.lowVolts'), x.annunciators.lowVolts);
  r.put(k('annunciators.vacuum'), x.annunciators.vacuum);
  r.put(k('oatC'), x.oatC);
  r.put(k('clockSeconds'), x.clockSeconds);
  r.put(k('flapsDeg'), x.flapsDeg);
  r.put(k('ils.locValid'), x.ils.locValid);
  r.put(k('ils.gsValid'), x.ils.gsValid);
  r.put(k('ils.loc'), x.ils.loc);
  r.put(k('ils.gs'), x.ils.gs);
  r.put(k('obsDeg'), x.obsDeg);
  r.put(k('gps.distanceNm'), x.gps.distanceNm);
  r.put(k('gps.bearingDeg'), x.gps.bearingDeg);
  r.put(k('gps.trackDeg'), x.gps.trackDeg);
  r.put(k('gps.groundSpeedKt'), x.gps.groundSpeedKt);
  r.put(k('pressureAltitudeFt'), x.pressureAltitudeFt);
}

/**
 * The 23 synthesiser parameters of the Cessna 172S as of 2026-10-05, written out: the record must not follow
 * the live table (src/audio/params.ts SYNTH_PARAMS), or a parameter appended for another aircraft type would
 * add a key here. A name removed or renamed stops the type check.
 */
const SYNTH_PARAMS_RECORDED = [
  'rpm', 'firing', 'load', 'throttle', 'starter', 'roughness', 'propLoad', 'tipMach', 'windLevel', 'windFreq', 'slip', 'flapNoise',
  'buffet', 'horn', 'flapMotor', 'rolling', 'rollSpeed', 'surface', 'brakeSqueal', 'skid', 'gyro', 'fan', 'turbulence',
] as const satisfies readonly SynthParamName[];

/** The synthesiser's parameter block by parameter name (single precision, as the worklet receives it). */
function recordParams(r: Recorder, key: string, params: Float32Array): void {
  for (const name of SYNTH_PARAMS_RECORDED) r.put(`${key}/${name}`, params[P[name]]);
}

/**
 * Fly the rig for `seconds` in FRAME steps with the panel and the sound tracker following every frame, as the
 * shell runs them (physics, then instruments, then audio); record both when the scripted time reaches each of
 * `samples` (s). `script` sets the controls before every frame.
 */
function flyWithPanel(
  r: Recorder,
  rig: Rig,
  panel: InstrumentSet,
  seconds: number,
  samples: readonly number[],
  script: (t: number, c: ControlInputs, frame: number) => void,
): void {
  const weather = calmWeather({ qnhHpa: 1018, timeOfDay: 14.25 });
  const tracker = new SoundTracker();
  panel.reset(rig.fm.state);
  tracker.reset(rig.fm.state);
  const frames = Math.round(seconds / FRAME);
  const due = new Map(samples.map((t) => [Math.round(t / FRAME), t]));
  for (let i = 1; i <= frames; i++) {
    script((i - 1) * FRAME, rig.controls, i - 1);
    rig.fm.step(FRAME, rig.controls, rig.env);
    const readings = panel.step(FRAME, rig.fm.state, rig.controls, weather);
    const params = tracker.update(rig.fm.state, rig.controls, rig.env, weather, FRAME);
    const t = due.get(i);
    if (t !== undefined) {
      const key = `t${t.toFixed(2).padStart(5, '0')}`;
      recordReadings(r, `${key}/readings`, readings);
      recordParams(r, `${key}/synth`, params);
    }
  }
}

/** A hand-written state for the audio mapping: every field the mapping reads is set here, not left to the mock. */
function soundState(o: {
  rpm: number;
  running: boolean;
  manifoldPressure: number;
  power: number;
  thrust: number;
  tas: number;
  ias: number;
  alpha: number;
  beta: number;
  flaps: number;
  stallWarning: boolean;
  stallFraction: number;
  busVoltage: number;
  groundSpeed: number;
  /** Per wheel (nose, left, right): on the ground, and how hard it slides. */
  wheels: [boolean, number][];
}): AircraftState {
  const s = makeMockState();
  s.engine.rpm = s.propeller.rpm = o.rpm;
  s.engine.running = o.running;
  s.engine.manifoldPressure = o.manifoldPressure;
  s.engine.power = o.power;
  s.propeller.thrust = o.thrust;
  s.tas = o.tas;
  s.ias = o.ias;
  s.alpha = o.alpha;
  s.beta = o.beta;
  s.surfaces.flaps = o.flaps;
  s.stallWarning = o.stallWarning;
  s.stallFraction = o.stallFraction;
  s.electrical.busVoltage = o.busVoltage;
  s.groundSpeed = o.groundSpeed;
  o.wheels.forEach(([onGround, skid], i) => {
    s.wheels[i].onGround = onGround;
    s.wheels[i].skid = skid;
  });
  s.onGround = o.wheels.some(([onGround]) => onGround);
  return s;
}

describe('C172 instruments and audio mapping golden master', () => {
  it('panel and sound through a cruise manoeuvre (doublet, aileron step, knobs turned)', () => {
    golden(FILE, 'cruise', (r) => {
      const rig = makeRig();
      resetTo(rig, { airspeed: 110 * KT, position: at(ELEVATION + 3000 * FT), heading: 1 });
      const trim = { ...rig.fm.trimControls };
      const panel = new InstrumentSet();
      flyWithPanel(r, rig, panel, 10, [FRAME, 0.5, 1, 1.5, 2, 3, 4, 6, 7, 8, 9, 10], (t, c) => {
        c.elevator = trim.elevator + 0.08 * (pulse(t, 1, 2) - pulse(t, 2, 3));
        c.aileron = trim.aileron + 0.12 * pulse(t, 6, 8);
        c.rudder = trim.rudder + 0.3 * pulse(t, 8.5, 9.5);
        // The pilot's knobs: altimeter setting, heading bug, OBS, and the DG aligned for a moment.
        c.kollsmanHpa = t < 4 ? 1013.25 : 1018;
        c.headingBugDeg = t < 5 ? 57 : 90;
        c.obsDeg = t < 5 ? 70 : 64;
        c.dgAlign = t >= 7 && t < 7.5;
      });
      r.put('tachHoursEnd', panel.tach.hours);
    });
  }, LONG);

  it('panel and sound through a cold start on the ground, then flaps and a short roll', () => {
    golden(FILE, 'coldStart', (r) => {
      const rig = makeRig();
      resetTo(rig, { onGround: true, heading: 70 * DEG, engineRunning: false });
      const s = rig.fm.state;
      Object.assign(rig.controls, { masterBattery: false, alternator: false, avionics: false, throttle: 0.1 });
      const panel = new InstrumentSet({ gyrosSpunUp: false, tachHours: 1234.5 });
      let firedAt = -1;
      flyWithPanel(r, rig, panel, 14, [FRAME, 0.5, 1.25, 2, 3, 4.25, 4.5, 4.75, 5, 5.5, 6, 7, 8, 9, 10, 11, 12, 13, 14], (t, c, frame) => {
        c.masterBattery = c.alternator = t >= 1;
        c.fuelPump = t >= 2 && t < 3.5;
        c.mixture = t >= 2.5 ? 1 : 0;
        c.magnetos = t >= 3 ? 3 : 0;
        if (firedAt < 0 && s.engine.running) firedAt = frame;
        c.starter = t >= 4 && firedAt < 0;
        c.avionics = t >= 6;
        // Flaps to 10 with the bus alive (flap motor), then brakes off and power for a short roll, then brakes.
        c.flaps = t >= 7 ? 1 / 3 : 0;
        c.parkingBrake = t < 9;
        c.throttle = t >= 9 && t < 12 ? 0.6 : 0.1;
        c.rudder = t >= 9 ? 0.15 : 0;
        c.brakeLeft = c.brakeRight = t >= 12.5 ? 0.8 : 0;
      });
      r.put('firedAtFrame', firedAt);
      r.put('tachHoursEnd', panel.tach.hours);
    });
  }, LONG);

  it('audio mapping at four fixed states, and its scalar functions', () => {
    golden(FILE, 'audioMapping', (r) => {
      const cases: Record<string, { state: AircraftState; controls: Partial<ControlInputs>; sound: SoundContext }> = {
        cruise: {
          state: soundState({ rpm: 2400, running: true, manifoldPressure: 23.5, power: 96000, thrust: 880, tas: 58, ias: 55.5, alpha: 2 * DEG, beta: 0.4 * DEG, flaps: 0, stallWarning: false, stallFraction: 0, busVoltage: 28.2, groundSpeed: 61, wheels: [[false, 0], [false, 0], [false, 0]] }),
          controls: { throttle: 0.72, mixture: 0.85 },
          sound: { surface: 'grass', speedOfSound: 336.4, turbulence: 0.2, gyroSpin: 1, flapMotor: 0 },
        },
        approachStall: {
          state: soundState({ rpm: 1350, running: true, manifoldPressure: 11.2, power: 14000, thrust: -60, tas: 26.5, ias: 25.8, alpha: 14.5 * DEG, beta: -6 * DEG, flaps: 24 * DEG, stallWarning: true, stallFraction: 0.35, busVoltage: 27.9, groundSpeed: 24, wheels: [[false, 0], [false, 0], [false, 0]] }),
          controls: { throttle: 0.08, mixture: 1, magnetos: 2, flaps: 1 },
          sound: { surface: 'runway', speedOfSound: 339.8, turbulence: 0.45, gyroSpin: 0.93, flapMotor: 1 },
        },
        brakedRollOut: {
          state: soundState({ rpm: 810, running: true, manifoldPressure: 9.1, power: 2600, thrust: 150, tas: 9.2, ias: 8.9, alpha: 0.5 * DEG, beta: 3 * DEG, flaps: 30 * DEG, stallWarning: false, stallFraction: 0, busVoltage: 28.1, groundSpeed: 8.6, wheels: [[true, 0.05], [true, 0.62], [false, 0]] }),
          controls: { throttle: 0, brakeLeft: 0.9, brakeRight: 0.4 },
          sound: { surface: 'dirt', speedOfSound: 340.1, turbulence: 0, gyroSpin: 1, flapMotor: 0 },
        },
        cranking: {
          state: soundState({ rpm: 85, running: false, manifoldPressure: 28.4, power: -900, thrust: 4, tas: 0, ias: 0, alpha: 0, beta: 0, flaps: 0, stallWarning: false, stallFraction: 0, busVoltage: 21.3, groundSpeed: 0, wheels: [[true, 0], [true, 0], [true, 0]] }),
          controls: { throttle: 0.12, mixture: 0.3, starter: true, parkingBrake: true, avionics: false },
          sound: { surface: 'taxiway', speedOfSound: 340.3, turbulence: 0.1, gyroSpin: 0.07, flapMotor: 0 },
        },
      };
      for (const [name, c] of Object.entries(cases)) {
        recordParams(r, name, fillSynthParams(c.state, { ...defaultControls(), ...c.controls }, c.sound, makeParamBlock()));
      }

      r.put('crankRpm(60,starter)', crankRpm(60, true, false));
      r.put('engineLoad(8.5,2200)', engineLoad(8.5, 2200));
      r.put('engineLoad(20,60000)', engineLoad(20, 60000));
      r.put('engineLoad(28.5,118566)', engineLoad(28.5, 159 * 745.7));
      r.put('roughness(0.3,3)', roughness(0.3, 3));
      r.put('roughness(0.9,1)', roughness(0.9, 1));
      r.put('tipMach(2700,0)', tipMach(2700, 0, 340.3));
      r.put('tipMach(2400,55)', tipMach(2400, 55, 330));
      r.put('propLoad(700)', propLoad(700));
      r.put('propLoad(-150)', propLoad(-150));
      r.put('propLoad(2400)', propLoad(2400));
      const wind = windNoise(42, 4 * DEG, 20 * DEG);
      r.put('windNoise(42,4deg,20deg).level', wind.level);
      r.put('windNoise(42,4deg,20deg).freq', wind.freq);
      r.put('windNoise(42,4deg,20deg).slip', wind.slip);
      r.put('windNoise(42,4deg,20deg).flap', wind.flap);
      r.put('stallHorn(13deg,9)', stallHorn(true, 13 * DEG, 9));
      r.put('stallHorn(15deg,28)', stallHorn(true, 15 * DEG, 28));
      r.put('buffet(0.4)', buffet(0.4));
      r.put('rolling(2,18)', rolling(2, 18));
      r.put('rolling(3,31)', rolling(3, 31));
      r.put('brakeSqueal(0.7,1)', brakeSqueal(0.7, 1, true));
      r.put('brakeSqueal(1,7)', brakeSqueal(1, 7, true));
      r.put('chirpAmplitude(1.2)', chirpAmplitude(1.2));
      r.put('stepGyro(0.2,2000,28,0.5)', stepGyro(0.2, 2000, 28, 0.5));
      r.put('stepGyro(0.9,0,0,0.5)', stepGyro(0.9, 0, 0, 0.5));
      r.put('flapMotorRunning', flapMotorRunning(0.1, 0.1009, 1 / 60));
      r.put('distanceGain(47)', distanceGain(47));
      r.put('airAbsorptionCutoff(600)', airAbsorptionCutoff(600));
      r.put('propagationDelay(250)', propagationDelay(250));
    });
  });
});
