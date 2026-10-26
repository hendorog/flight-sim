import { describe, expect, it } from 'vitest';
import type { KeyValueStore } from '../../src/sim/resume';
import { COCKPIT_SHARPNESS_KEY, cockpitDprCap, loadCockpitSharpness, saveCockpitSharpness } from '../../src/sim/displayPrefs';

function fakeStore(init: Record<string, string> = {}): KeyValueStore {
  const data = { ...init };
  return {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => void (data[k] = v),
    removeItem: (k: string) => void delete data[k],
  } as KeyValueStore;
}

describe('3D cockpit sharpness preference', () => {
  it('round-trips through the store and falls back to auto', () => {
    const s = fakeStore();
    expect(loadCockpitSharpness(s)).toBe('auto');
    saveCockpitSharpness(s, 1.5);
    expect(s.getItem(COCKPIT_SHARPNESS_KEY)).toBe('1.5');
    expect(loadCockpitSharpness(s)).toBe(1.5);
    saveCockpitSharpness(s, 'auto');
    expect(loadCockpitSharpness(s)).toBe('auto');
    expect(loadCockpitSharpness(fakeStore({ [COCKPIT_SHARPNESS_KEY]: '2' }))).toBe('auto');
    expect(loadCockpitSharpness(null)).toBe('auto');
  });

  it('auto is 1.25x on high and 1x on ultra; a choice applies on high and ultra only', () => {
    expect(cockpitDprCap('auto', 'high')).toBe(1.25);
    expect(cockpitDprCap('auto', 'ultra')).toBe(1);
    expect(cockpitDprCap(1.5, 'ultra')).toBe(1.5);
    expect(cockpitDprCap(1.5, 'high')).toBe(1.5);
    expect(cockpitDprCap(1, 'high')).toBe(1);
    for (const q of ['low', 'medium'] as const) expect(cockpitDprCap(1.5, q)).toBe(1);
  });
});
