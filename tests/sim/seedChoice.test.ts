// Which world seed a session is built from (src/sim/seedChoice.ts): URL seed= > stored preference 'fs.seed' > 0.

import { describe, expect, it } from 'vitest';
import { parseParams } from '../../src/sim/params';
import { decideBoot, type FlightSnapshot, type KeyValueStore } from '../../src/sim/resume';
import { chooseSeed, randomSeed, RANDOM_SEED_MAX, saveSeedPreference, SEED_PREF_KEY, seedDevChoiceUrl, seedSwitchUrl } from '../../src/sim/seedChoice';

function memoryStore(init: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
}

const throwing: KeyValueStore = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
  removeItem: () => {},
};

describe('chooseSeed', () => {
  it('URL first, then the stored preference, then today', () => {
    const stored = memoryStore({ [SEED_PREF_KEY]: '42' });
    expect(chooseSeed(parseParams('?seed=7'), stored)).toEqual({ seed: 7, source: 'url' });
    expect(chooseSeed(parseParams('?seed=0'), stored)).toEqual({ seed: 0, source: 'url' });
    expect(chooseSeed(parseParams(''), stored)).toEqual({ seed: 42, source: 'preference' });
    expect(chooseSeed(parseParams(''), memoryStore())).toEqual({ seed: 0, source: 'default' });
    expect(chooseSeed(parseParams(''), memoryStore({ [SEED_PREF_KEY]: 'junk' }))).toEqual({ seed: 0, source: 'default' });
    expect(chooseSeed(parseParams(''), throwing)).toEqual({ seed: 0, source: 'default' });
    expect(chooseSeed(parseParams(''), null)).toEqual({ seed: 0, source: 'default' });
  });

  it('stores the choice, and survives a store that throws', () => {
    const s = memoryStore();
    saveSeedPreference(s, 123);
    expect(s.data[SEED_PREF_KEY]).toBe('123');
    expect(() => saveSeedPreference(throwing, 5)).not.toThrow();
  });
});

describe('randomSeed', () => {
  it('is never 0 and stays within six digits', () => {
    expect(randomSeed(() => 0)).toBe(1);
    expect(randomSeed(() => 0.999999999)).toBe(RANDOM_SEED_MAX);
  });
});

describe('seed switch URLs', () => {
  it('drop the seed and the old flight, keep the aircraft and the era', () => {
    const u = new URL(seedSwitchUrl('http://x/index.html?seed=7&aircraft=pa38&era=cretaceous&scenario=cruise&resume=1&lesson=L01'));
    expect(u.searchParams.has('seed')).toBe(false);
    expect(u.searchParams.has('scenario')).toBe(false);
    expect(u.searchParams.has('resume')).toBe(false);
    expect(u.searchParams.has('lesson')).toBe(false);
    expect(u.searchParams.get('aircraft')).toBe('pa38');
    expect(u.searchParams.get('era')).toBe('cretaceous');
  });

  it('a dev page names the seed in the address (none for today)', () => {
    expect(new URL(seedDevChoiceUrl('http://x/dev/terrain.html?seed=3', 9)).searchParams.get('seed')).toBe('9');
    expect(new URL(seedDevChoiceUrl('http://x/dev/terrain.html?seed=3', 0)).searchParams.has('seed')).toBe(false);
  });
});

describe('resume across seeds', () => {
  it('a flight saved in another seed is not resumed', () => {
    const snap = { schema: 3, aircraft: 'c172s', savedAt: 1000, resume: true, scenario: 'cruise', simTime: 10, status: { crashed: false } } as unknown as FlightSnapshot;
    const opts = { param: true, explicitScenario: false, enabled: true, now: 2000 };
    expect(decideBoot({ ...snap, seed: 7 }, { ...opts, seed: 0 }).kind).toBe('normal');
    expect(decideBoot(snap, { ...opts, seed: 7 }).kind).toBe('normal');
    expect(decideBoot({ ...snap, seed: 7 }, { ...opts, seed: 7 }).kind).not.toBe('normal');
    expect(decideBoot(snap, opts).kind).not.toBe('normal');
  });
});
