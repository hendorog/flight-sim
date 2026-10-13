// Which era a session is set in (src/sim/eraChoice.ts): URL era= > stored preference 'fs.era' > the present day.

import { describe, expect, it } from 'vitest';
import { defaultWeather } from '../../src/core/types';
import { applyEraWeather, chooseEra, ERA_PREF_KEY, eraSwitchUrl, saveEraPreference } from '../../src/sim/eraChoice';
import { parseParams } from '../../src/sim/params';
import type { KeyValueStore } from '../../src/sim/resume';
import { CRETACEOUS } from '../../src/world/era/cretaceous';
import { PRESENT } from '../../src/world/era/present';

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

describe('chooseEra', () => {
  it('URL first, then the stored preference, then the present day', () => {
    const stored = memoryStore({ [ERA_PREF_KEY]: 'cretaceous' });
    expect(chooseEra(parseParams('?era=present'), stored)).toEqual({ id: 'present', source: 'url' });
    expect(chooseEra(parseParams('?era=cretaceous'), memoryStore())).toEqual({ id: 'cretaceous', source: 'url' });
    expect(chooseEra(parseParams(''), stored)).toEqual({ id: 'cretaceous', source: 'preference' });
    expect(chooseEra(parseParams(''), memoryStore())).toEqual({ id: 'present', source: 'default' });
    expect(chooseEra(parseParams(''), null)).toEqual({ id: 'present', source: 'default' });
  });

  it('ignores unknown ids in the URL and in storage, and a store that throws', () => {
    expect(parseParams('?era=jurassic').era).toBeUndefined();
    expect(parseParams('').era).toBeUndefined();
    expect(chooseEra(parseParams('?era=jurassic'), memoryStore({ [ERA_PREF_KEY]: 'cretaceous' })).source).toBe('preference');
    expect(chooseEra(parseParams(''), memoryStore({ [ERA_PREF_KEY]: 'pleistocene' }))).toEqual({ id: 'present', source: 'default' });
    expect(chooseEra(parseParams(''), throwing)).toEqual({ id: 'present', source: 'default' });
  });

  it('a URL choice is not stored; the menu choice is', () => {
    const s = memoryStore();
    chooseEra(parseParams('?era=cretaceous'), s);
    expect(s.data).toEqual({});
    saveEraPreference(s, 'cretaceous');
    expect(s.data[ERA_PREF_KEY]).toBe('cretaceous');
    expect(() => saveEraPreference(throwing, 'present')).not.toThrow();
  });
});

describe('eraSwitchUrl', () => {
  it('drops the era and the old flight, keeps the aircraft and the rest', () => {
    const u = new URL(eraSwitchUrl('https://x.test/index.html?era=present&aircraft=c152&scenario=runway&lesson=L04&phase=climb&brief=0&resume=1&tod=17.5'));
    expect([...u.searchParams.keys()].sort()).toEqual(['aircraft', 'tod']);
    expect(u.pathname).toBe('/index.html');
  });
});

describe('params', () => {
  it('safari is a scenario a URL may name (explicitly)', () => {
    const p = parseParams('?scenario=safari');
    expect(p.scenario).toBe('safari');
    expect(p.explicitScenario).toBe(true);
    expect(parseParams('').explicitScenario).toBe(false);
  });
});

describe('applyEraWeather', () => {
  it('the present day changes nothing', () => {
    expect(applyEraWeather(defaultWeather(), PRESENT.weather)).toEqual(defaultWeather());
  });

  it('the Cretaceous preset goes over the defaults and keeps the cloud layer depth', () => {
    const w = applyEraWeather(defaultWeather(), CRETACEOUS.weather);
    expect(w).toMatchObject({ visibilityM: 45000, cloudCover: 0.35, cloudBaseM: 1500, cirrusCover: 0, isaDeviation: 10 });
    const d = defaultWeather();
    expect(w.cloudTopM - w.cloudBaseM).toBe(d.cloudTopM - d.cloudBaseM);
    expect(applyEraWeather(defaultWeather(), { cloudBaseM: 2000 }).cloudTopM).toBe(2000 + d.cloudTopM - d.cloudBaseM);
  });
});
