// The sounds of a retractable landing gear (hydraulic pump, warning horn or chime, the legs in the airflow,
// the thump of the locks) and the electric stall warner. None of them is reachable with the Cessna 172S profile.

import { describe, expect, it } from 'vitest';
import { STEM } from '../../src/audio/params';
import type { AudioProfile } from '../../src/audio/profile';
import { biquad, dbfs } from './mixModel';
import { DIESEL_AUDIO_TESTBED, TWIN_AUDIO_TESTBED } from './testbed';
import { envelope, maxStep, peak, rms, SR, SynthHost, toneMagnitude } from './workletHost';

const gearOf = (profile: AudioProfile, edit: Partial<NonNullable<AudioProfile['gear']>>): AudioProfile => ({ ...profile, gear: { ...profile.gear!, ...edit } });
/** Times (s) at which the loudness (10 ms windows) rises through half of its maximum. */
function onsets(x: Float32Array): number[] {
  const env = envelope(x, 0.01);
  const half = 0.5 * Math.max(...env);
  const at: number[] = [];
  for (let w = 0; w < env.length; w++) if ((w === 0 || env[w - 1] < half) && env[w] >= half) at.push(w * 0.01);
  return at;
}
const octave = (x: Float32Array, hz: number): number => rms(biquad(biquad(x, { type: 'highpass', frequency: hz / Math.SQRT2, Q: 0 }), { type: 'lowpass', frequency: hz * Math.SQRT2, Q: 0 }), SR);

describe('the Cessna 172S has none of this', () => {
  it('the appended parameters and the second engine\'s block change no sample of a profile that does not use them', () => {
    const host = new SynthHost().set({ gearPump: 1, gearHorn: 1, gearWind: 2 });
    host.message({ type: 'thump', amp: 1 });
    const quiet = host.render(1);
    expect(peak(quiet[STEM.cabin])).toBe(0);
    expect(peak(quiet[STEM.airframe])).toBe(0);

    // In flight, everything that draws noise on: with the appended parameters at any value, the same samples.
    const flight = { rpm: 2400, firing: 1, load: 0.8, throttle: 0.8, propLoad: 1, tipMach: 0.76, windLevel: 1, windFreq: 700, slip: 0.4, flapNoise: 0.5, buffet: 0.3, horn: 0.6, flapMotor: 1, rolling: 0.5, rollSpeed: 15, surface: 1, gyro: 1, fan: 1, turbulence: 0.3 };
    const plain = new SynthHost().set(flight).render(2);
    const noisy = new SynthHost()
      .set({ ...flight, gearPump: 1, gearHorn: 1, gearWind: 2, propRpm: 1400, turbo: 1 })
      .setEngine(1, { rpm: 2500, firing: 1, load: 1, throttle: 1, propLoad: 1, tipMach: 0.8, propRpm: 2500, turbo: 1 })
      .render(2);
    for (let s = 0; s < plain.length; s++) {
      expect(rms(plain[s])).toBeGreaterThan(0.005);
      let differing = 0;
      for (let i = 0; i < plain[s].length; i++) if (!Object.is(plain[s][i], noisy[s][i])) differing++;
      expect(differing, `stem ${s}`).toBe(0);
    }
  }, 60_000);
});

