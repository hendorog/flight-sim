// Two engines: a second engine and propeller voice with parameters and noise sources of their own, the beat
// of two propellers that are not synchronised, the level of two voices, the per-block synthesis path against
// the per-sample one, and the cost of the second voice.

import { describe, expect, it } from 'vitest';
import { STEM, STEM_COUNT, type EngineParamName, type SynthParamName } from '../../src/audio/params';
import { biquad, dbfs, exteriorMix, interiorMix } from './mixModel';
import { variant } from './profiles';
import { TWIN_AUDIO_TESTBED, TWIN_VOICE_LEVEL } from './testbed';
import { BLOCK, envelope, peak, rms, SR, SynthHost, toneMagnitude } from './workletHost';

const cruise = { rpm: 2400, firing: 1, load: 0.8, throttle: 0.8, propLoad: 1, tipMach: 0.76 };
/** The Cessna 172S at full power on the runway (what the flight model gives the mapping there). */
const fullPower = { rpm: 2330, firing: 1, load: 1, throttle: 1, propLoad: 1.57, tipMach: 0.69 };
const off = { rpm: 0, firing: 0, load: 0, throttle: 0, propLoad: 0, tipMach: 0 };

const twin = (first: Partial<Record<EngineParamName, number>>, second: Partial<Record<EngineParamName, number>>, shared: Partial<Record<SynthParamName, number>> = {}): SynthHost =>
  new SynthHost(TWIN_AUDIO_TESTBED).set(shared).setEngine(0, first).setEngine(1, second);

/** Samples of the stems `a` that are not the same number in `b`. */
function differing(a: Float32Array[], b: Float32Array[]): number {
  let n = 0;
  for (let s = 0; s < a.length; s++) for (let i = 0; i < a[s].length; i++) if (!Object.is(a[s][i], b[s][i])) n++;
  return n;
}

/** The loudness envelope (25 ms windows, 40 per second) of the band around `hz`, its mean removed. */
function bandEnvelope(x: Float32Array, hz: number): Float32Array {
  const band = biquad(biquad(x, { type: 'highpass', frequency: hz * 0.8, Q: 0 }), { type: 'lowpass', frequency: hz * 1.25, Q: 0 });
  const env = envelope(band.subarray(SR), 0.025);
  const mean = env.reduce((a, v) => a + v, 0) / env.length;
  return env.map((v) => v - mean);
}

