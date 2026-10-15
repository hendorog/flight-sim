import { describe, expect, it } from 'vitest';
import { parseParams } from '../../src/sim/params';
import type { KeyValueStore } from '../../src/sim/resume';
import { chooseMoonScale, DEFAULT_MOON_SCALE, loadMoonScale, MOON_SCALE_KEY, saveMoonScale } from '../../src/sim/skyPrefs';

function fakeStore(init: Record<string, string> = {}): KeyValueStore & { data: Record<string, string>; writes: number } {
  const data = { ...init };
  return {
    data,
    writes: 0,
    getItem(k: string) {
      return k in data ? data[k] : null;
    },
    setItem(k: string, v: string) {
      this.writes++;
      data[k] = v;
    },
    removeItem(k: string) {
      delete data[k];
    },
  } as KeyValueStore & { data: Record<string, string>; writes: number };
}

describe('Moon size preference', () => {
  it('round-trips through the store', () => {
    const s = fakeStore();
    expect(loadMoonScale(s)).toBe(DEFAULT_MOON_SCALE);
    saveMoonScale(s, 2.5);
    expect(s.data[MOON_SCALE_KEY]).toBe('2.5');
    expect(loadMoonScale(s)).toBe(2.5);
    saveMoonScale(s, 1);
    expect(loadMoonScale(s)).toBe(1);
  });

  it('ignores bad values and clamps out-of-range ones', () => {
    expect(loadMoonScale(fakeStore({ [MOON_SCALE_KEY]: 'abc' }))).toBe(DEFAULT_MOON_SCALE);
    expect(loadMoonScale(fakeStore({ [MOON_SCALE_KEY]: '' }))).toBe(DEFAULT_MOON_SCALE);
    expect(loadMoonScale(fakeStore({ [MOON_SCALE_KEY]: '12' }))).toBe(5);
    expect(loadMoonScale(fakeStore({ [MOON_SCALE_KEY]: '0.2' }))).toBe(1);
    const s = fakeStore({ [MOON_SCALE_KEY]: '3' });
    saveMoonScale(s, Number.NaN);
    expect(s.data[MOON_SCALE_KEY]).toBe('3');
    expect(loadMoonScale(null)).toBe(DEFAULT_MOON_SCALE);
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } } as unknown as KeyValueStore;
    expect(loadMoonScale(throwing)).toBe(DEFAULT_MOON_SCALE);
    expect(() => saveMoonScale(throwing, 2)).not.toThrow();
  });

  it('lets the URL win without storing it', () => {
    const s = fakeStore({ [MOON_SCALE_KEY]: '2' });
    expect(chooseMoonScale(parseParams('?moon=1'), s)).toBe(1);
    expect(chooseMoonScale(parseParams('?moon=2.6'), s)).toBe(2.5);
    expect(chooseMoonScale(parseParams('?moon=9'), s)).toBe(5);
    expect(s.writes).toBe(0);
    expect(s.data[MOON_SCALE_KEY]).toBe('2');
    expect(chooseMoonScale(parseParams('?moon=x'), s)).toBe(2);
    expect(chooseMoonScale(parseParams(''), s)).toBe(2);
    expect(chooseMoonScale(parseParams(''), fakeStore())).toBe(DEFAULT_MOON_SCALE);
  });
});
