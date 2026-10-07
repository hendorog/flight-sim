// The engine and propeller voices no Cessna 172S has: a propeller behind a reduction gear, three blades, a
// diesel's combustion, a turbocharger, six cylinders. Each on the per-sample path (one engine) and, where it
// differs, on the per-block path (two engines).

import { describe, expect, it } from 'vitest';
import { STEM } from '../../src/audio/params';
import type { AudioProfile } from '../../src/audio/profile';
import { biquad, dbfs } from './mixModel';
import { variant } from './profiles';
import { DIESEL_AUDIO_TESTBED, DIESEL_ENGINE_TESTBED, DIESEL_GEAR_RATIO, DIESEL_SINGLE_TESTBED } from './testbed';
import { rms, SR, SynthHost, toneMagnitude } from './workletHost';

/** The diesel test-bed engine at take-off power: 2300 propeller rpm (the DA42 NG's limit) through the 1.69 gearbox. */
const PROP_RPM = 2300;
const CRANK_RPM = PROP_RPM * DIESEL_GEAR_RATIO;
const takeOff = { rpm: CRANK_RPM, propRpm: PROP_RPM, firing: 1, load: 1, throttle: 1, propLoad: 1.4, tipMach: 0.66, turbo: 1 };
/** Four-stroke: every cylinder fires once in two crank revolutions. */
const firingHz = (crankRpm: number, cylinders: number): number => (crankRpm / 60) * (cylinders / 2);
const bladeHz = (propRpm: number, blades: number): number => (propRpm / 60) * blades;

/** The test-bed diesel with some members changed, alone on the Cessna 172S airframe. */
const single = (edit: Partial<AudioProfile['engines'][number]['engine']>): AudioProfile => ({
  ...DIESEL_SINGLE_TESTBED,
  engines: [{ engine: { ...DIESEL_ENGINE_TESTBED, level: 1, ...edit }, prop: DIESEL_SINGLE_TESTBED.engines[0].prop }],
});
const knockBand = (x: Float32Array): number => dbfs(rms(biquad(biquad(x, { type: 'highpass', frequency: 1500, Q: 0 }), { type: 'lowpass', frequency: 5000, Q: 0 }), SR));

describe('geared three-blade propeller', () => {
  it('the blade passage is at three times the propeller speed, the firing at twice the crank speed', () => {
    // 2300 propeller rpm x 1.69 = 3887 crank rpm: firing 129.57 Hz, blade passage 115 Hz. Locked to the crank
    // (the direct-drive rule) three blades would sound at 194.35 Hz.
    expect(firingHz(CRANK_RPM, 4)).toBeCloseTo(129.57, 2);
    expect(bladeHz(PROP_RPM, 3)).toBeCloseTo(115, 6);
    const hosts = {
      'one engine': new SynthHost(DIESEL_SINGLE_TESTBED).set(takeOff),
      'two engines': new SynthHost(DIESEL_AUDIO_TESTBED).setEngine(0, takeOff).setEngine(1, { ...takeOff, firing: 0, load: 0, throttle: 0, rpm: 0, propRpm: 0, tipMach: 0, turbo: 0 }),
    };
    for (const [name, host] of Object.entries(hosts)) {
      const stems = host.render(3);
      const engine = stems[STEM.engine].subarray(SR);
      const prop = stems[STEM.prop].subarray(SR);
      expect(toneMagnitude(engine, 129.57), name).toBeGreaterThan(20 * toneMagnitude(engine, 115));
      expect(toneMagnitude(prop, 115), name).toBeGreaterThan(20 * toneMagnitude(prop, 129.57));
      expect(toneMagnitude(prop, 115), name).toBeGreaterThan(20 * toneMagnitude(prop, 194.35));
      // The second harmonic of the blade passage is there too.
      expect(toneMagnitude(prop, 230), name).toBeGreaterThan(20 * toneMagnitude(prop, 245));
    }
  }, 60_000);

  it('the propeller voice follows the propeller speed, whatever the crank does', () => {
    // A constant-speed propeller governed down to 1800 rpm: 90 Hz, with the crank parameter left where it was.
    const prop = new SynthHost(DIESEL_SINGLE_TESTBED).set({ ...takeOff, propRpm: 1800 }).render(3)[STEM.prop].subarray(SR);
    expect(toneMagnitude(prop, 90)).toBeGreaterThan(20 * toneMagnitude(prop, 115));
    // Direct drive (ratio 1) ignores the propeller-speed parameter: the blades stay on the crank.
    const direct = new SynthHost(variant((p) => void (p.engines[0].prop.blades = 3))).set({ rpm: 2400, propRpm: 1800, firing: 1, load: 0.8, throttle: 0.8, propLoad: 1, tipMach: 0.76 });
    const locked = direct.render(3)[STEM.prop].subarray(SR);
    expect(toneMagnitude(locked, 120)).toBeGreaterThan(20 * toneMagnitude(locked, 90));
  }, 60_000);

  it('two geared propellers beat at the difference of their blade-passage frequencies', () => {
    // 2300 and 2280 propeller rpm, three blades: 115 and 114 Hz, one beat a second.
    const second = { ...takeOff, rpm: 2280 * DIESEL_GEAR_RATIO, propRpm: 2280 };
    const prop = new SynthHost(DIESEL_AUDIO_TESTBED).setEngine(0, takeOff).setEngine(1, second).render(9)[STEM.prop].subarray(SR);
    expect(toneMagnitude(prop, 115)).toBeGreaterThan(8 * toneMagnitude(prop, 116.5));
    expect(toneMagnitude(prop, 114)).toBeGreaterThan(8 * toneMagnitude(prop, 112.5));
    const band = biquad(biquad(prop, { type: 'highpass', frequency: 95, Q: 0 }), { type: 'lowpass', frequency: 140, Q: 0 });
    const n = Math.round(0.025 * SR);
    const env = Float32Array.from({ length: Math.floor(band.length / n) }, (_, w) => rms(band, w * n, (w + 1) * n));
    const mean = env.reduce((a, v) => a + v, 0) / env.length;
    const swing = env.map((v) => v - mean);
    expect(toneMagnitude(swing, 1, 40)).toBeGreaterThan(6 * toneMagnitude(swing, 1.5, 40));
    expect(toneMagnitude(swing, 1, 40)).toBeGreaterThan(6 * toneMagnitude(swing, 0.5, 40));
  }, 30_000);
});

