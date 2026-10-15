// Creature art integration (Deep Time): FaunaSystem draws WP4's species meshes and animated materials through its
// FaunaArt seam, and the behaviour side writes the channels the material reads (layout, origins, alert, strides,
// launch timing, variant fraction).

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventBus, type SimContext } from '../../src/core/context';
import { defaultWeather } from '../../src/core/types';
import { createWorldEnvironment } from '../../src/sim/worldEnvironment';
import { eraById } from '../../src/world/era/registry';
import { CREATURE_ART } from '../../src/world/fauna/art';
import { faunaVertexGLSL } from '../../src/world/fauna/faunaMaterial';
import { createFaunaSystem, type FaunaSystemImpl } from '../../src/world/fauna/FaunaSystem';
import { FLYER_MODE, FlyerPool, LAUNCH_END_PHASE, LAUNCH_S, WALK_STRIDE, launchPose } from '../../src/world/fauna/flight';
import { countingTerrain } from '../../src/world/fauna/habitat';
import { HerdPool, STRIDE_RUN, STRIDE_WALK } from '../../src/world/fauna/herds';
import { AZHDARCHID_LAUNCH_S, FAUNA_SPECIES, azhdarchidLaunch, buildFaunaSpecies } from '../../src/world/fauna/species/index';
import { SPECIES_REFERENCE_M } from '../../src/world/fauna/roster';
import { FAUNA_ATTR, FAUNA_STRIDE } from '../../src/world/fauna/types';
import { setEra } from '../../src/world/era/eraState';

// The Cretaceous world (terrain with the volcano, environment, flora): createFaunaSystem's era only picks the roster.
beforeAll(() => {
  setEra('cretaceous');
});
afterAll(() => {
  setEra('present');
});

function makeCtx() {
  const weather = { ...defaultWeather(), timeOfDay: 12, cloudCover: 0.35, windSpeedKt: 6 };
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400000);
  const state = { position: { x: 0, y: 0, z: -400 }, velocity: { x: 0, y: 50, z: 0 }, tas: 50, altitudeAGL: 250 };
  const ctx = {
    scene: new THREE.Scene(),
    camera,
    state,
    weather,
    env: createWorldEnvironment(weather),
    sky: { dayFactor: 1 },
    simTime: 0,
    quality: 'high',
    events: createEventBus(),
  };
  return ctx as unknown as SimContext & { state: typeof state; simTime: number };
}

interface Draw {
  species: string;
  set: { lod0: THREE.BufferGeometry; caster: THREE.BufferGeometry; lengthM: number };
  mats: { material: THREE.Material; depthMaterial: THREE.Material; setTime?(t: number): void };
  lod: { mesh: THREE.Mesh; geometry: THREE.InstancedBufferGeometry; array: Float32Array; count: number }[];
  caster: { mesh: THREE.Mesh; geometry: THREE.InstancedBufferGeometry; array: Float32Array; count: number };
  originM: number;
  unit: number;
}

function build() {
  const sys = createFaunaSystem(eraById('cretaceous'), { terrain: countingTerrain() }) as FaunaSystemImpl;
  const ctx = makeCtx();
  sys.init(ctx);
  return { sys, ctx, draws: (sys as unknown as { draws: Draw[] }).draws };
}

