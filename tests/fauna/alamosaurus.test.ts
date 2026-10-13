// Alamosaurus (Deep Time inc 2, WP3): the sauropod rig's chain depth, the browse head height, the walk's lagging
// tail and planted feet (through the CPU mirror of poses/sauropod.ts), and the pinned far showcase trio (never
// released, drawn as LOD2 to 12 km, cheap on terrain reads beyond NEAR_SNAP_M).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createEventBus, type SimContext } from '../../src/core/context';
import { defaultWeather } from '../../src/core/types';
import { createWorldEnvironment } from '../../src/sim/worldEnvironment';
import { ALAMOSAURUS_STAND } from '../../src/world/era/cretaceousAnchors';
import { eraById } from '../../src/world/era/registry';
import { faunaVertexGLSL } from '../../src/world/fauna/faunaMaterial';
import { createFaunaSystem, type FaunaSystemImpl } from '../../src/world/fauna/FaunaSystem';
import { countingTerrain, type FaunaTerrain } from '../../src/world/fauna/habitat';
import { HerdPool, NEAR_SNAP_M } from '../../src/world/fauna/herds';
import { FAUNA_PRESETS } from '../../src/world/fauna/presets';
import { SAUROPOD_GAIT } from '../../src/world/fauna/poses/sauropod';
import { PROFILES } from '../../src/world/fauna/profiles';
import { ROSTERS } from '../../src/world/fauna/roster';
import { buildFaunaSpecies, FAUNA_SPECIES } from '../../src/world/fauna/species/index';
import { makeSample, type TerrainSample } from '../../src/world/terrain/heightfield';
import { BONE, BONE_COUNT, RIG } from '../../src/world/fauna/types';
import type { V } from './poseMirror';
import { sauLeg, sauropodPose, sauropodPositions } from './sauropodPoseMirror';

const set = buildFaunaSpecies('alamosaurus');
const lods = [set.lod0, set.lod1, set.lod2, set.caster];
const P = PROFILES.alamosaurus;
const mean = (ps: V[]): V => {
  const s: V = [0, 0, 0];
  for (const p of ps) for (let k = 0; k < 3; k++) s[k] += p[k] / ps.length;
  return s;
};
const only = (...bones: number[]) => (b: number): boolean => bones.includes(b);

describe('Alamosaurus body and rig', () => {
  it('is the sauropod rig, 26 m nose to tail, drawn at unit scale', () => {
    expect(FAUNA_SPECIES.alamosaurus.rig).toBe('sauropod');
    expect(RIG[FAUNA_SPECIES.alamosaurus.rig]).toBe(4);
    expect(set.lengthM).toBe(26);
    set.lod0.computeBoundingBox();
    expect(set.lod0.boundingBox!.max.x - set.lod0.boundingBox!.min.x).toBeCloseTo(26, 0);
    // The shoulder is taller than the hip (titanosaur stance) and ~4 m.
    const piv = set.pivots;
    expect(piv[BONE.legFR * 4 + 1]).toBeGreaterThan(piv[BONE.legHR * 4 + 1]);
    expect(piv[BONE.legFR * 4 + 1]).toBeGreaterThan(3.8);
    expect(piv[BONE.legFR * 4 + 1]).toBeLessThan(4.6);
  });

  it('chains every vertex to the root within the shader bound (<= 8 parents), the neck on the aliased bones', () => {
    const piv = set.pivots;
    const depth = (b: number): number => {
      let n = 0;
      for (let i = piv[b * 4 + 3]; i >= 0; i = piv[i * 4 + 3]) {
        n++;
        if (n > BONE_COUNT) return Infinity;
      }
      return n;
    };
    for (const g of lods) {
      const bone = g.getAttribute('aBone').array as Float32Array;
      for (let v = 0; v < bone.length; v++) expect(depth(bone[v])).toBeLessThanOrEqual(8);
    }
    // head -> wingR (neck4) -> wingL (neck3) -> neck2 -> neck1 -> spine2 -> spine1 -> root: 7.
    expect(piv[BONE.head * 4 + 3]).toBe(BONE.wingR);
    expect(piv[BONE.wingR * 4 + 3]).toBe(BONE.wingL);
    expect(piv[BONE.wingL * 4 + 3]).toBe(BONE.neck2);
    expect(depth(BONE.head)).toBe(7);
    // The parked jaw draws nothing; the neck bones all carry vertices in every LOD.
    for (const g of lods) {
      const bones = new Set(Array.from(g.getAttribute('aBone').array as Float32Array));
      expect(bones.has(BONE.jaw)).toBe(false);
      for (const b of [BONE.neck1, BONE.neck2, BONE.wingL, BONE.wingR, BONE.tail1, BONE.tail2, BONE.tail3]) expect(bones.has(b), `bone ${b}`).toBe(true);
    }
    // The wing sub-joint slots are unused (uSub 6-8 at w = 1e6) and the rig has no wing define.
    const sub = FAUNA_SPECIES.alamosaurus.render.subJoints();
    for (let k = 6; k < 9; k++) expect(sub[k * 4 + 3]).toBe(1e6);
    expect(faunaVertexGLSL(4)).toContain('sauIK');
  });
});

