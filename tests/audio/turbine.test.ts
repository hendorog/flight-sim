// The gas-turbine voice (EngineSoundProfile.combustion 'turbine') and the Cessna 208 Caravan's sound profile that
// uses it: the PT6A-114A's whine on its gas-generator speed, the burner's roar with what it burns, nothing that
// pulses, the starter-generator, the light-off, and the three-blade propeller at 1900 rpm with its growl. Then the
// mapping from a turbine's EngineState (Ng in %, ITT, fuel flow) to the parameters.

import { describe, expect, it } from 'vitest';
import { C172S_AUDIO } from '../../src/aircraft/c172s/audio';
import { C208_AUDIO } from '../../src/aircraft/c208/audio';
import { C208_PROPELLER, PT6A_114A, PT6A_NG_RPM } from '../../src/aircraft/c208/powerplant';
import { fillSynthParams, gasGeneratorRpm, makeParamBlock, propLoad, SPEED_OF_SOUND, tipMach, TURBINE_LIT_ITT, turbineLit, turbineLoad, type SoundContext } from '../../src/audio/mapping';
import { P, STEM } from '../../src/audio/params';
import type { AudioProfile, PropSoundProfile } from '../../src/audio/profile';
import { HP, LB } from '../../src/core/math';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls, type AircraftState } from '../../src/core/types';
import { biquad, dbfs, interiorMix } from './mixModel';
import { envelope, maxStep, peak, rms, SR, SynthHost, toneMagnitude } from './workletHost';

const ENGINE = C208_AUDIO.engines[0].engine;
const TURBINE = ENGINE.turbine!;
/** Gas-generator speed at a fraction of 100 % Ng, rev/min (the turbine's `rpm` parameter). */
const ng = (fraction: number): number => fraction * PT6A_NG_RPM;
/** Gas-generator shaft rate at a fraction of 100 % Ng, Hz. */
const shaftHz = (fraction: number): number => ng(fraction) / 60;
/** 1900 propeller rpm, 106 in: tip Mach 0.79 standing still. */
const TAKE_OFF = { rpm: ng(1), firing: 1, load: 1, propRpm: 1900, tipMach: 0.79, propLoad: 1.6 };
/** Low idle, propeller feathered: a slow swish. */
const LOW_IDLE = { rpm: ng(0.52), firing: 1, load: 0.15, propRpm: 600, tipMach: 0.25, propLoad: 0.05 };
const band = (x: Float32Array, lo: number, hi: number): Float32Array => biquad(biquad(x, { type: 'highpass', frequency: lo, Q: 0 }), { type: 'lowpass', frequency: hi, Q: 0 });
const withProp = (edit: Partial<PropSoundProfile>): AudioProfile => ({ ...C208_AUDIO, engines: [{ engine: ENGINE, prop: { ...C208_AUDIO.engines[0].prop, ...edit } }] });
const engineStem = (params: Record<string, number>, seconds = 3, profile: AudioProfile = C208_AUDIO): Float32Array =>
  new SynthHost(profile).set(params).render(seconds)[STEM.engine].subarray(SR);

describe('C208_AUDIO', () => {
  it('is one PT6A-114A turbine behind its reduction gear, turning a three-blade 106 in propeller', () => {
    expect(C208_AUDIO.engines).toHaveLength(1);
    expect(ENGINE.combustion).toBe('turbine');
    expect(TURBINE.ngRpm).toBe(PT6A_NG_RPM);
    expect(ENGINE.gearRatio).toBe(PT6A_114A.gearRatio);
    expect(ENGINE.gearRatio).toBeCloseTo(33_000 / 1900, 9);
    expect(ENGINE.ratedPowerW).toBe(675 * HP);
    expect(ENGINE.turbo).toBeUndefined();
    // 390 lb/h at 100 % Ng (the gas generator's running line).
    expect(TURBINE.fuelFlowRef).toBeCloseTo((390 * LB) / 3600, 9);
    expect(C208_AUDIO.engines[0].prop.blades).toBe(C208_PROPELLER.blades);
    expect(C208_AUDIO.engines[0].prop.diameterM).toBe(C208_PROPELLER.diameter);
    // No tone of the whine lands on twice the shaft rate, where a four-cylinder engine on this crank speed would fire.
    expect(TURBINE.tones.map((t) => t.order)).not.toContain(2);
  });
});