describe('two engine voices', () => {
  it('each engine plays its own firing frequency and each propeller its own blade passage', () => {
    // A four-stroke four fires twice per crank revolution: 2400 rpm = 40 rev/s = 80 Hz, 2520 rpm = 84 Hz. A
    // two-blade direct-drive propeller passes a blade at the same two frequencies.
    const stems = twin(cruise, { ...cruise, rpm: 2520 }).render(4);
    const swapped = twin({ ...cruise, rpm: 2520 }, cruise).render(4);
    for (const stem of [STEM.engine, STEM.prop]) {
      const x = stems[stem].subarray(SR);
      const y = swapped[stem].subarray(SR);
      const between = toneMagnitude(x, 82);
      expect(toneMagnitude(x, 80)).toBeGreaterThan(8 * between);
      expect(toneMagnitude(x, 84)).toBeGreaterThan(8 * between);
      // Left and right are the same voice: exchanging the two engines exchanges the two lines.
      expect(toneMagnitude(y, 80) / toneMagnitude(x, 84)).toBeGreaterThan(0.8);
      expect(toneMagnitude(y, 80) / toneMagnitude(x, 84)).toBeLessThan(1.25);
      expect(toneMagnitude(y, 84) / toneMagnitude(x, 80)).toBeGreaterThan(0.8);
      expect(toneMagnitude(y, 84) / toneMagnitude(x, 80)).toBeLessThan(1.25);
    }
    // One engine shut down and its propeller stopped: only the live engine's lines are left.
    const one = twin(off, { ...cruise, rpm: 2520 }).render(3);
    for (const stem of [STEM.engine, STEM.prop]) {
      const x = one[stem].subarray(SR);
      expect(toneMagnitude(x, 84)).toBeGreaterThan(20 * toneMagnitude(x, 80));
    }
  }, 30_000);

  it('two propellers that are not synchronised beat at the difference of their blade-passage frequencies', () => {
    // sin a + sin b = 2 sin((a + b) / 2) cos((a - b) / 2): the loudness of two equal tones swells and fades
    // |f1 - f2| times a second. 2400 and 2430 rpm: 80 and 81 Hz, one beat a second; 2400 and 2460: two.
    const stems = new Map([2400, 2430, 2460].map((rpm2) => [rpm2, twin(cruise, { ...cruise, rpm: rpm2 }).render(9)]));
    for (const stem of [STEM.prop, STEM.engine]) {
      const envelopes = new Map([...stems].map(([rpm2, x]) => [rpm2, bandEnvelope(x[stem], 80)]));
      const beat = (rpm2: number, hz: number): number => toneMagnitude(envelopes.get(rpm2)!, hz, 40);
      const one = beat(2430, 1);
      expect(one).toBeGreaterThan(6 * beat(2430, 1.5));
      expect(one).toBeGreaterThan(6 * beat(2430, 0.5));
      const two = beat(2460, 2);
      expect(two).toBeGreaterThan(6 * beat(2460, 1));
      expect(two).toBeGreaterThan(6 * beat(2460, 3));
      // Synchronised propellers do not beat.
      expect(beat(2400, 1)).toBeLessThan(one / 6);
    }
    // The beat is deep: the two equal blade-passage tones nearly cancel once a second.
    const prop = biquad(biquad(stems.get(2430)![STEM.prop], { type: 'highpass', frequency: 64, Q: 0 }), { type: 'lowpass', frequency: 100, Q: 0 });
    const env = envelope(prop.subarray(SR), 0.025);
    expect(Math.min(...env)).toBeLessThan(0.25 * Math.max(...env));
  }, 60_000);

  it('the second voice has noise sources of its own: it changes nothing else', () => {
    // Everything that draws noise is on: wind, slip, flaps, buffet, tyres on gravel, skid, the reed, the flap
    // motor, the fan. With the right engine running or stopped the airframe and cabin stems are the same samples.
    const busy = { windLevel: 1, windFreq: 700, slip: 0.5, flapNoise: 0.5, buffet: 0.5, horn: 0.6, flapMotor: 1, rolling: 0.8, rollSpeed: 20, surface: 2, skid: 0.4, gyro: 1, fan: 1, turbulence: 0.4 };
    const reed = variant((p) => void (p.engines = [p.engines[0], p.engines[0]]));
    const host = (second: Partial<Record<EngineParamName, number>>): SynthHost => new SynthHost(reed).set(busy).setEngine(0, cruise).setEngine(1, second);
    const both = host({ ...cruise, rpm: 2470 }).render(2);
    const left = host(off).render(2);
    for (const stem of [STEM.airframe, STEM.cabin]) expect(rms(both[stem])).toBeGreaterThan(0.01);
    expect(differing([both[STEM.airframe], both[STEM.cabin]], [left[STEM.airframe], left[STEM.cabin]])).toBe(0);
    expect(rms(both[STEM.engine])).toBeGreaterThan(1.2 * rms(left[STEM.engine]));
  }, 60_000);

  it('the per-block path of two engines plays what the per-sample path of one plays', () => {
    // The same voice twice with the second one stopped, against the voice alone: engine 0 draws from the shared
    // noise in both, so the two paths can be compared sample by sample.
    const single = variant();
    const pair = variant((p) => void (p.engines = [p.engines[0], p.engines[0]]));
    const air = { windLevel: 1, windFreq: 700, gyro: 1, fan: 1, turbulence: 0.2 };
    const a = new SynthHost(single).set({ ...cruise, ...air }).render(2);
    const b = new SynthHost(pair).set({ ...cruise, ...air }).render(2);
    // Steady state: the ramps have arrived, and what is left is rounding (the harmonics by recurrence).
    for (let s = 0; s < STEM_COUNT; s++) {
      let worst = 0;
      for (let i = SR / 2; i < a[s].length; i++) worst = Math.max(worst, Math.abs(a[s][i] - b[s][i]));
      expect(worst, `stem ${s}`).toBeLessThan(1e-5);
    }

    // A start, a slam to full power and a shut-down: the per-block weights are ramped between the values the
    // per-sample path has at the ends of each render quantum (2.7 ms), so every 50 ms of both stems is within
    // a fraction of a decibel.
    const script: [number, Partial<Record<SynthParamName, number>>][] = [
      [0, { starter: 1, rpm: 170, throttle: 0.1 }],
      [0.5, { firing: 1, rpm: 750, load: 0.08, roughness: 0.4, propLoad: 0.1, tipMach: 0.2 }],
      [0.8, { starter: 0, roughness: 0 }],
      [1.4, { rpm: 2300, load: 1, throttle: 1, propLoad: 1.5, tipMach: 0.7 }],
      [2.4, { rpm: 1400, load: 0.3, throttle: 0.3, propLoad: 0.5, tipMach: 0.42 }],
      [3.2, { firing: 0, load: 0, throttle: 0 }],
      [3.5, { rpm: 300, tipMach: 0.05, propLoad: 0 }],
    ];
    const play = (host: SynthHost): Float32Array[] => {
      const blocks = (4 * SR) / BLOCK;
      const stems = Array.from({ length: STEM_COUNT }, () => new Float32Array(blocks * BLOCK));
      let next = 0;
      for (let k = 0; k < blocks; k++) {
        while (next < script.length && script[next][0] <= (k * BLOCK) / SR) host.set(script[next++][1]);
        const out = host.block();
        for (let s = 0; s < STEM_COUNT; s++) stems[s].set(out[s], k * BLOCK);
      }
      return stems;
    };
    const x = play(new SynthHost(single));
    const y = play(new SynthHost(pair));
    for (const stem of [STEM.engine, STEM.prop]) {
      const ex = envelope(x[stem], 0.05);
      const ey = envelope(y[stem], 0.05);
      expect(Math.max(...ex)).toBeGreaterThan(0.1);
      for (let w = 0; w < ex.length; w++) {
        if (ex[w] < 1e-3) expect(ey[w], `stem ${stem} at ${w * 0.05} s`).toBeLessThan(2e-3);
        else expect(Math.abs(dbfs(ey[w]) - dbfs(ex[w])), `stem ${stem} at ${w * 0.05} s`).toBeLessThan(0.5);
      }
    }
  }, 30_000);

  it('two voices at 0.71 carry the power of one, and full power stays in the cockpit level window', () => {
    // Powers of sources that are not in step add: 2 x 0.71^2 = 1.008 of one voice (+0.03 dB).
    expect(2 * TWIN_VOICE_LEVEL ** 2).toBeCloseTo(1, 1);
    const one = new SynthHost().set(fullPower).render(7);
    const two = twin(fullPower, { ...fullPower, rpm: 2301 }).render(7);
    for (const stem of [STEM.engine, STEM.prop]) expect(Math.abs(dbfs(rms(two[stem], SR)) - dbfs(rms(one[stem], SR)))).toBeLessThan(0.7);
    const interior = interiorMix(two, TWIN_AUDIO_TESTBED);
    const exterior = exteriorMix(two, 15, TWIN_AUDIO_TESTBED);
    // The window of the Cessna 172S at full power (levels.test.ts). Nothing clips ahead of the limiter; outside,
    // the crests of two voices that momentarily line up come within 2 dB of full scale (one voice: 4 dB), which
    // is the limiter's work and the `exterior.level` of a real twin's profile to settle.
    expect(dbfs(rms(interior, SR))).toBeGreaterThan(-17);
    expect(dbfs(rms(interior, SR))).toBeLessThan(-9);
    expect(dbfs(peak(interior.subarray(SR)))).toBeLessThan(-2);
    expect(dbfs(peak(exterior.subarray(SR)))).toBeLessThan(0);
    // The loudest case there is, both engines exactly in step, is at most 3 dB more.
    const inStep = interiorMix(twin(fullPower, fullPower).render(3), TWIN_AUDIO_TESTBED);
    expect(dbfs(rms(inStep, SR))).toBeLessThan(dbfs(rms(interior, SR)) + 3.1);
    expect(dbfs(rms(inStep, SR))).toBeLessThan(-9);
  }, 30_000);

  it('is silent with everything off and bounded with everything at maximum', () => {
    for (const s of new SynthHost(TWIN_AUDIO_TESTBED).set({}).render(0.5)) expect(peak(s)).toBe(0);
    const all = { windLevel: 2.5, windFreq: 900, slip: 1, flapNoise: 1, buffet: 1, horn: 1, rolling: 1.2, rollSpeed: 30, surface: 2, brakeSqueal: 1, skid: 1, gyro: 1, fan: 1, flapMotor: 1, turbulence: 1, gearPump: 1, gearHorn: 1, gearWind: 2.5 };
    const h = twin({ ...cruise, starter: 1, turbo: 1, propRpm: 2400 }, { ...cruise, starter: 1, turbo: 1, propRpm: 2400 }, all);
    h.message({ type: 'crash', amp: 1 });
    h.message({ type: 'chirp', amp: 1.8 });
    h.message({ type: 'thump', amp: 1 });
    for (const s of h.render(2)) {
      expect(s.every(Number.isFinite)).toBe(true);
      expect(peak(s)).toBeLessThan(6);
    }
  }, 60_000);

  it('two engines cost at most 1.7 times the Cessna 172S to render', () => {
    // In flight: both engines and propellers, wind, gyros and the fan. The minimum of five renders of one second.
    const air = { windLevel: 1.2, windFreq: 750, gyro: 1, fan: 1, turbulence: 0.2 };
    const cost = (make: () => SynthHost): number => {
      let best = Infinity;
      for (let i = 0; i < 5; i++) {
        const host = make();
        host.render(0.5);
        const t = performance.now();
        host.render(1);
        best = Math.min(best, performance.now() - t);
      }
      return best;
    };
    const single = (): SynthHost => new SynthHost().set({ ...cruise, ...air });
    const pair = (): SynthHost => twin(cruise, { ...cruise, rpm: 2430 }, air);
    cost(single);
    cost(pair);
    const one = cost(single);
    const two = cost(pair);
    console.log(`[audio] render cost per second of audio: Cessna 172S ${(one / 1000).toFixed(4)} s, two engines ${(two / 1000).toFixed(4)} s, ratio ${(two / one).toFixed(2)}`);
    expect(two / one).toBeLessThan(1.7);
  }, 120_000);
});
