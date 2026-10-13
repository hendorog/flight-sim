// Pteranodon (Deep Time inc 2, WP4): a Look-only variant on the azhdarchid rig. The crest reaches well past the
// skull, kettle 0 holds 3 of them on the evening core, the colours separate them from the azhdarchids, and the
// species adds no per-frame allocation.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createEventBus, type SimContext } from '../../src/core/context';
import { defaultWeather } from '../../src/core/types';
import { createWorldEnvironment } from '../../src/sim/worldEnvironment';
import { SAFARI } from '../../src/world/era/cretaceousAnchors';
import { eraById } from '../../src/world/era/registry';
import { createFaunaSystem, type FaunaSystemImpl } from '../../src/world/fauna/FaunaSystem';
import { countingTerrain } from '../../src/world/fauna/habitat';
import { ROSTERS, SPECIES_REFERENCE_M } from '../../src/world/fauna/roster';
import { PTERANODON_SKULL_REAR_X, createPteranodon } from '../../src/world/fauna/species/pteranodon';
import { PROFILE } from '../../src/world/fauna/species/pteranodon.data';
import { BONE } from '../../src/world/fauna/types';

const DT = 1 / 60;

function boot() {
  const weather = { ...defaultWeather(), timeOfDay: SAFARI.tod, cloudCover: 0.35, windSpeedKt: 6 };
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400000);
  const state = { position: { x: 0, y: 0, z: -400 }, velocity: { x: 0, y: -60, z: 0 }, tas: 60, altitudeAGL: 137 };
  const ctx = { scene: new THREE.Scene(), camera, state, weather, env: createWorldEnvironment(weather), sky: { dayFactor: 1 }, simTime: 0, quality: 'high', events: createEventBus() } as unknown as SimContext & { simTime: number };
  const sys = createFaunaSystem(eraById('cretaceous'), { terrain: countingTerrain() }) as FaunaSystemImpl;
  sys.init(ctx);
  return { sys, ctx };
}

describe('pteranodon body', () => {
  const set = createPteranodon();
  const unit = SPECIES_REFERENCE_M.pteranodon / set.lengthM;

  it('has a crest tip at least 0.6 m behind the skull (drawn size)', () => {
    const pos = set.lod0.getAttribute('position');
    const bone = set.lod0.getAttribute('aBone');
    let minX = Infinity;
    for (let i = 0; i < pos.count; i++) if (bone.getX(i) === BONE.head) minX = Math.min(minX, pos.getX(i));
    // The skull's rear is at PTERANODON_SKULL_REAR_X in ground coordinates; the loft is centred on the origin in x.
    const behind = (PTERANODON_SKULL_REAR_X - minX) * unit;
    // (The body origin is at the centre of mass: x is unshifted, so the comparison is direct.)
    expect(behind).toBeGreaterThanOrEqual(0.6);
  });

  it('is drawn at a 6.5 m span', () => {
    set.lod0.computeBoundingBox();
    expect(set.lod0.boundingBox!.getSize(new THREE.Vector3()).z * unit).toBeCloseTo(6.5, 0);
  });

  it('is a pale body with dark wings (the contrast that separates it from the azhdarchids)', () => {
    const lum = (c: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number): number => 0.3 * c.getX(i) + 0.6 * c.getY(i) + 0.1 * c.getZ(i);
    const c = set.lod0.getAttribute('color');
    const bone = set.lod0.getAttribute('aBone');
    let body = 0;
    let nb = 0;
    let wing = 0;
    let nw = 0;
    for (let i = 0; i < c.count; i++) {
      const b = bone.getX(i);
      if (b === BONE.wingL || b === BONE.wingR) { wing += lum(c, i); nw++; }
      else if (b === BONE.spine1 || b === BONE.spine2 || b === BONE.neck1) { body += lum(c, i); nb++; }
    }
    expect(body / nb).toBeGreaterThan(1.6 * (wing / nw));
  });

  it('meets its profile and the plan caps', () => {
    expect(PROFILE.render.tris).toEqual([1500, 250, 40, 600]);
    expect(PROFILE.flapHz).toBe(1.4);
    expect(PROFILE.speed).toEqual({ walk: 1.0, run: 2.0 });
    expect(PROFILE.render.lod0Max).toEqual({ low: 6, medium: 10, high: 14, ultra: 20 });
  });
});

describe('pteranodon in the Cretaceous', () => {
  it('kettle 0 holds 3 Pteranodon at SAFARI.tod on the evening core', () => {
    const { sys } = boot();
    const F = sys.flyers;
    let n = 0;
    for (let i = 0; i < F.capacity; i++) {
      if (F.active[i] && sys.kettleOf[i] === 0 && ROSTERS.cretaceous.entries[F.entry[i]].species === 'pteranodon') n++;
    }
    expect(n).toBe(3);
  });

  it('allocates nothing per frame: instance buffers are stable across 300 frames', () => {
    const { sys, ctx } = boot();
    const draws = (sys as unknown as { draws: { lod: { array: Float32Array; buffer: unknown }[]; caster: { array: Float32Array; buffer: unknown } }[] }).draws;
    const before = draws.flatMap((d) => [...d.lod, d.caster].map((x) => [x.array, x.buffer]));
    for (let k = 0; k < 300; k++) {
      ctx.simTime += DT;
      sys.update(DT, ctx);
    }
    const after = draws.flatMap((d) => [...d.lod, d.caster].map((x) => [x.array, x.buffer]));
    after.forEach((p, k) => {
      expect(p[0]).toBe(before[k][0]);
      expect(p[1]).toBe(before[k][1]);
    });
    expect(sys.stats.reallocs).toBe(0);
  });
});
