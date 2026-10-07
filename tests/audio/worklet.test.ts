import { describe, expect, it } from 'vitest';
import { STEM } from '../../src/audio/params';
import { maxStep, peak, rms, SR, SynthHost, toneMagnitude } from './workletHost';

const cruise = { rpm: 2400, firing: 1, load: 0.8, throttle: 0.8, propLoad: 1, tipMach: 0.76 };

describe('synthesis worklet', () => {
  it('is silent with everything off', () => {
    const stems = new SynthHost().set({}).render(0.5);
    for (const s of stems) expect(peak(s)).toBe(0);
  }, 60_000);

  it('produces bounded, finite output with every source at maximum at once', () => {
    // Stems are float and a limiter follows the mix, so the bound only guards against runaway filters.
    const h = new SynthHost().set({ ...cruise, windLevel: 2.5, windFreq: 900, slip: 1, flapNoise: 1, buffet: 1, horn: 1, rolling: 1.2, rollSpeed: 30, surface: 2, brakeSqueal: 1, skid: 1, gyro: 1, fan: 1, flapMotor: 1, starter: 1, turbulence: 1 });
    h.message({ type: 'crash', amp: 1 });
    h.message({ type: 'chirp', amp: 1.8 });
    for (const s of h.render(2)) {
      expect(s.every(Number.isFinite)).toBe(true);
      expect(peak(s)).toBeLessThan(5);
    }
  }, 60_000);

  it('engine spectrum: firing frequency rpm/60*2 and its harmonics, plus half-order irregularity', () => {
    const e = new SynthHost().set(cruise).render(3)[STEM.engine].subarray(SR);
    const firing = toneMagnitude(e, 80); // 2400 rpm -> 40 rev/s -> 80 Hz
    const second = toneMagnitude(e, 160);
    const halfOrder = toneMagnitude(e, 40);
    const between = toneMagnitude(e, 70);
    expect(firing).toBeGreaterThan(20 * between);
    expect(second).toBeGreaterThan(20 * between);
    expect(halfOrder).toBeGreaterThan(3 * between); // uneven cylinders: audible sub-harmonic lope
    expect(halfOrder).toBeLessThan(firing);
  }, 60_000);

  it('propeller blade-passage tone follows rpm and tip Mach', () => {
    const p = new SynthHost().set(cruise).render(2)[STEM.prop].subarray(SR / 2);
    expect(toneMagnitude(p, 80)).toBeGreaterThan(10 * toneMagnitude(p, 60));
    const slow = new SynthHost().set({ ...cruise, rpm: 1200, tipMach: 0.4 }).render(2)[STEM.prop].subarray(SR / 2);
    expect(rms(slow)).toBeLessThan(rms(p) * 0.4);
  }, 60_000);

  it('idle is quieter than cruise, and full power is louder in the prop stem', () => {
    const idle = new SynthHost().set({ rpm: 700, firing: 1, load: 0.05, throttle: 0.05, propLoad: 0.1, tipMach: 0.21 }).render(2);
    const cr = new SynthHost().set(cruise).render(2);
    expect(rms(idle[STEM.engine], SR)).toBeLessThan(0.6 * rms(cr[STEM.engine], SR));
    expect(rms(idle[STEM.prop], SR)).toBeLessThan(0.1 * rms(cr[STEM.prop], SR));
  }, 60_000);

  it('start-up stumbles: combustion builds up with misfires rather than switching on', () => {
    const h = new SynthHost().set({ rpm: 700, firing: 0, starter: 1, load: 0.1, throttle: 0.1 });
    h.render(0.3);
    h.set({ firing: 1, starter: 0 });
    const e = h.render(1.5)[STEM.engine];
    // Energy in successive 100 ms windows rises overall but not monotonically (misfires).
    const w = Array.from({ length: 15 }, (_, i) => rms(e, i * 4800, (i + 1) * 4800));
    expect(w[14]).toBeGreaterThan(w[0]);
    expect(w.some((v, i) => i > 0 && v < w[i - 1] * 0.95)).toBe(true);
  }, 60_000);

  it('parameter steps do not click', () => {
    // Horn and flap motor switched on and off abruptly: the largest sample step around the switch stays
    // within the steady-state tone's own largest step.
    const h = new SynthHost().set({ horn: 1 });
    const steady = maxStep(h.render(0.5)[STEM.cabin]);
    h.set({ horn: 0 });
    const off = h.render(0.2)[STEM.cabin];
    expect(maxStep(off)).toBeLessThanOrEqual(steady * 1.05);
    h.set({ horn: 1 });
    expect(maxStep(h.render(0.2)[STEM.cabin])).toBeLessThanOrEqual(steady * 1.05);

    // A sudden large rpm change is slewed, so the engine does not jump.
    const eng = new SynthHost().set(cruise);
    const before = maxStep(eng.render(0.5)[STEM.engine]);
    eng.set({ ...cruise, rpm: 1000, load: 0.1 });
    expect(maxStep(eng.render(0.1)[STEM.engine])).toBeLessThan(before * 1.5);
  }, 60_000);

  it('touchdown chirp and crash decay away', () => {
    const h = new SynthHost().set({});
    h.message({ type: 'chirp', amp: 1 });
    h.message({ type: 'crash', amp: 1 });
    const a = h.render(5)[STEM.airframe];
    expect(rms(a, 0, SR / 2)).toBeGreaterThan(0.05);
    expect(peak(a.subarray(Math.floor(4.2 * SR)))).toBe(0);
  }, 60_000);
});