describe('diesel voice', () => {
  // The same engine with a spark's combustion, to compare with.
  const spark = single({ combustion: 'spark', turbo: undefined });
  const diesel = single({ turbo: undefined });
  /** Idle of the DA42 pattern: 710 propeller rpm, 1200 crank rpm. */
  const idle = { rpm: 1200, propRpm: 710, firing: 1, load: 0.08, throttle: 0.08 };
  const cruise = { rpm: 3500, propRpm: 2071, firing: 1, load: 0.75, throttle: 0.75 };

  it('knocks: more combustion noise than a spark engine, most of all at idle', () => {
    // The charge of a diesel lights by compression and burns at once: the steep pressure rise rings the
    // structure in the 1.5 to 5 kHz band, several decibels above a petrol engine, and the more so at low load.
    const at = (profile: AudioProfile, params: typeof idle): Float32Array => new SynthHost(profile).set(params).render(4)[STEM.engine];
    const idleGain = knockBand(at(diesel, idle)) - knockBand(at(spark, idle));
    const cruiseGain = knockBand(at(diesel, cruise)) - knockBand(at(spark, cruise));
    expect(idleGain).toBeGreaterThan(6);
    expect(idleGain).toBeLessThan(15);
    expect(cruiseGain).toBeGreaterThan(2);
    expect(cruiseGain).toBeLessThan(idleGain);
    // The exhaust note itself is no louder for it.
    expect(Math.abs(dbfs(rms(at(diesel, cruise), SR)) - dbfs(rms(at(spark, cruise), SR)))).toBeLessThan(2.5);
  }, 60_000);

  it('has a sharper exhaust pulse: stronger upper harmonics of the firing frequency', () => {
    // A shorter pulse of the same repetition rate spreads its energy to higher multiples of that rate.
    const f = firingHz(idle.rpm, 4);
    const upper = (profile: AudioProfile): number => {
      const x = new SynthHost(profile).set(idle).render(6)[STEM.engine].subarray(2 * SR);
      return (toneMagnitude(x, 4 * f) + toneMagnitude(x, 5 * f) + toneMagnitude(x, 6 * f)) / toneMagnitude(x, f);
    };
    expect(upper(diesel)).toBeGreaterThan(2 * upper(spark));
  }, 60_000);

  it('idles evenly: no lope, whatever the profile says', () => {
    // 800 crank rpm, firing 26.67 Hz. A spark engine told to lope below 1100 rpm wanders in speed, which
    // smears the firing line into its neighbourhood (1.5 % beside it); the diesel given the same number holds it.
    const slow = { rpm: 800, firing: 1, load: 0.06, throttle: 0.06 };
    const f = firingHz(800, 4);
    const smear = (profile: AudioProfile): number => {
      const x = new SynthHost(profile).set(slow).render(10)[STEM.engine].subarray(2 * SR);
      return toneMagnitude(x, 0.985 * f) / toneMagnitude(x, f);
    };
    const even = smear(single({ idleLopeRpm: 1100, turbo: undefined }));
    expect(even).toBeLessThan(0.02);
    expect(smear(single({ combustion: 'spark', idleLopeRpm: 1100, turbo: undefined }))).toBeGreaterThan(0.1);
    expect(even).toBe(smear(diesel));
  }, 60_000);

  it('the turbocharger whines at its speed, and the rotor takes its time', () => {
    // The test-bed's whine is at 2600 Hz with the rotor at full-load speed.
    const hz = DIESEL_ENGINE_TESTBED.turbo!.hzAtFullLoad;
    const engine = (host: SynthHost, seconds: number): Float32Array => host.render(seconds)[STEM.engine];
    // A start at power (an in-air start): the whine is there from the first second.
    const full = engine(new SynthHost(DIESEL_SINGLE_TESTBED).set(takeOff), 2).subarray(SR);
    const without = engine(new SynthHost(single({ turbo: undefined })).set(takeOff), 2).subarray(SR);
    // (The combustion knock is in the same band: that is what the whine has to stand out of.)
    expect(toneMagnitude(full, hz)).toBeGreaterThan(10 * toneMagnitude(without, hz));
    expect(toneMagnitude(full, hz)).toBeGreaterThan(10 * toneMagnitude(full, hz - 150));
    // Its strength is the profile's, relative to the voice (0.05 x the voice's 0.6; a sine of amplitude A reads A / 4).
    expect(toneMagnitude(full, hz) * 4).toBeCloseTo(0.05 * 0.6, 2);
    // At half speed the pitch is an octave lower and the whine a quarter as strong.
    const half = engine(new SynthHost(DIESEL_SINGLE_TESTBED).set({ ...takeOff, turbo: 0.5 }), 2).subarray(SR);
    expect(toneMagnitude(half, hz / 2)).toBeGreaterThan(3 * toneMagnitude(half, hz));
    expect(toneMagnitude(half, hz / 2) / toneMagnitude(full, hz)).toBeCloseTo(0.25, 1);
    // The rotor alone (engine stopped, so nothing else sounds), stepped from 30 % to full speed: a first-order
    // lag of half a second behind the 30 ms smoothing of every parameter is, after 0.5 s,
    // 1 - (0.5 e^-1 - 0.03 e^-16.7) / 0.47 = 60.9 % of the way: 0.726 of the full pitch. Seconds later it is there.
    const host = new SynthHost(DIESEL_SINGLE_TESTBED).set({ turbo: 0.3 });
    host.render(1);
    host.set({ turbo: 1 });
    /** Pitch from the zero crossings of a stretch of the whine, Hz. */
    const pitch = (x: Float32Array): number => {
      let crossings = 0;
      for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 !== x[i] < 0) crossings++;
      return (crossings / 2 / x.length) * SR;
    };
    const rising = engine(host, 0.6);
    expect(pitch(rising.subarray(0.49 * SR, 0.51 * SR)) / hz).toBeCloseTo(0.726, 2);
    expect(pitch(rising.subarray(0.09 * SR, 0.11 * SR)) / hz).toBeLessThan(0.45);
    expect(pitch(engine(host, 4.4).subarray(3.4 * SR)) / hz).toBeCloseTo(1, 2);
    // The second engine of a twin has a whine of its own, at its own rotor speed.
    // (Its parameters arrive after the first block here, so its rotor spins up: listen once it is there.)
    const twin = new SynthHost(DIESEL_AUDIO_TESTBED).setEngine(0, takeOff).setEngine(1, { ...takeOff, turbo: 0.8 }).render(6)[STEM.engine].subarray(5 * SR);
    expect(toneMagnitude(twin, hz)).toBeGreaterThan(10 * toneMagnitude(twin, 0.9 * hz));
    expect(toneMagnitude(twin, 0.8 * hz)).toBeGreaterThan(10 * toneMagnitude(twin, 0.9 * hz));
  }, 30_000);
});