describe('landing-gear hydraulic pump', () => {
  it('whines at the pitch of its motor while it runs, and spins up and down without a click', () => {
    const host = new SynthHost(TWIN_AUDIO_TESTBED).set({ gearPump: 1 });
    const on = host.render(1.5)[STEM.cabin];
    const steady = on.subarray(SR / 2);
    // 310 Hz unless the profile says otherwise, with harmonics.
    expect(toneMagnitude(steady, 310)).toBeGreaterThan(30 * toneMagnitude(steady, 365));
    expect(toneMagnitude(steady, 620)).toBeGreaterThan(10 * toneMagnitude(steady, 565));
    // About as loud as the flap motor.
    const flapMotor = new SynthHost(TWIN_AUDIO_TESTBED).set({ flapMotor: 1 }).render(1.5)[STEM.cabin].subarray(SR / 2);
    expect(Math.abs(dbfs(rms(steady)) - dbfs(rms(flapMotor)))).toBeLessThan(3);
    host.set({ gearPump: 0 });
    const offStem = host.render(1.5)[STEM.cabin];
    expect(maxStep(offStem)).toBeLessThanOrEqual(maxStep(steady) * 1.05);
    expect(peak(offStem.subarray(SR))).toBeLessThan(1e-3 * peak(steady));
    expect(maxStep(on, 1, SR / 2)).toBeLessThanOrEqual(maxStep(steady) * 1.05);

    const other = new SynthHost(gearOf(TWIN_AUDIO_TESTBED, { pumpHz: 240 })).set({ gearPump: 1 }).render(1.5)[STEM.cabin].subarray(SR / 2);
    expect(toneMagnitude(other, 240)).toBeGreaterThan(30 * toneMagnitude(other, 310));
  }, 60_000);
});

describe('gear warning', () => {
  it('a horn beeps: on for half of every beat, 90 beats a minute, at a pitch far below the stall warner', () => {
    const horn = new SynthHost(TWIN_AUDIO_TESTBED).set({ gearHorn: 1 }).render(6)[STEM.cabin];
    // 90 a minute: a beat every 0.667 s, nine in six seconds.
    const starts = onsets(horn);
    expect(starts).toHaveLength(9);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeCloseTo(60 / 90, 1);
    const env = envelope(horn, 0.01);
    const loud = env.filter((v) => v > 0.5 * Math.max(...env)).length / env.length;
    expect(loud).toBeGreaterThan(0.45);
    expect(loud).toBeLessThan(0.55);
    // Silent between the beeps, and no click at their edges (5 ms ramps).
    expect(Math.min(...env)).toBe(0);
    const tone = new SynthHost(TWIN_AUDIO_TESTBED).set({ gearHorn: 1 }).render(0.2)[STEM.cabin];
    expect(maxStep(horn)).toBeLessThanOrEqual(maxStep(tone, 0.05 * SR) * 1.1);
    // 480 Hz and its harmonics; the electric stall warner of the same aircraft is at 2600 Hz.
    expect(toneMagnitude(horn, 480)).toBeGreaterThan(30 * toneMagnitude(horn, 2600));
    const stall = new SynthHost(TWIN_AUDIO_TESTBED).set({ horn: 1 }).render(2)[STEM.cabin];
    expect(toneMagnitude(stall, 2600)).toBeGreaterThan(30 * toneMagnitude(stall, 480));
    // While it sounds it is about as loud as the stall warner.
    expect(Math.abs(dbfs(Math.max(...env)) - dbfs(rms(stall, SR)))).toBeLessThan(4);
  }, 60_000);

  it('a chime is struck once a second and rings out', () => {
    const chime = new SynthHost(DIESEL_AUDIO_TESTBED).set({ gearHorn: 1 }).render(6)[STEM.cabin];
    const starts = onsets(chime);
    expect(starts).toHaveLength(6);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeCloseTo(1, 1);
    // Each stroke decays: by the second half of the beat it is below a fifth of its start.
    for (let beat = 0; beat < 6; beat++) {
      const from = beat * SR;
      expect(rms(chime, from + 0.6 * SR, from + 0.95 * SR)).toBeLessThan(0.2 * rms(chime, from + 0.01 * SR, from + 0.15 * SR));
    }
    expect(toneMagnitude(chime, 880)).toBeGreaterThan(30 * toneMagnitude(chime, 480));
    // The strike has a 4 ms attack: no step larger than the tone's own.
    expect(maxStep(chime)).toBeLessThan(2 * Math.PI * (880 / SR) * peak(chime) * 2);
  }, 60_000);

  it('pitch and rate are the profile\'s, and the warning restarts on the beat', () => {
    const profile = gearOf(TWIN_AUDIO_TESTBED, { warningHz: 700, warningPerMinute: 120 });
    const host = new SynthHost(profile).set({ gearHorn: 1 });
    const horn = host.render(3)[STEM.cabin];
    expect(onsets(horn)).toHaveLength(6);
    expect(toneMagnitude(horn, 700)).toBeGreaterThan(30 * toneMagnitude(horn, 480));
    // Silenced (a lever moved forward) and sounding again: it starts with a beep, not in a gap.
    host.set({ gearHorn: 0 });
    host.render(0.83);
    host.set({ gearHorn: 1 });
    const again = host.render(0.25)[STEM.cabin];
    expect(rms(again, 0.1 * SR, 0.2 * SR)).toBeGreaterThan(0.5 * rms(horn, 0.1 * SR, 0.2 * SR));
  }, 60_000);
});