describe('creature art in the fauna system', () => {
  it('draws the species meshes and animated materials by default, in init', () => {
    const { draws } = build();
    expect(draws.map((d) => d.species).sort()).toEqual(['alamosaurus', 'azhdarchidSmall', 'edmontosaurus', 'pteranodon', 'quetzalcoatlus', 'triceratops', 'tyrannosaurus']);
    for (const d of draws) {
      const ref = buildFaunaSpecies(d.species as 'edmontosaurus');
      expect(d.set.lod0.index!.count).toBe(ref.lod0.index!.count);
      // The rig attributes reach the instanced geometry (aRig: limb coordinate and membrane chord).
      for (const a of ['position', 'normal', 'color', 'aBone', 'aBoneW', 'aRig']) expect(d.lod[0].geometry.getAttribute(a)).toBeTruthy();
      expect((d.mats.material as THREE.MeshStandardMaterial).customProgramCacheKey()).toMatch(/^fauna-v2-[0-4]$/);
      // The caster mesh draws the animated depth material into the shadow maps, and only it casts.
      expect(d.caster.mesh.customDepthMaterial).toBe(d.mats.depthMaterial);
      expect(d.caster.mesh.castShadow).toBe(true);
      for (const l of d.lod) expect(l.mesh.castShadow).toBe(false);
      // Real size: the inc-1 builders report the reference lengths (the inc-2 stubs are scaled by the unit).
      if (['edmontosaurus', 'quetzalcoatlus', 'azhdarchidSmall'].includes(d.species)) expect(d.unit).toBeCloseTo(1, 6);
      expect(d.unit * d.set.lengthM).toBeCloseTo(SPECIES_REFERENCE_M[d.species as 'edmontosaurus'], 5);
      expect(d.originM).toBe(FAUNA_SPECIES[d.species as 'edmontosaurus'].groundOffsetM);
    }
  });

  it('instance attributes match the material: vec4 aInstA/B/C at 0/4/8 of a 12-float stride', () => {
    const { draws } = build();
    const glsl = faunaVertexGLSL(0);
    for (const name of Object.keys(FAUNA_ATTR)) expect(glsl).toContain(`attribute vec4 ${name};`);
    for (const d of draws) {
      for (const g of [...d.lod.map((l) => l.geometry), d.caster.geometry]) {
        for (const [name, offset] of Object.entries(FAUNA_ATTR)) {
          const a = g.getAttribute(name) as THREE.InterleavedBufferAttribute;
          expect(a.isInterleavedBufferAttribute).toBe(true);
          expect(a.itemSize).toBe(4);
          expect(a.offset).toBe(offset);
          expect(a.data.stride).toBe(FAUNA_STRIDE);
        }
      }
    }
  });

  it('places the azhdarchid origin (centre of mass) above the feet of a standing bird', () => {
    const { sys, ctx, draws } = build();
    const F = sys.flyers;
    // The resting pair stands on the Flats: look at it from 60 m.
    let i = -1;
    for (let k = 0; k < F.capacity; k++) if (F.active[k] && F.mode[k] === FLYER_MODE.stand) i = k;
    expect(i).toBeGreaterThanOrEqual(0);
    ctx.camera.position.set(F.e[i] - 60, F.ground[i] + 3, -F.n[i]);
    ctx.camera.lookAt(F.e[i], F.ground[i] + 3, -F.n[i]);
    ctx.camera.updateMatrixWorld();
    sys.update(1 / 60, ctx);
    const q = draws.find((d) => d.species === 'quetzalcoatlus')!;
    expect(q.lod[0].count).toBeGreaterThan(0);
    const a = q.lod[0].array;
    let found = false;
    for (let k = 0; k < q.lod[0].count; k++) {
      const o = k * FAUNA_STRIDE;
      if (Math.abs(a[o] - F.e[i]) < 0.5 && Math.abs(a[o + 2] - F.n[i]) < 0.5) {
        expect(a[o + 1]).toBeCloseTo(F.alt[i] + FAUNA_SPECIES.quetzalcoatlus.groundOffsetM * F.scale[i], 3);
        expect(a[o + 7]).toBeLessThan(1.01); // standing / walking gait
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('an alert herd stands with its head up (alert in aInstC.x, gaitBlend 0); fleeing animals run alert', () => {
    const terrain = countingTerrain();
    const pool = new HerdPool();
    const n0 = 1000;
    const e0 = 1000;
    const g = terrain.height(n0, e0);
    const h = pool.spawn({ north: n0, east: e0, ground: g, size: 30, entry: 0, scale: 1, variant: 0, seed: 5, heading: 0, pinned: true }, -1);
    const base = h * pool.memberCap;
    for (let k = 0; k < 30; k++) {
      expect(pool.variant[base + k]).toBeGreaterThanOrEqual(0);
      expect(pool.variant[base + k]).toBeLessThan(1);
    }
    // Hovering 500 m away and 200 m up: alert, not flee.
    const ac = { n: n0 - 500, e: e0, alt: g + 200, vN: 0, vE: 0, vD: 0, tas: 30 };
    for (let s = 0; s < 300; s++) pool.step(1 / 60, ac, terrain, 200, n0, e0);
    expect(pool.fleeing[h]).toBe(0);
    for (let k = 0; k < 30; k++) {
      expect(pool.alert[base + k]).toBeGreaterThan(0.95);
      expect(pool.blend[base + k]).toBeLessThan(0.25);
    }
    // A low fast pass: they run (bipedal) with the head up.
    for (let s = 0; s < 600; s++) {
      ac.n = n0 - 300 + s * 0.8;
      ac.alt = g + 40;
      ac.vN = 50;
      ac.tas = 50;
      pool.step(1 / 60, ac, terrain, 200, n0, e0);
    }
    let running = 0;
    for (let k = 0; k < 30; k++) if (pool.blend[base + k] > 1.3) {
      running++;
      expect(pool.alert[base + k]).toBeGreaterThan(0.9);
    }
    expect(running).toBeGreaterThan(10);
  });

  it('the behaviour strides and launch timing are the art’s', () => {
    expect(STRIDE_WALK).toBe(FAUNA_SPECIES.edmontosaurus.strideM.walk);
    expect(STRIDE_RUN).toBe(FAUNA_SPECIES.edmontosaurus.strideM.run);
    expect(WALK_STRIDE).toBe(FAUNA_SPECIES.quetzalcoatlus.strideM.walk);
    expect(LAUNCH_S).toBe(AZHDARCHID_LAUNCH_S);
    for (let p = 0; p <= 1.0001; p += 0.05) {
      expect(launchPose(p).climbM).toBeCloseTo(azhdarchidLaunch(p * AZHDARCHID_LAUNCH_S).climbM, 9);
    }
    // The first downstroke ends at the bottom of the flight stroke (sin 2 pi phase = -1) and runs ~1 Hz into it.
    expect(launchPose(1).phase).toBeCloseTo(LAUNCH_END_PHASE, 9);
    expect(Math.sin(2 * Math.PI * LAUNCH_END_PHASE)).toBeCloseTo(-1, 9);
    const rate = (launchPose(0.95).phase - launchPose(0.85).phase) / (0.1 * LAUNCH_S);
    expect(rate).toBeGreaterThan(0.8);
    expect(rate).toBeLessThan(1.4);
  });

  it('a launch flaps from the start, hands over to the climb-out without a phase jump, and keeps a variant fraction', () => {
    const terrain = countingTerrain();
    const pool = new FlyerPool(8);
    const g = terrain.height(0, 0);
    const i = pool.spawn({ north: 0, east: 0, alt: g, ground: g, entry: 1, scale: 1, size: 1, variant: 0, seed: 9, mode: FLYER_MODE.stand, heading: 0, anchorN: 0, anchorE: 0 });
    expect(pool.variant[i]).toBeGreaterThan(0);
    expect(pool.variant[i]).toBeLessThan(1);
    const ac = { n: -300, e: 0, alt: g + 2, vN: 30, vE: 0, vD: 0, tas: 30 };
    let launched = false;
    let lastPhase = 0;
    for (let s = 0; s < 600; s++) {
      pool.step(1 / 60, s / 60, null, ac, terrain, 200, true, 0, 0);
      if (pool.mode[i] === FLYER_MODE.launch) {
        launched = true;
        expect(pool.flap[i]).toBe(1);
        lastPhase = pool.phase[i];
      } else if (launched) {
        // First frame after the launch: the wingbeat continues from the end of the downstroke.
        const d = Math.abs(pool.phase[i] - lastPhase);
        expect(Math.min(d, 1 - d)).toBeLessThan(0.06);
        expect(pool.blend[i]).toBe(2);
        break;
      }
    }
    expect(launched).toBe(true);
  });

  it('art adapter: setTime drives uTime', () => {
    const set = buildFaunaSpecies('edmontosaurus');
    const m = CREATURE_ART.materials('edmontosaurus', set);
    m.setTime!(12.5);
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>\n#include <lights_physical_fragment>\n#include <lights_fragment_maps>' };
    (m.material as THREE.MeshStandardMaterial).onBeforeCompile(shader as never, undefined as never);
    expect(shader.uniforms.uTime.value).toBe(12.5);
    m.dispose?.();
  });
});
