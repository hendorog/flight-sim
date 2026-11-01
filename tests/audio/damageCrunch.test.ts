// Landing damage sound (AudioSystem 'damage'): the crash sound at a lower level on disabling damage and a propeller
// tip strike; nothing for an inspection note, a bent leg or a scrape.
import { describe, expect, it } from 'vitest';
import { damageCrunchAmplitude } from '../../src/audio/AudioSystem';

describe('damage crunch', () => {
  it('is quieter than the crash, on a collapse, a strike or a belly slide only', () => {
    expect(damageCrunchAmplitude('noseGear', 'disabling')).toBeGreaterThan(0);
    expect(damageCrunchAmplitude('noseGear', 'disabling')).toBeLessThan(1);
    expect(damageCrunchAmplitude('belly', 'disabling')).toBeGreaterThan(0);
    expect(damageCrunchAmplitude('propeller0', 'damage')).toBeGreaterThan(0);
    expect(damageCrunchAmplitude('propeller0', 'damage')).toBeLessThan(damageCrunchAmplitude('propeller0', 'disabling'));
    expect(damageCrunchAmplitude('hardLanding', 'inspection')).toBe(0);
    expect(damageCrunchAmplitude('leftMain', 'damage')).toBe(0);
    expect(damageCrunchAmplitude('wingtipLeft', 'damage')).toBe(0);
  });
});
