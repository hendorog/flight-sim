// The era contracts (Deep Time, WP0): the era singleton, the registry, and the subsystem-owned tables' present
// entries. The round trip cretaceous -> present against the guard hashes is in presentGuard.test.ts.

import { afterEach, describe, expect, it } from 'vitest';
import { CRETACEOUS } from '../../src/world/era/cretaceous';
import { era, isPresent, setEra } from '../../src/world/era/eraState';
import { PRESENT } from '../../src/world/era/present';
import { eraById, ERAS, isEraId } from '../../src/world/era/registry';
import { ERA_IDS } from '../../src/world/era/types';
import { createFaunaSystem } from '../../src/world/fauna/FaunaSystem';
import { ROSTERS } from '../../src/world/fauna/roster';
import { BONE, BONE_COUNT, FAUNA_ATTR, FAUNA_STRIDE } from '../../src/world/fauna/types';
import { PALETTES } from '../../src/world/terrain/eraPalette';
import { FLORA, FLORA_SLOTS } from '../../src/world/terrain/vegetation/flora';
import { SPECIES, SPECIES_COUNT } from '../../src/world/terrain/vegetation/placement';
import { fragmentHead, fragmentSplat } from '../../src/world/terrain/terrainMaterial';
import { fragmentMain } from '../../src/world/terrain/water';

afterEach(() => {
  setEra('present');
});

describe('era state', () => {
  it('starts in the present day', () => {
    expect(era()).toBe(PRESENT);
    expect(isPresent()).toBe(true);
  });

  it('sets a known era, idempotently', () => {
    expect(setEra('cretaceous')).toBe(CRETACEOUS);
    expect(setEra('cretaceous')).toBe(CRETACEOUS);
    expect(era()).toBe(CRETACEOUS);
    expect(isPresent()).toBe(false);
    setEra('present');
    expect(era()).toBe(PRESENT);
    expect(isPresent()).toBe(true);
  });

  it('falls back to the present day for anything unknown', () => {
    for (const bad of ['jurassic', 'pleistocene', '', 'PRESENT', null, undefined, 42, {}]) {
      setEra('cretaceous');
      expect(setEra(bad)).toBe(PRESENT);
      expect(isPresent()).toBe(true);
    }
  });
});

describe('registry', () => {
  it('lists every era by id', () => {
    expect([...ERA_IDS]).toEqual(['present', 'cretaceous']);
    for (const id of ERA_IDS) {
      expect(isEraId(id)).toBe(true);
      expect(eraById(id).id).toBe(id);
      expect(ERAS[id].id).toBe(id);
    }
    expect(isEraId('pleistocene')).toBe(false);
    expect(eraById('nope')).toBe(PRESENT);
  });

  it('era data is frozen and structured-clone safe (it crosses to the workers by id, but must stay plain)', () => {
    for (const e of Object.values(ERAS)) {
      expect(Object.isFrozen(e)).toBe(true);
      expect(Object.isFrozen(e.terrain)).toBe(true);
      expect(Object.isFrozen(e.world)).toBe(true);
      expect(Object.isFrozen(e.weather)).toBe(true);
      expect(structuredClone(e)).toEqual(e);
    }
  });

  it('the present day is today: no offsets, every flag on, no volcano, the airport, the school, no preset', () => {
    expect(PRESENT.terrain).toEqual({ treeLineOffset: 0, snowLineOffset: 0, farmland: true, town: true, marsh: false, volcano: null });
    expect(PRESENT.world).toEqual({ airport: 'modern', flatSurface: 'grass', school: true, towerCamera: true });
    expect(PRESENT.weather).toEqual({});
    expect([PRESENT.palette, PRESENT.flora, PRESENT.fauna]).toEqual(['present', 'present', 'none']);
  });

  it('the Cretaceous scalars are the plan’s', () => {
    expect(CRETACEOUS.label).toBe('Late Cretaceous Laramidia');
    expect(CRETACEOUS.epoch).toBe('~67 Ma');
    expect(CRETACEOUS.terrain).toEqual({
      treeLineOffset: 600,
      snowLineOffset: 6000,
      farmland: false,
      town: false,
      marsh: true,
      volcano: { north: 2000, east: -17500, baseRadius: 7000, summit: 2600, craterRadius: 400, craterDepth: 160 },
    });
    expect(CRETACEOUS.world).toEqual({ airport: 'flats', flatSurface: 'dirt', school: false, towerCamera: false, defaultScenario: 'safari' });
    expect(CRETACEOUS.weather).toEqual({ visibilityM: 45000, cloudCover: 0.35, cloudBaseM: 1500, cirrusCover: 0, isaDeviation: 10 });
    // 17.6 km from the field, bearing ~276.
    const v = CRETACEOUS.terrain.volcano!;
    expect(Math.hypot(v.north, v.east)).toBeCloseTo(17614, -1);
    expect(((Math.atan2(v.east, v.north) * 180) / Math.PI + 360) % 360).toBeCloseTo(276.5, 0);
  });
});

describe('subsystem tables', () => {
  it('every palette, flora set and roster id an era names exists', () => {
    for (const e of Object.values(ERAS)) {
      expect(PALETTES[e.palette], e.id).toBeDefined();
      expect(FLORA[e.flora], e.id).toBeDefined();
      expect(ROSTERS[e.fauna], e.id).toBeDefined();
    }
  });

  it('the present palette strings are today’s shader literals, byte for byte', () => {
    // The shaders are templated from the palette (WP1); the present text itself is pinned byte for byte by
    // presentGuard.test.ts. Here: every present string is a vec3 literal that the present shader text uses.
    const terrainSource = fragmentHead() + fragmentSplat();
    const waterSource = fragmentMain();
    const p = PALETTES.present;
    const water = new Set(['seaAtten', 'seaBodyDeep', 'seaBodyShallow', 'riverAtten', 'riverBody']);
    for (const [key, glsl] of Object.entries(p)) {
      expect(glsl, key).toMatch(/^vec3\([^()]*\)$/);
      expect((water.has(key) ? waterSource : terrainSource).includes(glsl), `${key} = ${glsl}`).toBe(true);
    }
  });

  it('flora sets have the four slots of the tree system, the present one today’s species in order', () => {
    expect(FLORA_SLOTS).toBe(SPECIES_COUNT);
    for (const f of Object.values(FLORA)) expect(f.slots.length).toBe(FLORA_SLOTS);
    expect(FLORA.present.slots.map((s) => s.key)).toEqual(Object.keys(SPECIES));
    expect(FLORA.present.slots.map((s, i) => [s.key, i])).toEqual(Object.entries(SPECIES));
  });

  it('the present roster is empty and builds no fauna system', () => {
    expect(ROSTERS.none.entries).toEqual([]);
    expect(createFaunaSystem(PRESENT)).toBeNull();
    // The Cretaceous roster has animals (WP5).
    expect(createFaunaSystem(CRETACEOUS)).not.toBeNull();
  });

  it('the fauna instance format and bones fit the shader contract', () => {
    expect(FAUNA_STRIDE).toBe(12);
    expect(Object.values(FAUNA_ATTR)).toEqual([0, 4, 8]);
    const bones = Object.values(BONE);
    expect(bones.length).toBe(BONE_COUNT);
    expect(BONE_COUNT).toBeLessThanOrEqual(16);
    expect(new Set(bones).size).toBe(BONE_COUNT);
    expect(Math.max(...bones)).toBe(BONE_COUNT - 1);
  });
});