describe('turbine voice', () => {
  it('is silent with the gas generator and the propeller stopped', () => {
    const stems = new SynthHost(C208_AUDIO).set({ rpm: 0, firing: 0, load: 0, propRpm: 0, tipMach: 0 }).render(2);
    expect(peak(stems[STEM.engine])).toBe(0);
    expect(peak(stems[STEM.prop])).toBe(0);
  }, 30_000);

  it('whines on the gas generator\'s speed: the compressor tone at five times the shaft rate, wherever Ng is', () => {
    for (const fraction of [0.52, 0.8, 1]) {
      const f = 5 * shaftHz(fraction);
      const x = engineStem({ rpm: ng(fraction), firing: 1, load: 0.4 });
      expect(toneMagnitude(x, f), `${fraction}`).toBeGreaterThan(20 * toneMagnitude(x, 1.03 * f));
      expect(toneMagnitude(x, f), `${fraction}`).toBeGreaterThan(20 * toneMagnitude(x, 0.97 * f));
      // The rotor's own tone at the shaft rate is there, softer.
      expect(toneMagnitude(x, shaftHz(fraction)), `${fraction}`).toBeGreaterThan(10 * toneMagnitude(x, 1.05 * shaftHz(fraction)));
      expect(toneMagnitude(x, shaftHz(fraction))).toBeLessThan(toneMagnitude(x, f));
    }
    // 3125 Hz at 100 % Ng, 1625 Hz at low idle.
    expect(5 * shaftHz(1)).toBeCloseTo(3125, 6);
    // Louder as the spool speeds up: Ng^1.5, so 52 % -> 100 % is +8.5 dB.
    const low = toneMagnitude(engineStem({ rpm: ng(0.52) }), 5 * shaftHz(0.52));
    const high = toneMagnitude(engineStem({ rpm: ng(1) }), 5 * shaftHz(1));
    expect(dbfs(high) - dbfs(low)).toBeCloseTo(20 * Math.log10(Math.pow(1 / 0.52, 1.5)), 0);
  }, 60_000);

  it('does not pulse: no firing lines, a steady envelope where a piston engine thumps', () => {
    // At 2400 "rpm" a flat four fires at 80 Hz; the turbine voice given the same numbers has nothing at the firing
    // frequency or its multiples (its tones are at 40, 200, 480, 720 Hz on that shaft rate).
    const run = { rpm: 2400, firing: 1, load: 1, throttle: 1 };
    const turbine = engineStem(run);
    const piston = engineStem(run, 3, C172S_AUDIO);
    for (const hz of [80, 160, 240, 320]) {
      expect(toneMagnitude(piston, hz)).toBeGreaterThan(10 * toneMagnitude(piston, hz + 7));
      expect(toneMagnitude(turbine, hz), `${hz}`).toBeLessThan(2 * toneMagnitude(turbine, hz + 7));
    }
    // At idle a piston engine's pulses come 37 ms apart (800 rpm): its loudness over 5 ms windows swings with
    // them. The turbine's (whine and roar) hardly moves.
    const unsteadiness = (x: Float32Array): number => {
      const env = envelope(band(x, 60, 2500), 0.005);
      const mean = env.reduce((a, v) => a + v, 0) / env.length;
      return Math.sqrt(env.reduce((a, v) => a + (v - mean) ** 2, 0) / env.length) / mean;
    };
    const turbineIdle = unsteadiness(engineStem(LOW_IDLE));
    const pistonIdle = unsteadiness(engineStem({ rpm: 800, firing: 1, load: 0.08, throttle: 0.08 }, 3, C172S_AUDIO));
    expect(turbineIdle).toBeLessThan(0.2);
    expect(pistonIdle).toBeGreaterThan(3 * turbineIdle);
    expect(unsteadiness(engineStem(TAKE_OFF))).toBeLessThan(0.2);
  }, 60_000);

  it('roars with what the burner burns, and not at all while it is out', () => {
    // The burner alone: the profile without its whine.
    const roarOnly: AudioProfile = { ...C208_AUDIO, engines: [{ engine: { ...ENGINE, turbine: { ...TURBINE, tones: [] } }, prop: C208_AUDIO.engines[0].prop }] };
    const roar = (load: number, firing = 1): number => dbfs(rms(engineStem({ rpm: ng(0.52), firing, load }, 3, roarOnly)));
    const idle = roar(0.15);
    const full = roar(1);
    expect(full - idle).toBeGreaterThan(5);
    expect(full - idle).toBeLessThan(14);
    expect(roar(0.5)).toBeGreaterThan(idle + 2);
    expect(roar(0.5)).toBeLessThan(full - 1);
    // The same spool unlit (the starter turning it, a hung start, a run-down): nothing but the whine.
    expect(roar(0.5, 0)).toBe(-180);
  }, 60_000);

  it('on a start: the starter-generator whines and the spool rises from silence, no roar until light-off, a soft thud then', () => {
    const host = new SynthHost(C208_AUDIO).set({ starter: 1 });
    // The starter turns the spool up to 15 % Ng over three seconds.
    const ramp: Float32Array[] = [];
    for (let k = 1; k <= 30; k++) ramp.push(host.set({ starter: 1, rpm: ng((0.15 * k) / 30) }).render(0.1)[STEM.engine]);
    const levels = ramp.map((x) => rms(x));
    expect(levels[29]).toBeGreaterThan(2 * levels[2]);
    const motoring = host.set({ starter: 1, rpm: ng(0.15) }).render(1)[STEM.engine];
    // The commutator at nine times the shaft rate (844 Hz at 15 % Ng), the compressor at five (469 Hz).
    expect(toneMagnitude(motoring, 9 * shaftHz(0.15))).toBeGreaterThan(10 * toneMagnitude(motoring, 9.4 * shaftHz(0.15)));
    expect(toneMagnitude(motoring, 5 * shaftHz(0.15))).toBeGreaterThan(10 * toneMagnitude(motoring, 5.4 * shaftHz(0.15)));
    const low = (x: Float32Array, from: number, to: number): number => rms(band(x.subarray(from * SR, to * SR), 25, 70));
    const before = low(motoring, 0, 1);
    // Light-off: the burner alight at 15 % Ng. A low thud, then the roar building.
    const lit = host.set({ starter: 1, rpm: ng(0.15), firing: 1, load: 0.12 }).render(2)[STEM.engine];
    const thud = low(lit, 0, 0.4);
    expect(thud).toBeGreaterThan(5 * before);
    expect(thud).toBeGreaterThan(2 * low(lit, 1.5, 2));
    // Smooth: no click at light-off, the first 20 ms step no further between samples than the steady roar does.
    expect(maxStep(lit, 1, 0.02 * SR)).toBeLessThan(maxStep(lit, 1.5 * SR, 2 * SR));
    // A session that starts with the engine alight (or a relight high up the spool) has no thud.
    const running = new SynthHost(C208_AUDIO).set({ rpm: ng(0.15), firing: 1, load: 0.12 }).render(2)[STEM.engine];
    expect(low(running, 0, 0.4)).toBeLessThan(1.3 * low(running, 1.5, 2));
  }, 60_000);

  it('winds down with the spool after shutdown: the burner gone at once, the whine falling in pitch', () => {
    /** Low idle, then fuel off: the spool coasts from 52 % to 20 % (the flight model's run-down, tens of seconds, here compressed). */
    const shutdown = (profile: AudioProfile): { first: Float32Array; last: Float32Array } => {
      const host = new SynthHost(profile).set(LOW_IDLE);
      host.render(1);
      const first = host.set({ ...LOW_IDLE, firing: 0, load: 0 }).render(0.1)[STEM.engine];
      for (let k = 1; k <= 20; k++) host.set({ ...LOW_IDLE, firing: 0, load: 0, rpm: ng(0.52 - (0.32 * k) / 20) }).render(0.1);
      return { first, last: host.render(1)[STEM.engine] };
    };
    const { last } = shutdown(C208_AUDIO);
    expect(toneMagnitude(last, 5 * shaftHz(0.2))).toBeGreaterThan(20 * toneMagnitude(last, 5 * shaftHz(0.52)));
    expect(rms(last)).toBeGreaterThan(0);
    // The roar (the profile without its whine and its gearbox) has gone.
    const burnerOnly: AudioProfile = { ...C208_AUDIO, engines: [{ engine: { ...ENGINE, turbine: { ...TURBINE, tones: [], gearMesh: { ...TURBINE.gearMesh, level: 0 } } }, prop: C208_AUDIO.engines[0].prop }] };
    const burner = shutdown(burnerOnly);
    expect(rms(burner.first)).toBeGreaterThan(0.005);
    expect(rms(burner.last)).toBeLessThan(1e-4 * rms(burner.first));
  }, 60_000);
});

