// Algorithmic high-tension power transmission corridors and radio masts across seeds, plus 3D mesh & lighting checks.

import { afterAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { setEra } from '../../src/world/era/eraState';
import { setWorldSeed } from '../../src/world/worldSeed';
import { makeSample, sampleTerrain, terrainHeight } from '../../src/world/terrain/heightfield';
import { buildInfrastructure } from '../../src/world/airport/infrastructure';
import {
  infrastructureClearings,
  obstacleClearOfAirfields,
  planInfrastructure,
  PYLON_LOWEST_INSULATOR_FRAC,
} from '../../src/world/airport/infrastructurePlan';
import { LIGHT_COLORS } from '../../src/world/airport/lights';
import { computeBiome, coverShape, makeBiome, makeCoverShape } from '../../src/world/terrain/biome';
import {
  CORRIDOR_HALF_WIDTH,
  corridorFieldFactor,
  corridorWoodFactor,
  reservoirLevelAt,
  setCorridorClearings,
} from '../../src/world/terrain/corridorMask';
import { buildTreeCell, TREE_STRIDE, WALL_STRIDE } from '../../src/world/terrain/vegetation/placement';
import { createReservoirGeometries } from '../../src/world/terrain/water';

vi.setConfig({ testTimeout: 60_000 });

const SEEDS = [0, 1, 7];

afterAll(() => {
  setCorridorClearings(null);
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

  it('clears all trees, shelterbelts, clipped hedges and forest biome cover along high-tension corridors', () => {
    setEra('present');
    setWorldSeed(0);
    const plan = planInfrastructure(terrainHeight);
    setCorridorClearings(infrastructureClearings(plan));
    try {
      const samp = makeSample();
      const shape = makeCoverShape();
      const biome = makeBiome();

      // 1. Forest cover on the centreline of every span is completely cleared (0).
      for (const sp of plan.spans) {
        const p0 = plan.pylons[sp.from];
        const p1 = plan.pylons[sp.to];
        const mn = (p0.north + p1.north) * 0.5;
        const me = (p0.east + p1.east) * 0.5;
        sampleTerrain(mn, me, samp);
        coverShape(mn, me, samp.ground, shape);
        computeBiome(mn, me, samp, shape.up, biome, shape.north);
        expect(biome.forest).toBe(0);
      }

      // 2. Sample tree cells across the transmission corridors and verify zero trees or hedge walls lie inside CORRIDOR_HALF_WIDTH.
      const checkedCells = new Set<string>();
      const segDist = (n: number, e: number, an: number, ae: number, bn: number, be: number): number => {
        const dn = bn - an, de = be - ae;
        const l2 = dn * dn + de * de;
        const t = l2 > 1e-6 ? Math.max(0, Math.min(1, ((n - an) * dn + (e - ae) * de) / l2)) : 0;
        return Math.hypot(n - (an + dn * t), e - (ae + de * t));
      };

      for (let si = 0; si < plan.spans.length && checkedCells.size < 14; si += Math.max(1, Math.floor(plan.spans.length / 14))) {
        const sp = plan.spans[si];
        const p0 = plan.pylons[sp.from];
        const p1 = plan.pylons[sp.to];
        const mn = (p0.north + p1.north) * 0.5;
        const me = (p0.east + p1.east) * 0.5;
        const cx = Math.floor(me / 256);
        const cz = Math.floor(mn / 256);
        const key = `${cx},${cz}`;
        if (checkedCells.has(key)) continue;
        checkedCells.add(key);

        const cell = buildTreeCell({ cx, cz, size: 256, spacing: 5.5 });
        for (let k = 0; k < cell.count; k++) {
          const te = cell.instances[k * TREE_STRIDE];
          const tn = cell.instances[k * TREE_STRIDE + 2];
          for (const s2 of plan.spans) {
            const a = plan.pylons[s2.from];
            const b = plan.pylons[s2.to];
            expect(segDist(tn, te, a.north, a.east, b.north, b.east)).toBeGreaterThanOrEqual(CORRIDOR_HALF_WIDTH);
          }
        }
        for (let w = 0; w < cell.walls.length; w += WALL_STRIDE) {
          const we0 = cell.walls[w], wn0 = cell.walls[w + 1];
          const we1 = cell.walls[w + 3], wn1 = cell.walls[w + 4];
          const wmN = (wn0 + wn1) * 0.5, wmE = (we0 + we1) * 0.5;
          for (const s2 of plan.spans) {
            const a = plan.pylons[s2.from];
            const b = plan.pylons[s2.to];
            expect(segDist(wmN, wmE, a.north, a.east, b.north, b.east)).toBeGreaterThanOrEqual(CORRIDOR_HALF_WIDTH - 2.5);
          }
        }
      }
    } finally {
      setCorridorClearings(null);
    }
  });

  it('sites occasional watertight hydro dams + impounded reservoirs in narrow large-catchment valleys and wires pylons to them', { timeout: 180_000 }, () => {
    setEra('present');
    const sweepSeeds = [0, 1, 2, 7, 42];
    let seedsWithDams = 0;
    let totalDams = 0;

    for (const seed of sweepSeeds) {
      setWorldSeed(seed);
      const plan = planInfrastructure(terrainHeight);
      expect(plan.dams.length).toBeLessThanOrEqual(2);

      if (plan.dams.length > 0) {
        seedsWithDams++;
        totalDams += plan.dams.length;
        const summary = plan.dams
          .map(
            (d) =>
              `${d.id}(${d.kind} N=${d.north.toFixed(0)} E=${d.east.toFixed(0)} crestElev=${d.crestElevation.toFixed(0)} hdg=${d.heading.toFixed(2)} crest=${d.crestLength}m H=${d.wallHeight}m catch=${d.catchmentKm2}km² lake=${d.reservoirAreaKm2}km²/${d.reservoirLengthM}m)`,
          )
          .join(', ');
        console.log(`seed ${seed} hydro dams: ${summary}`);

        // Every sited dam anchors a `sub-hydro` switchyard AND originates a connected high-tension pylon corridor right at the dam!
        plan.dams.forEach((dam, di) => {
          const subId = di === 0 ? 'sub-hydro' : `sub-hydro-${di + 1}`;
          const subIdx = plan.substations.findIndex((s) => s.id === subId);
          expect(subIdx).toBeGreaterThanOrEqual(0);
          const hydroSub = plan.substations[subIdx];
          expect(Math.hypot(hydroSub.north - dam.switchyardNorth, hydroSub.east - dam.switchyardEast)).toBeLessThan(1);

          const conn = plan.terminalConnections.find((tc) => tc.substation === subIdx);
          expect(conn).toBeDefined();
          const firstPylon = plan.pylons[conn!.pylon];
          expect(Math.hypot(firstPylon.north - hydroSub.north, firstPylon.east - hydroSub.east)).toBeLessThan(85);
          expect(plan.spans.some((sp) => sp.from === conn!.pylon || sp.to === conn!.pylon)).toBe(true);
        });

        // Verify physical valley & reservoir invariants and 3D reservoir water mesh generation.
        const resGeos = createReservoirGeometries(plan.dams);
        expect(resGeos).toHaveLength(plan.dams.length);

        setCorridorClearings(infrastructureClearings(plan));
        try {
          for (let di = 0; di < plan.dams.length; di++) {
            const dam = plan.dams[di];
            expect(dam.catchmentKm2).toBeGreaterThanOrEqual(35);
            expect(dam.crestLength).toBeGreaterThanOrEqual(50);
            expect(dam.crestLength).toBeLessThanOrEqual(1040);
            expect(dam.wallHeight).toBeGreaterThanOrEqual(24);
            expect(dam.reservoirAreaKm2).toBeGreaterThanOrEqual(0.16);
            expect(dam.reservoirLengthM).toBeGreaterThanOrEqual(650);
            expect(obstacleClearOfAirfields(dam.north, dam.east, dam.bedElevation, dam.wallHeight + 20)).toBe(true);

            // Check reservoir geometry has finite vertices at `y = dam.waterLevel` and positive max depth.
            const g = resGeos[di];
            const pos = g.attributes.position as THREE.BufferAttribute;
            const dep = g.attributes.aDepth as THREE.BufferAttribute;
            expect(pos.count).toBeGreaterThan(20);
            let maxDepth = -Infinity;
            for (let v = 0; v < pos.count; v++) {
              expect(Number.isFinite(pos.getX(v))).toBe(true);
              expect(pos.getY(v)).toBeCloseTo(dam.waterLevel, 3);
              expect(Number.isFinite(pos.getZ(v))).toBe(true);
              maxDepth = Math.max(maxDepth, dep.getX(v));
            }
            expect(maxDepth).toBeGreaterThan(15);

            // Check a point 60 m upstream of the dam crown is flooded in `reservoirLevelAt` and cleared of forest/farmland.
            const upN = dam.north - Math.cos(dam.heading) * (dam.archSagitta + 60);
            const upE = dam.east - Math.sin(dam.heading) * (dam.archSagitta + 60);
            expect(reservoirLevelAt(upN, upE)).toBeCloseTo(dam.waterLevel, 3);
            expect(corridorWoodFactor(upN, upE)).toBe(0);
            expect(corridorFieldFactor(upN, upE)).toBe(0);
            g.dispose();
          }
        } finally {
          setCorridorClearings(null);
        }
      } else {
        console.log(`seed ${seed} hydro dams: none (no qualifying narrow large-catchment gorge)`);
      }
    }

    // Hydro dams must appear on suitable seeds yet remain genuinely occasional across the seed sweep.
    expect(seedsWithDams).toBeGreaterThanOrEqual(2);
    expect(totalDams).toBeLessThanOrEqual(sweepSeeds.length * 2);
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
