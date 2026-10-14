// Boot order (Deep Time, WP0): the era must be set before anything era-dependent is built. A node-constructed
// Simulator (its constructor is the first thing boot runs) has set the era and merged the era's weather by the
// time the physics environment is created; the shell's source keeps setEra ahead of every builder.

import { afterEach, describe, expect, it, vi } from 'vitest';

const seen = vi.hoisted(() => ({ eraAtEnv: [] as string[] }));

vi.mock('../../src/sim/worldEnvironment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/sim/worldEnvironment')>();
  const { era } = await import('../../src/world/era/eraState');
  return {
    ...actual,
    createWorldEnvironment: (...args: Parameters<typeof actual.createWorldEnvironment>) => {
      seen.eraAtEnv.push(era().id);
      return actual.createWorldEnvironment(...args);
    },
  };
});

import { Simulator } from '../../src/sim/Simulator';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { era, setEra } from '../../src/world/era/eraState';
import simulatorSource from '../../src/sim/Simulator.ts?raw';

afterEach(() => {
  setEra('present');
  seen.eraAtEnv.length = 0;
  vi.unstubAllGlobals();
});

/** What boot() does next with the constructed shell: the physics (and its world environment). */
function bootPhysics(sim: Simulator): SimPhysics {
  return new SimPhysics({ weather: sim.weather });
}

describe('boot order', () => {
  it('?era=cretaceous: the era is set before the physics environment exists, with its weather preset', () => {
    const sim = new Simulator('?era=cretaceous&scenario=runway');
    expect(era().id).toBe('cretaceous');
    expect(sim.weather).toMatchObject({ visibilityM: 85000, cirrusCover: 0.2, isaDeviation: 10, cloudBaseM: 2600, cloudTopM: 3700 });
    bootPhysics(sim);
    expect(seen.eraAtEnv).toEqual(['cretaceous']);
  });

  it('the URL weather wins over the era preset', () => {
    const sim = new Simulator('?era=cretaceous&vis=20000&temp=-5&base=1800');
    expect(sim.weather.visibilityM).toBe(20000);
    expect(sim.weather.isaDeviation).toBe(-5);
    expect(sim.weather.cloudBaseM).toBe(1800);
    expect(sim.weather.cloudTopM).toBe(2900);
  });

  it('no era= : the stored choice, else the present day with today’s weather', () => {
    const store = new Map<string, string>([['fs.era', 'cretaceous']]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
    new Simulator('');
    expect(era().id).toBe('cretaceous');
    store.clear();
    setEra('cretaceous');
    const sim = new Simulator('');
    expect(era().id).toBe('present');
    expect(sim.weather).toEqual({ ...new Simulator('?era=present').weather });
    expect(sim.weather.visibilityM).toBe(60000);
    bootPhysics(sim);
    expect(seen.eraAtEnv).toEqual(['present']);
  });

  it('the shell sets the era ahead of the weather, the physics, the airport, the terrain and the fauna', () => {
    const at = (needle: string): number => {
      const i = simulatorSource.indexOf(needle);
      expect(i, needle).toBeGreaterThan(0);
      return i;
    };
    const setEraAt = at('setEra(chooseEra(');
    for (const later of ['defaultWeather()', 'new SimPhysics(', 'new AirportSystem(', 'new TerrainSystem(', 'createFaunaSystem(era())', 'new TrainingSystem(']) {
      expect(at(later), later).toBeGreaterThan(setEraAt);
    }
    // The fauna is initialised before the cloud-shadow scan and the shader warm-up.
    expect(at('await fauna.init(ctx)')).toBeLessThan(at('this.cloudShadows.scan(scene)'));
    expect(at('await fauna.init(ctx)')).toBeLessThan(at('this.warmUpShaders();'));
  });
});
