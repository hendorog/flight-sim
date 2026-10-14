// Resume across eras (Deep Time): a snapshot carries `era` only outside the present day, and decideBoot never
// restores a snapshot of another era than the one booted (as for another aircraft).

import { describe, expect, it } from 'vitest';
import { defaultWeather } from '../../src/core/types';
import { decideBoot, parseSnapshot, type FlightSnapshot } from '../../src/sim/resume';
import { SimPhysics } from '../../src/sim/SimPhysics';

const NOW = 1_800_000_000_000;

/** A flight worth resuming: airborne in the cruise for a few seconds. */
function cruiseSnapshot(): FlightSnapshot {
  const w = defaultWeather();
  const p = new SimPhysics({ weather: w });
  p.reset('cruise');
  p.step(3);
  return p.captureSnapshot({ weather: w, cameraMode: 'chase', quality: 'high', renderScale: null, resume: true, now: NOW });
}

const boot = { param: null, explicitScenario: false, enabled: true, now: NOW + 60_000 } as const;

describe('resume across eras', () => {
  const present = cruiseSnapshot();

  it('a present-day snapshot has no era field and resumes in the present day', () => {
    expect('era' in present).toBe(false);
    const back = parseSnapshot(JSON.stringify(present));
    expect(back).not.toBeNull();
    expect(back!.era).toBeUndefined();
    expect(decideBoot(back, boot).kind).toBe('resume');
    expect(decideBoot(back, { ...boot, era: 'present' }).kind).toBe('resume');
  });

  it('an old snapshot (no era) is refused in the Cretaceous', () => {
    const d = decideBoot(parseSnapshot(JSON.stringify(present)), { ...boot, era: 'cretaceous' });
    expect(d).toEqual({ kind: 'normal', reason: 'snapshot is from another era' });
  });

  it('a Cretaceous snapshot round-trips its era, resumes there, and is refused in the present day', () => {
    const back = parseSnapshot(JSON.stringify({ ...present, era: 'cretaceous' }));
    expect(back?.era).toBe('cretaceous');
    expect(decideBoot(back, { ...boot, era: 'cretaceous' }).kind).toBe('resume');
    expect(decideBoot(back, boot)).toEqual({ kind: 'normal', reason: 'snapshot is from another era' });
    expect(decideBoot(back, { ...boot, era: 'present' }).kind).toBe('normal');
    // Not even with resume=1, nor as a restarted scenario.
    expect(decideBoot(back, { ...boot, param: true }).kind).toBe('normal');
    expect(decideBoot({ ...back!, resume: false }, boot).kind).toBe('normal');
  });

  it('an unknown era makes the snapshot invalid; the safari scenario is a valid snapshot scenario', () => {
    expect(parseSnapshot(JSON.stringify({ ...present, era: 'jurassic' }))).toBeNull();
    expect(parseSnapshot(JSON.stringify({ ...present, era: 'cretaceous', scenario: 'safari' }))?.scenario).toBe('safari');
    expect(parseSnapshot(JSON.stringify({ ...present, scenario: 'nowhere' }))).toBeNull();
  });
});