describe('landing gear in the airflow', () => {
  /** The airframe stem at `v` m/s with the gear up, down, and what the gear adds (it has a noise source of its own). */
  function atSpeed(v: number, gearWind: number): { up: Float32Array; down: Float32Array; gear: Float32Array } {
    const wind = { windLevel: (v / 50) ** 2, windFreq: 250 + 9 * v, turbulence: 0.2 };
    const up = new SynthHost(TWIN_AUDIO_TESTBED).set(wind).render(5)[STEM.airframe];
    const down = new SynthHost(TWIN_AUDIO_TESTBED).set({ ...wind, gearWind }).render(5)[STEM.airframe];
    return { up, down, gear: down.map((x, i) => x - up[i]) };
  }

  it('the rumble is centred on the vortex-shedding frequency of the legs, 0.2 V / d', () => {
    // Strouhal number 0.2 for a cylinder; legs about 0.07 m across: 100 Hz at 35 m/s, 200 Hz at 70 m/s.
    for (const v of [35, 50, 70]) {
      const shed = (0.2 * v) / 0.07;
      const { gear } = atSpeed(v, (v / 50) ** 2);
      const centre = octave(gear, shed);
      expect(centre, `${v} m/s`).toBeGreaterThan(1.3 * octave(gear, shed / 2.5));
      expect(centre, `${v} m/s`).toBeGreaterThan(1.3 * octave(gear, shed * 2.5));
    }
  }, 30_000);

  it('adds a few decibels to the wind noise on the approach, in proportion to its parameter', () => {
    // 45 m/s (87 kt): all three legs down.
    const level = (45 / 50) ** 2;
    const { up, down, gear } = atSpeed(45, level);
    const rise = dbfs(rms(down, SR)) - dbfs(rms(up, SR));
    expect(rise).toBeGreaterThan(1.5);
    expect(rise).toBeLessThan(5);
    // Half the parameter (the gear half out, or 0.71 of the speed): half the amplitude, sample for sample.
    const half = atSpeed(45, level / 2).gear;
    expect(rms(half, SR) / rms(gear, SR)).toBeCloseTo(0.5, 3);
    // Gear up: nothing.
    expect(peak(atSpeed(45, 0).gear)).toBe(0);
  }, 30_000);
});