describe('turboprop propeller', () => {
  it('drones at three times 1900 rpm, 95 Hz, and dominates the cockpit at power', () => {
    const stems = new SynthHost(C208_AUDIO).set(TAKE_OFF).render(3).map((x) => x.subarray(SR));
    const prop = stems[STEM.prop];
    expect(toneMagnitude(prop, 95)).toBeGreaterThan(20 * toneMagnitude(prop, 100));
    expect(toneMagnitude(prop, 190)).toBeGreaterThan(10 * toneMagnitude(prop, 180));
    const silent = stems[0].map(() => 0);
    const propInside = rms(interiorMix([silent, prop, silent, silent], C208_AUDIO));
    const engineInside = rms(interiorMix([stems[STEM.engine], silent, silent, silent], C208_AUDIO));
    expect(dbfs(propInside) - dbfs(engineInside)).toBeGreaterThan(8);
    // Feathered at low idle, the propeller is a soft swish under the whine.
    const idle = new SynthHost(C208_AUDIO).set(LOW_IDLE).render(3).map((x) => x.subarray(SR));
    expect(dbfs(rms(idle[STEM.prop]))).toBeLessThan(dbfs(rms(idle[STEM.engine])) - 15);
  }, 60_000);

  it('growls: lines at the shaft rate between the blade-passage harmonics, deeper with thrust', () => {
    // 1900 rpm: shaft rate 31.67 Hz; the growl's lines at 63.3 and 126.7 Hz beside the 95 Hz blade passage.
    const shaft = 1900 / 60;
    const prop = (profile: AudioProfile, propLoad: number): Float32Array => new SynthHost(profile).set({ ...TAKE_OFF, propLoad }).render(4)[STEM.prop].subarray(SR);
    const smooth = prop(withProp({ growl: 0 }), 1.6);
    const growl = prop(C208_AUDIO, 1.6);
    for (const k of [2, 4]) {
      expect(toneMagnitude(growl, k * shaft), `${k}`).toBeGreaterThan(5 * toneMagnitude(smooth, k * shaft));
      expect(toneMagnitude(growl, k * shaft), `${k}`).toBeGreaterThan(5 * toneMagnitude(growl, (k + 0.5) * shaft));
    }
    // The blade passage itself is unchanged.
    expect(toneMagnitude(growl, 3 * shaft) / toneMagnitude(smooth, 3 * shaft)).toBeCloseTo(1, 1);
    // Relative to the blade passage, the growl at light load is shallower.
    const light = prop(C208_AUDIO, 0.2);
    const depth = (x: Float32Array): number => toneMagnitude(x, 2 * shaft) / toneMagnitude(x, 3 * shaft);
    expect(depth(light)).toBeLessThan(0.7 * depth(growl));
  }, 60_000);
});

