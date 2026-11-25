// Algorithmic high-tension power transmission corridors and radio masts across seeds, plus 3D mesh & lighting checks.

import { afterAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { setEra } from '../../src/world/era/eraState';
import { setWorldSeed } from '../../src/world/worldSeed';
import { makeSample, sampleTerrain, terrainHeight } from '../../src/world/terrain/heightfield';
import { buildInfrastructure } from '../../src/world/airport/infrastructure';
import {
  obstacleClearOfAirfields,
  planInfrastructure,
  PYLON_LOWEST_INSULATOR_FRAC,
} from '../../src/world/airport/infrastructurePlan';
import { LIGHT_COLORS } from '../../src/world/airport/lights';

vi.setConfig({ testTimeout: 60_000 });

const SEEDS = [0, 1, 7];

afterAll(() => {
  setEra('present');
  setWorldSeed(0);
});

describe('algorithmic power pylons and radio masts across world seeds', () => {
  it.each(SEEDS)('seed %i: sites safe, terrain-adapted power corridors and radio masts', (seed) => {
    setEra('present');
    setWorldSeed(seed);
    const t0 = performance.now();
    const plan = planInfrastructure(terrainHeight);
    const ms = performance.now() - t0;

    if (seed === 0) {
      const p = plan.pylons[2];
      const gm = plan.masts.find((m) => m.kind === 'guyed')!;
      const lm = plan.masts.find((m) => m.kind === 'lattice')!;
      console.log(
        `seed 0 infra: ${ms.toFixed(0)} ms, ${plan.substations.length} substations, ${plan.pylons.length} pylons, ${plan.spans.length} spans, ${plan.masts.length} masts | pylon2=(${p.north.toFixed(0)},${p.east.toFixed(0)},g=${p.ground.toFixed(0)},hdg=${p.heading.toFixed(2)}) guyed=(${gm.north.toFixed(0)},${gm.east.toFixed(0)},g=${gm.ground.toFixed(0)},H=${gm.height}) lattice=(${lm.north.toFixed(0)},${lm.east.toFixed(0)},g=${lm.ground.toFixed(0)},H=${lm.height})`,
      );
    }
    expect(ms).toBeLessThan(600);
    // Substations, lattice pylons and spans exist in every seed.
    expect(plan.substations.length).toBeGreaterThanOrEqual(2);
    expect(plan.pylons.length).toBeGreaterThan(25);
    expect(plan.spans.length).toBeGreaterThan(24);
    expect(plan.pylons.some((p) => p.kind === 'suspension')).toBe(true);
    expect(plan.pylons.some((p) => p.kind === 'strain')).toBe(true);

    // Both tall guyed hilltop broadcast masts and self-supporting lattice microwave/cellular towers exist.
    const guyed = plan.masts.filter((m) => m.kind === 'guyed');
    const lattice = plan.masts.filter((m) => m.kind === 'lattice');
    expect(guyed.length).toBeGreaterThanOrEqual(2);
    expect(lattice.length).toBeGreaterThanOrEqual(4);
    for (const g of guyed) {
      expect(g.height).toBeGreaterThanOrEqual(105);
      expect(g.anchorRadius).toBeGreaterThan(40);
    }
    for (const l of lattice) {
      expect(l.height).toBeGreaterThanOrEqual(40);
      expect(l.dishBearings.length).toBeGreaterThanOrEqual(1);
    }

    // Every pylon, substation and radio mast sits on dry land and clears all airfield circuits & 1:35 approaches.
    const samp = makeSample();
    for (const sub of plan.substations) {
      sampleTerrain(sub.north, sub.east, samp);
      expect(samp.ground).toBeGreaterThan(1.8);
      expect(samp.ground).toBeGreaterThan(samp.standing + 0.8);
      expect(samp.ground).toBeGreaterThan(samp.river + 0.8);
      expect(obstacleClearOfAirfields(sub.north, sub.east, samp.ground, 20)).toBe(true);
    }
    for (const p of plan.pylons) {
      sampleTerrain(p.north, p.east, samp);
      expect(samp.ground).toBeGreaterThan(1.8);
      expect(samp.ground).toBeGreaterThan(samp.standing + 0.8);
      expect(samp.ground).toBeGreaterThan(samp.river + 0.8);
      expect(obstacleClearOfAirfields(p.north, p.east, p.ground, p.height)).toBe(true);
    }
    for (const m of plan.masts) {
      sampleTerrain(m.north, m.east, samp);
      expect(samp.ground).toBeGreaterThan(4);
      expect(samp.ground).toBeGreaterThan(samp.standing + 0.8);
      expect(samp.ground).toBeGreaterThan(samp.river + 0.8);
      expect(obstacleClearOfAirfields(m.north, m.east, m.ground, m.height + 10)).toBe(true);
    }

    // Every catenary span maintains safe conductor clearance above terrain and water across its full length.
    for (const sp of plan.spans) {
      expect(sp.minClearance).toBeGreaterThan(10.5);
      const p0 = plan.pylons[sp.from];
      const p1 = plan.pylons[sp.to];
      for (const f of [0.25, 0.5, 0.75]) {
        const sn = p0.north + (p1.north - p0.north) * f;
        const se = p0.east + (p1.east - p0.east) * f;
        sampleTerrain(sn, se, samp);
        const surf = Math.max(samp.ground, samp.standing > -1e6 ? samp.standing : -Infinity, samp.river > -1e6 ? samp.river : -Infinity);
        const lowWire =
          p0.ground +
          p0.height * PYLON_LOWEST_INSULATOR_FRAC * (1 - f) +
          (p1.ground + p1.height * PYLON_LOWEST_INSULATOR_FRAC) * f -
          sp.sag * 4 * f * (1 - f);
        expect(lowWire - surf).toBeGreaterThan(10.5);
      }
    }
  });

  it('produces distinct seed-specific layouts and reproduces them identically when returning to a seed', () => {
    setEra('present');
    setWorldSeed(0);
    const seed0A = planInfrastructure(terrainHeight);

    setWorldSeed(7);
    const seed7 = planInfrastructure(terrainHeight);
    expect(seed7.substations[0].north).not.toBeCloseTo(seed0A.substations[0].north, 0);
    expect(seed7.masts[0].north).not.toBeCloseTo(seed0A.masts[0].north, 0);

    setWorldSeed(0);
    const seed0B = planInfrastructure(terrainHeight);
    expect(seed0B.pylons.map((p) => [p.north, p.east, p.height])).toEqual(seed0A.pylons.map((p) => [p.north, p.east, p.height]));
    expect(seed0B.masts.map((m) => [m.id, m.north, m.east, m.height])).toEqual(seed0A.masts.map((m) => [m.id, m.north, m.east, m.height]));
  });

  it('builds instanced pylons, 3D catenary cables, radio masts and red obstruction beacons with finite geometry', () => {
    setEra('present');
    setWorldSeed(0);
    const built = buildInfrastructure(terrainHeight);

    const byName = (name: string) => built.group.children.find((o) => o.name === name);
    const susp = byName('infra-pylons-suspension') as THREE.InstancedMesh | undefined;
    const strain = byName('infra-pylons-strain') as THREE.InstancedMesh | undefined;
    const structs = byName('infra-structures') as THREE.Mesh | undefined;
    const cables = byName('infra-cables') as THREE.Mesh | undefined;

    expect(susp).toBeDefined();
    expect(strain).toBeDefined();
    expect(structs).toBeDefined();
    expect(cables).toBeDefined();
    expect(susp!.count + strain!.count).toBe(built.plan.pylons.length);

    // Every generated vertex is finite.
    for (const mesh of [susp!, strain!, structs!, cables!]) {
      const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
      expect(pos.count).toBeGreaterThan(20);
      for (let i = 0; i < pos.array.length; i++) {
        expect(Number.isFinite(pos.array[i])).toBe(true);
      }
    }

    // Flashing L-864 and steady L-810 red obstruction beacons are generated for tall masts and towers.
    const redLights = built.lights.filter((l) => l.colorA === LIGHT_COLORS.red);
    expect(redLights.length).toBeGreaterThanOrEqual(built.plan.masts.length);
    expect(redLights.some((l) => l.flash !== undefined && l.cd >= 1400)).toBe(true);
    expect(redLights.some((l) => l.flash === undefined && l.cd >= 250)).toBe(true);
  });

  it('builds nothing outside the present day (Deep Time / Cretaceous stays completely bare)', () => {
    setEra('cretaceous');
    const plan = planInfrastructure(terrainHeight);
    expect(plan.pylons).toHaveLength(0);
    expect(plan.masts).toHaveLength(0);
    const built = buildInfrastructure(terrainHeight);
    expect(built.group.children).toHaveLength(0);
    expect(built.lights).toHaveLength(0);
    setEra('present');
  });
});