describe('gear thump', () => {
  it('is a one-shot low thump with a short clunk, scaled by its amplitude, over in 0.6 s', () => {
    const play = (amp: number): Float32Array => {
      const host = new SynthHost(TWIN_AUDIO_TESTBED).set({});
      host.message({ type: 'thump', amp });
      return host.render(1)[STEM.airframe];
    };
    const thump = play(1);
    expect(peak(thump)).toBeGreaterThan(0.1);
    expect(peak(thump)).toBeLessThan(1);
    // The 55 Hz of a leg reaching its stop (the gear thump of the touchdown chirp).
    const first = thump.subarray(0, 0.25 * SR);
    expect(toneMagnitude(first, 55)).toBeGreaterThan(3 * toneMagnitude(first, 110));
    // Decays and ends.
    expect(rms(thump, 0.3 * SR, 0.6 * SR)).toBeLessThan(0.02 * rms(thump, 0, 0.1 * SR));
    expect(peak(thump.subarray(Math.ceil(0.61 * SR)))).toBe(0);
    // Attack of 3 ms: no click.
    expect(Math.abs(thump[0])).toBeLessThan(1e-3);
    const soft = play(0.4);
    for (let i = 0; i < SR / 2; i += 997) expect(soft[i]).toBeCloseTo(0.4 * thump[i], 6);
  }, 60_000);

  it('three legs locking within a second are three thumps, and a burst of messages is bounded', () => {
    const host = new SynthHost(TWIN_AUDIO_TESTBED).set({});
    const out: Float32Array[] = [];
    for (const amp of [1, 1, 1]) {
      host.message({ type: 'thump', amp });
      out.push(host.render(0.3)[STEM.airframe]);
    }
    for (const part of out) expect(peak(part.subarray(0, 0.1 * SR))).toBeGreaterThan(0.1);
    for (let i = 0; i < 20; i++) host.message({ type: 'thump', amp: 1 });
    const burst = host.render(1)[STEM.airframe];
    expect(burst.every(Number.isFinite)).toBe(true);
    expect(peak(burst)).toBeLessThan(4);
  }, 60_000);
});

describe('electric stall warner', () => {
  it('is a steady tone at one pitch, where the reed rises in pitch with the angle of attack', () => {
    // Test-bed: 2600 Hz. Half the parameter is the same pitch at half the strength.
    const tone = (horn: number): Float32Array => new SynthHost(TWIN_AUDIO_TESTBED).set({ horn }).render(1.5)[STEM.cabin].subarray(SR / 2);
    const full = tone(1);
    const half = tone(0.5);
    expect(toneMagnitude(full, 2600)).toBeGreaterThan(100 * toneMagnitude(full, 2500));
    expect(toneMagnitude(half, 2600) / toneMagnitude(full, 2600)).toBeCloseTo(0.5, 3);
    // The Cessna's reed at half strength is 450 Hz below its pitch at full strength.
    const reed = (horn: number): Float32Array => new SynthHost().set({ horn }).render(1.5)[STEM.cabin].subarray(SR / 2);
    expect(toneMagnitude(reed(0.5), 2350)).toBeGreaterThan(20 * toneMagnitude(reed(0.5), 2800));
    expect(toneMagnitude(reed(1), 2800)).toBeGreaterThan(20 * toneMagnitude(reed(1), 2350));
    // Steady: every 50 ms as loud as the next. No breath: nothing between the harmonics, where the reed hisses.
    const env = envelope(full, 0.05);
    expect(Math.max(...env) / Math.min(...env)).toBeLessThan(1.001);
    expect(toneMagnitude(full, 3300)).toBeLessThan(1e-4 * toneMagnitude(full, 2600));
    expect(toneMagnitude(reed(1), 3300)).toBeGreaterThan(1e-3 * toneMagnitude(reed(1), 2800));
  }, 60_000);

  it('draws no noise: the flap motor after it sounds the same samples with the warner on or off', () => {
    // (The reed's breath comes from the shared source, so there the motor's noise shifts.)
    const motor = (horn: number): Float32Array => {
      const host = new SynthHost({ ...TWIN_AUDIO_TESTBED, flapMotor: true }).set({ flapMotor: 1, horn });
      return host.render(0.5)[STEM.cabin];
    };
    const on = motor(1);
    const offStem = motor(0);
    const warner = new SynthHost(TWIN_AUDIO_TESTBED).set({ horn: 1 }).render(0.5)[STEM.cabin];
    for (let i = 0; i < on.length; i += 101) expect(on[i]).toBeCloseTo(offStem[i] + warner[i], 6);
  }, 60_000);
});