describe('Alamosaurus pose (CPU mirror)', () => {
  const headY = (time: number, seed: number, gaitBlend = 0, flap = 0): number =>
    mean(sauropodPositions(set, set.lod1, { phase: 0.3, gaitBlend, flap, time, seed }, only(BONE.head)))[1];

  it('browses with the head at least 9.5 m up through the whole reach cycle, raising it into the canopy', () => {
    for (const seed of [0.05, 0.37, 0.81]) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let t = 0; t <= 26; t += 0.5) {
        const y = headY(t, seed);
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
      expect(lo).toBeGreaterThanOrEqual(9.5);
      // The neck visibly rises and falls (the "slow sweeps up into the canopy").
      expect(hi - lo).toBeGreaterThan(1.0);
      expect(hi).toBeLessThan(13);
    }
  });

  it('carries the neck 30-45 deg up while browsing and lower on the walk', () => {
    const angle = (gaitBlend: number, time: number): number => {
      const a = mean(sauropodPositions(set, set.lod1, { phase: 0.2, gaitBlend, flap: 0, time, seed: 0.4 }, only(BONE.neck1)));
      const h = mean(sauropodPositions(set, set.lod1, { phase: 0.2, gaitBlend, flap: 0, time, seed: 0.4 }, only(BONE.head)));
      return (Math.atan2(h[1] - a[1], Math.hypot(h[0] - a[0], h[2] - a[2])) * 180) / Math.PI;
    };
    for (let t = 0; t <= 26; t += 1) {
      const a = angle(0, t);
      expect(a).toBeGreaterThan(28);
      expect(a).toBeLessThan(47);
    }
    expect(angle(1, 3)).toBeLessThan(angle(0, 3) - 3);
  });

  it('turns the head over the four neck bones', () => {
    const at = (headTurn: number): V => mean(sauropodPositions(set, set.lod1, { phase: 0.2, gaitBlend: 1, flap: 0, headTurn, time: 0 }, only(BONE.head)));
    // + = right (+z in body space).
    expect(at(0.6)[2] - at(0)[2]).toBeGreaterThan(2);
    expect(at(-0.6)[2] - at(0)[2]).toBeLessThan(-2);
    const p = sauropodPose({ phase: 0, gaitBlend: 1, flap: 0, headTurn: 0.6 }, BONE.head);
    for (const b of [BONE.neck1, BONE.neck2, BONE.wingL, BONE.wingR]) expect(Math.abs(p.fQ[b][1])).toBeGreaterThan(0.02);
  });

  it.each([1, 2])('swings the tail with a lag that grows monotonically down the tail (gait %s)', (gaitBlend) => {
    const N = 48;
    const lag: number[] = [];
    const amp: number[] = [];
    for (const b of [BONE.tail1, BONE.tail2, BONE.tail3]) {
      let s = 0;
      let c = 0;
      for (let k = 0; k < N; k++) {
        const ph = k / N;
        const z = mean(sauropodPositions(set, set.lod1, { phase: ph, gaitBlend, flap: 0, time: 0 }, only(b)))[2];
        s += z * Math.sin(2 * Math.PI * ph);
        c += z * Math.cos(2 * Math.PI * ph);
      }
      // z ~ R sin(2 pi ph - lag): sum z sin = R N/2 cos(lag), sum z cos = -R N/2 sin(lag).
      lag.push(Math.atan2(-c, s));
      amp.push((2 / N) * Math.hypot(s, c));
    }
    expect(lag[0]).toBeGreaterThan(0);
    expect(lag[1]).toBeGreaterThan(lag[0] + 0.1);
    expect(lag[2]).toBeGreaterThan(lag[1] + 0.1);
    expect(amp[1]).toBeGreaterThan(amp[0]);
    expect(amp[2]).toBeGreaterThan(amp[1]);
    // The tip swings a visible ~0.5-2 m.
    expect(amp[2]).toBeGreaterThan(0.4);
    expect(amp[2]).toBeLessThan(2.5);
  });

  // The pad bottom of each leg: the leg's vertices within 12 cm of its lowest rest point.
  const legs: number[] = [BONE.legHL, BONE.legHR, BONE.legFL, BONE.legFR];
  const offsets = { [BONE.legHL]: 0, [BONE.legHR]: 0.5, [BONE.legFL]: SAUROPOD_GAIT.foreLag, [BONE.legFR]: 0.5 + SAUROPOD_GAIT.foreLag } as Record<number, number>;
  const padIdx = new Map<number, number[]>();
  {
    const g = set.lod0;
    const pos = g.getAttribute('position');
    const bone = g.getAttribute('aBone');
    for (const b of legs) {
      const idx: number[] = [];
      for (let v = 0; v < pos.count; v++) if (Math.round(bone.getX(v)) === b && pos.getY(v) < 0.12) idx.push(v);
      padIdx.set(b, idx);
    }
  }
  const allLegs = sauropodPositions.bind(null, set, set.lod0);

  it.each([
    [1, P.speed.walk, P.strideM.walk],
    [2, P.speed.run, P.strideM.run],
  ])('plants every stance foot: no skate at gait %s (sole slip < 0.15 m/s), no sinking, each girdle on the ground', (gaitBlend, speed, stride) => {
    // Body-space positions of all LOD0 vertices, per phase sample; the body moves +x by `stride` per cycle.
    const N = 80;
    const frames: V[][] = [];
    const legFilter = (b: number): boolean => legs.includes(b);
    for (let k = 0; k <= N; k++) frames.push(allLegs({ phase: k / N, gaitBlend, flap: 0, time: 0 }, legFilter));
    // Map vertex index -> position in the filtered list.
    const g = set.lod0;
    const bone = g.getAttribute('aBone');
    const order: number[] = [];
    for (let v = 0; v < bone.count; v++) if (legFilter(Math.round(bone.getX(v)))) order.push(v);
    const slot = new Map(order.map((v, i) => [v, i]));
    const dt = stride / N / speed;
    let worstSlip = 0;
    for (let k = 0; k <= N; k++) {
      let lowest = Infinity;
      let hindLow = Infinity;
      let foreLow = Infinity;
      for (const b of legs) {
        for (const v of padIdx.get(b)!) {
          const y = frames[k][slot.get(v)!][1];
          lowest = Math.min(lowest, y);
          if (b === BONE.legHL || b === BONE.legHR) hindLow = Math.min(hindLow, y);
          else foreLow = Math.min(foreLow, y);
        }
      }
      // No pad more than 6 cm into the ground; both girdles stand on it (no floating).
      expect(lowest).toBeGreaterThan(-0.06);
      expect(Math.abs(hindLow)).toBeLessThan(0.06);
      expect(Math.abs(foreLow)).toBeLessThan(0.06);
    }
    for (const b of legs) {
      for (let k = 0; k < N; k++) {
        const u0 = (k / N + offsets[b]) % 1;
        const u1 = ((k + 1) / N + offsets[b]) % 1;
        // Stance, away from touchdown and lift-off.
        if (!(u0 > 0.04 && u1 < SAUROPOD_GAIT.duty - 0.04 && u1 > u0)) continue;
        const a = mean(padIdx.get(b)!.map((v) => frames[k][slot.get(v)!]));
        const c = mean(padIdx.get(b)!.map((v) => frames[k + 1][slot.get(v)!]));
        // World x = body x + distance travelled.
        const slip = Math.hypot(c[0] + stride / N - a[0], c[2] - a[2]) / dt;
        worstSlip = Math.max(worstSlip, slip);
      }
    }
    expect(worstSlip).toBeLessThan(0.15);
  });

  it('stands square at gait 0: straight legs, pads on the ground, no root offset', () => {
    const p = sauropodPose({ phase: 0.37, gaitBlend: 0, flap: 0, time: 3 }, BONE.legHL);
    expect(Math.abs(p.fRootOff[1])).toBeLessThan(1e-9);
    expect(Math.abs(p.rootPitch)).toBeLessThan(1e-9);
    expect(sauLeg(0.3, 0)).toEqual([0, 0]);
    const ys = sauropodPositions(set, set.lod0, { phase: 0.37, gaitBlend: 0, flap: 0, time: 3 }, (b) => legs.includes(b)).map((v) => v[1]);
    expect(Math.min(...ys)).toBeGreaterThan(-0.06);
    expect(Math.min(...ys)).toBeLessThan(0.06);
  });
});