describe('six cylinders', () => {
  it('fire three times per crank revolution', () => {
    // 2400 rpm: a six fires at 120 Hz where the four fires at 80 Hz.
    expect(firingHz(2400, 6)).toBe(120);
    const six = variant((p) => {
      p.engines[0].engine.cylinders = 6;
      p.engines[0].engine.firingOffsets = [0, 0.006, -0.004, 0.005, -0.006, 0.003];
      p.engines[0].engine.cylGains = [1, 0.9, 0.95, 0.85, 0.92, 0.88];
    });
    const run = { rpm: 2400, firing: 1, load: 0.8, throttle: 0.8 };
    const e6 = new SynthHost(six).set(run).render(3)[STEM.engine].subarray(SR);
    const e4 = new SynthHost().set(run).render(3)[STEM.engine].subarray(SR);
    expect(toneMagnitude(e6, 120)).toBeGreaterThan(20 * toneMagnitude(e6, 90));
    expect(toneMagnitude(e6, 120)).toBeGreaterThan(20 * toneMagnitude(e6, 80));
    expect(toneMagnitude(e4, 80)).toBeGreaterThan(20 * toneMagnitude(e4, 90));
    // The cycle of six slightly unequal cylinders repeats every two revolutions (20 Hz): its multiples that
    // are not multiples of 120 (40, 60, 100 Hz ...) are there, far below the firing line.
    for (const hz of [40, 60, 100]) {
      expect(toneMagnitude(e6, hz)).toBeGreaterThan(3 * toneMagnitude(e6, 90));
      expect(toneMagnitude(e6, hz)).toBeLessThan(0.1 * toneMagnitude(e6, 120));
    }
  }, 60_000);
});
