// Deep Time integration (WP8): the era seams the browser shell relies on, checked in node.
//   - boot order: a Simulator built for ?era=cretaceous has set the era before the physics' world environment
//     exists (and the present day stays present);
//   - physics/tile parity under the Cretaceous: the flight model's ground (worldTerrain) is the rendered tile's
//     vertex height (no pavement lift on the Flats, the volcano in both), and the surface at both line-ups is dirt;
//   - the shell builds no Flight School in an era without one, and no fauna in the present day;
//   - the safari start shows the showcase herd: ahead of the start, off the left wing, within reach of the first
//     half-minute.

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

import { defaultWeather } from '../../src/core/types';
import { Simulator } from '../../src/sim/Simulator';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { buildScenario } from '../../src/sim/scenarios';
import { worldTerrain } from '../../src/sim/worldEnvironment';
import { LINE_UP } from '../../src/world/airport/layout';
import { CRETACEOUS } from '../../src/world/era/cretaceous';
import { era, isPresent, setEra } from '../../src/world/era/eraState';
import { PRESENT } from '../../src/world/era/present';
import { createFaunaSystem } from '../../src/world/fauna/FaunaSystem';
import { countingTerrain } from '../../src/world/fauna/habitat';
import { riverHerdSite } from '../../src/world/fauna/showcase';
import { terrainHeight } from '../../src/world/terrain/heightfield';
import { buildTile } from '../../src/world/terrain/tileBuilder';
import simulatorSource from '../../src/sim/Simulator.ts?raw';

afterEach(() => {
  setEra('present');
  seen.eraAtEnv.length = 0;
});

const LEAF = 128;

/** The level-0 tile (TerrainSystem LEAF_SIZE 128, grid 64) holding a point, and its lattice vertex heights vs worldTerrain. */
function tileParity(north: number, east: number): { worst: number; vertices: number } {
  const grid = 64;
  const ix = Math.floor(east / LEAF);
  const iz = Math.floor(north / LEAF);
  const t = buildTile({ level: 0, ix, iz, grid, leafSize: LEAF });
  const sp = LEAF / grid;
  const n = grid + 1;
  let worst = 0;
  let vertices = 0;
  for (let j = 0; j < n; j += 4) {
    for (let i = 0; i < n; i += 4) {
      const v = j * n + i;
      const tileH = t.positions[v * 3 + 1];
      const physH = worldTerrain.height(iz * LEAF + j * sp, ix * LEAF + i * sp);
      worst = Math.max(worst, Math.abs(tileH - physH));
      vertices++;
    }
  }
  return { worst, vertices };
}

describe('Deep Time integration', () => {
  it('boot order: ?era=cretaceous is set before the physics environment; no era= stays present', () => {
    const sim = new Simulator('?era=cretaceous&scenario=runway');
    expect(era().id).toBe('cretaceous');
    new SimPhysics({ weather: sim.weather });
    expect(seen.eraAtEnv).toEqual(['cretaceous']);
    setEra('present');
    const present = new Simulator('?scenario=runway');
    expect(isPresent()).toBe(true);
    new SimPhysics({ weather: present.weather });
    expect(seen.eraAtEnv).toEqual(['cretaceous', 'present']);
  });

  it('physics and tiles agree under the Cretaceous: Flats line-ups and the volcano summit', () => {
    setEra('cretaceous');
    for (const l of LINE_UP) {
      // No pavement lift: the wheels sit on the rendered mud.
      expect(worldTerrain.height(l.north, l.east)).toBe(terrainHeight(l.north, l.east));
      expect(worldTerrain.surface(l.north, l.east)).toBe('dirt');
      const p = tileParity(l.north, l.east);
      expect(p.vertices).toBeGreaterThan(200);
      expect(p.worst).toBeLessThan(0.01);
    }
    const v = CRETACEOUS.terrain.volcano!;
    const summit = tileParity(v.north, v.east);
    expect(summit.worst).toBeLessThan(0.01);
    expect(terrainHeight(v.north, v.east)).toBeGreaterThan(2000);
  }, 60000);

  it('the present day keeps its paved runway surface at the line-up', () => {
    setEra('present');
    expect(worldTerrain.surface(LINE_UP[0].north, LINE_UP[0].east)).not.toBe('dirt');
  });

  it('no Flight School in the Cretaceous, and the shell only builds one when the era has a school', () => {
    expect(CRETACEOUS.world.school).toBe(false);
    expect(PRESENT.world.school).toBe(true);
    expect(simulatorSource).toMatch(/const training = !era\(\)\.world\.school \? null : new TrainingSystem\(/);
  });

  it('FaunaSystem: null in the present day, built for the Cretaceous', () => {
    expect(createFaunaSystem(PRESENT)).toBeNull();
    const sys = createFaunaSystem(CRETACEOUS, { terrain: countingTerrain() });
    expect(sys).not.toBeNull();
    expect(sys!.stats).toEqual({ visible: 0, terrainCalls: 0, reallocs: 0, cpuMs: 0 });
    sys!.dispose();
  });

  it('the safari start has the river herd ahead and off the left wing, passed within the first half-minute', () => {
    setEra('cretaceous');
    const env = new SimPhysics({ weather: defaultWeather() }).env;
    const sc = buildScenario('safari', env);
    const { x, y } = sc.ic.position;
    const h = sc.ic.heading;
    const herd = riverHerdSite(countingTerrain());
    const dn = herd.north - x;
    const de = herd.east - y;
    const ahead = dn * Math.cos(h) + de * Math.sin(h);
    const right = -dn * Math.sin(h) + de * Math.cos(h);
    // Abeam within ~25 s at cruise (~60 m/s), off the left wing: 200-400 m left of the start track (the hold's
    // drift puts it HERD_LATERAL_M = 300 m left of the flown path; cretaceousAnchors.ts), so it crosses the left
    // door window (seen from the left seat).
    expect(ahead).toBeGreaterThan(300);
    expect(ahead).toBeLessThan(1500);
    expect(-right).toBeGreaterThan(200);
    expect(-right).toBeLessThan(400);
  });
});