// ------------------------------------------------------------------------------------------------ the showcase

function flat(): FaunaTerrain & { calls: number } {
  const t = {
    calls: 0,
    sample(_n: number, _e: number, out: TerrainSample): TerrainSample {
      t.calls++;
      Object.assign(out, makeSample());
      out.ground = 100;
      out.standing = -1000;
      return out;
    },
    height(): number {
      t.calls++;
      return 100;
    },
  };
  return t;
}

function boot() {
  const weather = { ...defaultWeather(), timeOfDay: 19, cloudCover: 0.35, windSpeedKt: 6 };
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400000);
  const state = { position: { x: 0, y: 0, z: -400 }, velocity: { x: 0, y: -60, z: 0 }, tas: 60, altitudeAGL: 137 };
  const ctx = { scene: new THREE.Scene(), camera, state, weather, env: createWorldEnvironment(weather), sky: { dayFactor: 1 }, simTime: 0, quality: 'high', events: createEventBus() };
  const sys = createFaunaSystem(eraById('cretaceous'), { terrain: countingTerrain() }) as FaunaSystemImpl;
  sys.init(ctx as unknown as SimContext);
  const draws = (sys as unknown as { draws: { species: string; lod: { count: number }[] }[] }).draws;
  const herd = sys.showcaseHerds.find((h) => ROSTERS.cretaceous.entries[sys.herds.entry[h]].species === 'alamosaurus')!;
  return { sys, ctx: ctx as unknown as SimContext & { state: typeof state; simTime: number }, camera, draws, herd };
}