describe('C208 mix', () => {
  it('full power on the ground sits in the cockpit level window of the C172S (-17 .. -9 dBFS), nothing clips', () => {
    const stems = new SynthHost(C208_AUDIO).set(TAKE_OFF).render(4);
    const interior = interiorMix(stems, C208_AUDIO);
    const level = dbfs(rms(interior, SR));
    expect(level).toBeGreaterThan(-17);
    expect(level).toBeLessThan(-9);
    expect(dbfs(peak(interior.subarray(SR)))).toBeLessThan(-2);
  }, 30_000);
});

describe('turbine mapping', () => {
  const sound = (): SoundContext => ({ surface: 'runway', speedOfSound: SPEED_OF_SOUND, turbulence: 0, gyroSpin: 0, flapMotor: 0 });
  const LB_H = LB / 3600;
  /** A PT6A at `ngPercent` with the propeller at `propRpm`. */
  const caravan = (ngPercent: number, o: { running?: boolean; fuelLbH?: number; itt?: number; shp?: number; propRpm?: number; thrust?: number } = {}): AircraftState => {
    const s = makeMockState();
    const propRpm = o.propRpm ?? 1900;
    Object.assign(s.engine, {
      running: o.running ?? true,
      ng: ngPercent,
      itt: o.itt ?? 600,
      rpm: propRpm * PT6A_114A.gearRatio,
      propRpm,
      fuelFlow: (o.fuelLbH ?? 300) * LB_H,
      power: (o.shp ?? 500) * HP,
      // A piston engine would read these: the turbine does not.
      manifoldPressure: 29.9,
    });
    Object.assign(s.propeller, { rpm: propRpm, thrust: o.thrust ?? 3500 });
    return s;
  };
  const fill = (s: AircraftState, starter = false): Float32Array => {
    const c = defaultControls();
    c.masterBattery = true;
    c.starter = starter;
    c.throttle = 0.7;
    c.mixture = 1;
    c.magnetos = 3;
    s.electrical.busVoltage = 28;
    return fillSynthParams(s, c, sound(), makeParamBlock(), C208_AUDIO);
  };
  const f32 = Math.fround;

  it('sends the gas generator\'s speed as `rpm`, what the burner burns as `load`, the propeller apart', () => {
    const s = caravan(95, { fuelLbH: 330, shp: 600 });
    const out = fill(s);
    expect(out[P.rpm]).toBe(f32(0.95 * PT6A_NG_RPM));
    expect(gasGeneratorRpm(95, TURBINE)).toBe(0.95 * PT6A_NG_RPM);
    expect(out[P.firing]).toBe(1);
    expect(out[P.load]).toBe(f32(0.6 * (330 * LB_H) / TURBINE.fuelFlowRef + (0.4 * 600) / 675));
    expect(out[P.load]).toBe(f32(turbineLoad(330 * LB_H, 600 * HP, true, ENGINE)));
    // No throttle plate, no mixture, no magnetos, no turbocharger.
    expect(out[P.throttle]).toBe(0);
    expect(out[P.roughness]).toBe(0);
    expect(out[P.turbo]).toBe(0);
    expect(out[P.propRpm]).toBe(1900);
    expect(out[P.tipMach]).toBe(f32(tipMach(1900, s.tas, SPEED_OF_SOUND, C208_AUDIO.engines[0].prop)));
    expect(out[P.propLoad]).toBe(f32(propLoad(3500, C208_AUDIO.engines[0].prop)));
    // Low idle burns about a fifth of the full-power fuel for little shaft power: a soft roar, not none.
    expect(turbineLoad(85 * LB_H, 10 * HP, true, ENGINE)).toBeGreaterThan(0.1);
    expect(turbineLoad(85 * LB_H, 10 * HP, true, ENGINE)).toBeLessThan(0.2);
    // Full power: about one.
    expect(turbineLoad(TURBINE.fuelFlowRef, ENGINE.ratedPowerW, true, ENGINE)).toBeCloseTo(1, 9);
  });

  it('a start: the starter turns the spool, the burner counts as lit once fuel flows and the ITT climbs', () => {
    // Motoring at 14 % Ng, no fuel yet: no cranking floor (the spool's own speed), unlit, no load.
    let out = fill(caravan(14, { running: false, fuelLbH: 0, itt: 30, shp: 0, propRpm: 0, thrust: 0 }), true);
    expect(out[P.rpm]).toBe(f32(0.14 * PT6A_NG_RPM));
    expect(out[P.starter]).toBe(1);
    expect(out[P.firing]).toBe(0);
    expect(out[P.load]).toBe(0);
    // Fuel on, not yet alight (the ITT still cold): unlit.
    out = fill(caravan(14, { running: false, fuelLbH: 25, itt: 60, shp: 0, propRpm: 0, thrust: 0 }), true);
    expect(out[P.firing]).toBe(0);
    // Alight below the running Ng (45 %): the ITT is up, it is lit.
    out = fill(caravan(25, { running: false, fuelLbH: 50, itt: 700, shp: 0, propRpm: 200, thrust: 0 }), true);
    expect(out[P.firing]).toBe(1);
    expect(out[P.load]).toBeGreaterThan(0);
    expect(turbineLit(false, 0.01, TURBINE_LIT_ITT + 1)).toBe(true);
    expect(turbineLit(false, 0, 900)).toBe(false);
    expect(turbineLit(true, 0, undefined)).toBe(true);
    // Shut down and coasting: the ITT still hot, but no fuel: unlit, the spool's speed still sent.
    out = fill(caravan(30, { running: false, fuelLbH: 0, itt: 500, shp: 0, propRpm: 400, thrust: 0 }));
    expect(out[P.firing]).toBe(0);
    expect(out[P.rpm]).toBe(f32(0.3 * PT6A_NG_RPM));
    // A state without Ng (a flight model that does not give it): the spool is silent.
    const s = caravan(50);
    delete s.engine.ng;
    expect(fill(s)[P.rpm]).toBe(0);
  });
});