/** Put the aircraft and the camera `dist` m south of the stand, looking north at it. */
function viewFrom(b: ReturnType<typeof boot>, dist: number): void {
  const n = ALAMOSAURUS_STAND.north - dist;
  const e = ALAMOSAURUS_STAND.east;
  const h = ALAMOSAURUS_STAND.ground + 300;
  b.ctx.state.position.x = n;
  b.ctx.state.position.y = e;
  b.ctx.state.position.z = -h;
  b.camera.position.set(e, h, -n);
  b.camera.lookAt(e, ALAMOSAURUS_STAND.ground, -ALAMOSAURUS_STAND.north);
  b.camera.updateMatrixWorld();
}

describe('Alamosaurus showcase trio', () => {
  it('is a pinned trio at the stand that is never released, even with the aircraft 15 km away', () => {
    const b = boot();
    const H = b.sys.herds;
    expect(b.herd).toBeGreaterThanOrEqual(0);
    expect(H.size[b.herd]).toBe(3);
    expect(H.pinned[b.herd]).toBe(1);
    viewFrom(b, 15000);
    for (let k = 0; k < 60 * 20; k++) {
      b.ctx.simTime += 1 / 60;
      b.sys.update(1 / 60, b.ctx);
    }
    expect(H.active[b.herd]).toBe(1);
    expect(H.pinned[b.herd]).toBe(1);
    expect(ROSTERS.cretaceous.entries[H.entry[b.herd]].species).toBe('alamosaurus');
    expect(Math.hypot(H.cN[b.herd] - ALAMOSAURUS_STAND.north, H.cE[b.herd] - ALAMOSAURUS_STAND.east)).toBeLessThan(P.formation.leash + 50);
  });

  it('draws as LOD2 out to 12 km and not beyond', () => {
    const b = boot();
    const counts = (): number[] => b.draws.find((d) => d.species === 'alamosaurus')!.lod.map((l) => l.count);
    // Beyond the (x2) LOD1 band, LOD2 to farRangeM whatever the quality's lod2Range.
    expect(FAUNA_PRESETS.high.lod1Range * P.render.lodRangeScale).toBeLessThan(6000);
    for (const dist of [6000, 9000, 11800]) {
      viewFrom(b, dist);
      b.sys.update(0, b.ctx);
      expect(counts(), `${dist} m`).toEqual([0, 0, 3]);
    }
    viewFrom(b, 12300);
    b.sys.update(0, b.ctx);
    expect(counts()).toEqual([0, 0, 0]);
    // Near: LOD0 (x2 bands: 600 m on high).
    viewFrom(b, 400);
    b.sys.update(0, b.ctx);
    expect(counts()[0]).toBe(3);
  });

  it('beyond NEAR_SNAP_M takes <= 2 terrain reads per brain tick, browsing and walking', () => {
    const pool = new HerdPool();
    const h = pool.spawn({ north: 0, east: 0, ground: 100, size: 3, entry: 4, scale: 1, variant: 0, seed: 0xa1a305, heading: 0, pinned: true, species: 'alamosaurus' }, -1);
    const terrain = flat();
    let ticks = 0;
    let walked = false;
    let grazed = false;
    for (let k = 0; k < 60 * 300; k++) {
      terrain.calls = 0;
      pool.step(1 / 60, null, terrain, 10000, NEAR_SNAP_M + 5000, 0);
      expect(terrain.calls).toBeLessThanOrEqual(2 * pool.ticks);
      ticks += pool.ticks;
      walked ||= pool.mode[h] === 1;
      grazed ||= pool.mode[h] === 0;
    }
    expect(ticks).toBeGreaterThan(1000);
    expect(walked && grazed).toBe(true);
  });
});
