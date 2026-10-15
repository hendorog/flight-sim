// Increment-1 freeze (Deep Time inc 2, WP0b): the inc-1 creatures and behaviour must not change while increment 2
// generalises the fauna (species profiles, the pose switch, external threats, solo agents). Hashes, recorded BEFORE
// any inc-2 fauna edit, in tests/fixtures/faunaInc1.json:
//   - the geometry (every attribute, the index) and the pivots of edmontosaurus, quetzalcoatlus and azhdarchidSmall;
//   - their material uniform values (pivots, sub-joints, fold, sub-blend, variant tints);
//   - a 60 s seeded HerdPool trace on the real terrain: a pinned herd near the view with an aircraft pass that sets
//     off the flee, and an unpinned herd beyond NEAR_SNAP_M;
//   - a 60 s FlyerPool trace at a tod-10 thermal frame: a kettle with an aircraft pass (evade), a standing pair that
//     the aircraft launches, and a ridge bird.
// Traces are quantised (1e-3 m / rad) before hashing, so they catch behaviour, not ulps.
//
// Re-capture (only with the inc-1 code, never to make a change pass): CAPTURE_FAUNA_INC1=1 npx vitest run
// tests/fauna/inc1Freeze.test.ts

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ThermalFrame } from '../../src/physics/weather/windField';
import { makeThermalCore } from '../../src/physics/weather/thermals';
import { RIVER_HERD_SITE } from '../../src/world/era/cretaceousAnchors';
import { ART_ALBEDO_LIFT, creatureMaterials } from '../../src/world/fauna/art';
import { createFaunaMaterials } from '../../src/world/fauna/faunaMaterial';
import { FLYER_MODE, FlyerPool } from '../../src/world/fauna/flight';
import { countingTerrain } from '../../src/world/fauna/habitat';
import { HerdPool, type AircraftView } from '../../src/world/fauna/herds';
import { buildFaunaSpecies } from '../../src/world/fauna/species/index';
import type { FaunaSpeciesId } from '../../src/world/fauna/types';

// node:fs and node:crypto at run time (the project type-checks tests without node's types, as presentGuard does).
interface Fs {
  readFileSync(path: URL, encoding: 'utf8'): string;
  writeFileSync(path: URL, data: string): void;
}
interface Hash {
  update(data: Uint8Array): Hash;
  digest(encoding: 'hex'): string;
}
const { readFileSync, writeFileSync } = (await import(/* @vite-ignore */ 'node:fs' as string)) as Fs;
const { createHash } = (await import(/* @vite-ignore */ 'node:crypto' as string)) as { createHash(alg: 'sha256'): Hash };
const FIXTURE = new URL('../fixtures/faunaInc1.json', import.meta.url);
const CAPTURE = !!(globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env.CAPTURE_FAUNA_INC1;
const INC1: FaunaSpeciesId[] = ['edmontosaurus', 'quetzalcoatlus', 'azhdarchidSmall'];
const DT = 1 / 60;

const sha = (parts: ArrayBufferView[]): string => {
  const h = createHash('sha256');
  for (const p of parts) h.update(new Uint8Array(p.buffer, p.byteOffset, p.byteLength));
  return h.digest('hex');
};

function geometryHash(id: FaunaSpeciesId): string {
  const set = buildFaunaSpecies(id);
  const parts: ArrayBufferView[] = [set.pivots, new Float64Array([set.lengthM])];
  for (const g of [set.lod0, set.lod1, set.lod2, set.caster] as THREE.BufferGeometry[]) {
    for (const name of Object.keys(g.attributes).sort()) parts.push(g.getAttribute(name).array as Float32Array);
    if (g.index) parts.push(g.index.array as Uint16Array);
  }
  return sha(parts);
}

function uniformHash(id: FaunaSpeciesId, make: typeof createFaunaMaterials = createFaunaMaterials, tint: readonly [number, number, number] = [1, 1, 1]): string {
  const set = buildFaunaSpecies(id);
  const u = make(id, set).uniforms;
  for (const c of u.uVariantTint.value) c.set(c.x * tint[0], c.y * tint[1], c.z * tint[2]);
  const v: number[] = [];
  for (const q of u.uPivots.value) v.push(q.x, q.y, q.z, q.w);
  for (const q of u.uSub.value) v.push(q.x, q.y, q.z, q.w);
  for (const q of u.uFold.value) v.push(q.x, q.y, q.z, q.w);
  v.push(u.uSubBlend.value);
  for (const c of u.uVariantTint.value) v.push(c.x, c.y, c.z);
  return sha([new Float64Array(v)]);
}

const q = (x: number): number => Math.round(x * 1000);

function herdTrace(): string {
  const terrain = countingTerrain();
  const H = new HerdPool();
  const near = H.spawn(
    { north: RIVER_HERD_SITE.north, east: RIVER_HERD_SITE.east, ground: RIVER_HERD_SITE.ground, size: 60, entry: 0, scale: 1, variant: 0, seed: 0x5ca1ab1e, heading: RIVER_HERD_SITE.heading, pinned: true },
    -1,
  );
  const far = H.spawn({ north: RIVER_HERD_SITE.north + 3200, east: RIVER_HERD_SITE.east - 900, ground: 160, size: 40, entry: 0, scale: 1, variant: 0, seed: 0x1234567, heading: 1.1, pinned: false }, 42);
  expect(near).toBeGreaterThanOrEqual(0);
  expect(far).toBeGreaterThanOrEqual(0);
  const ac: AircraftView = { n: 0, e: 0, alt: 0, vN: 0, vE: 0, vD: 0, tas: 50 };
  const out: number[] = [];
  let fled = 0;
  for (let k = 0; k < 3600; k++) {
    const t = k * DT;
    // A low pass from 1.5 km south over the herd at 80 m above it, 50 m/s north (the flee at ~25 s), then away.
    ac.n = RIVER_HERD_SITE.north - 1500 + 50 * t;
    ac.e = RIVER_HERD_SITE.east + 40;
    ac.alt = RIVER_HERD_SITE.ground + 80;
    ac.vN = 50;
    ac.vE = 0;
    ac.vD = 0;
    terrain.calls = 0;
    H.step(DT, k > 300 ? ac : null, terrain, 160, RIVER_HERD_SITE.north, RIVER_HERD_SITE.east);
    fled = Math.max(fled, H.fleeing[near]);
    if (k % 30 === 29) {
      for (const h of [near, far]) {
        out.push(q(H.cN[h]), q(H.cE[h]), q(H.cH[h]), q(H.heading[h]), H.mode[h], H.fleeing[h], H.threat[h]);
        const base = h * H.memberCap;
        for (let m = 0; m < H.size[h]; m++) {
          const i = base + m;
          out.push(q(H.mN[i]), q(H.mE[i]), q(H.mH[i]), q(H.yaw[i]), q(H.speed[i]), q(H.phase[i]), q(H.blend[i]), q(H.alert[i]), q(H.head[i]), q(H.pitch[i]));
        }
      }
    }
  }
  expect(fled).toBe(1);
  return sha([new Float64Array(out)]);
}

function flyerTrace(): string {
  const terrain = countingTerrain();
  const F = new FlyerPool(16);
  const f: ThermalFrame = { seed: 0x7468726d, driftN: 120, driftE: -60, wStar: 2.2, cloudBaseM: 1900, minDepth: 300 };
  const n0 = RIVER_HERD_SITE.north;
  const e0 = RIVER_HERD_SITE.east;
  const core = makeThermalCore();
  const t0 = 36000;
  expect(F.nearestCore(f, t0, n0, e0, core)).toBe(true);
  const ground = terrain.height(core.x + f.driftN, core.y + f.driftE);
  for (let b = 0; b < 6; b++) {
    const i = F.spawn({ north: n0, east: e0, alt: ground + 200, ground, entry: b === 0 ? 1 : 2, scale: b === 0 ? 1 : 0.43, size: b === 0 ? 1 : 0.43, variant: b === 0 ? 0 : 1, seed: 0xce77 + b, mode: FLYER_MODE.glide, heading: 0, anchorN: n0, anchorE: e0 });
    F.startKettle(i, core, f, terrain);
    F.alt[i] = F.coreGround[i] + 150 + 20 * b;
  }
  // A standing pair the aircraft walks into, and a ridge bird (no thermals for it: started on the ridge).
  const sN = n0 + 2500;
  const sE = e0 - 2500;
  const sg = terrain.height(sN, sE);
  for (let b = 0; b < 2; b++) F.spawn({ north: sN + 15 * b, east: sE, alt: sg, ground: sg, entry: 1, scale: 1, size: 1, variant: 0, seed: 0x9a1200 + b, mode: FLYER_MODE.stand, heading: 2.4 + b, anchorN: sN, anchorE: sE });
  const r = F.spawn({ north: n0 - 3000, east: e0, alt: 600, ground: 160, entry: 1, scale: 1, size: 1, variant: 0, seed: 0x77, mode: FLYER_MODE.glide, heading: 0, anchorN: n0 - 3000, anchorE: e0 });
  F.startRidge(r, terrain, 0.6, -0.8);
  F.alt[r] = F.ground[r] + F.rOff[r];
  const ac: AircraftView = { n: 0, e: 0, alt: 0, vN: 0, vE: 0, vD: 0, tas: 45 };
  const out: number[] = [];
  const seen = new Set<number>();
  for (let k = 0; k < 3600; k++) {
    const t = t0 + k * DT;
    // 0-30 s: through the kettle at its height; 30-60 s: low over the standing pair.
    if (k < 1800) {
      const s = k * DT;
      ac.n = core.x + f.driftN - 900 + 45 * s;
      ac.e = core.y + f.driftE + 20;
      ac.alt = ground + 200;
      ac.vN = 45;
      ac.vE = 0;
    } else {
      const s = (k - 1800) * DT;
      ac.n = sN - 900 + 45 * s;
      ac.e = sE + 30;
      ac.alt = sg + 40;
      ac.vN = 45;
      ac.vE = 0;
    }
    terrain.calls = 0;
    F.step(DT, t, f, ac, terrain, 40, true, 0.6, -0.8);
    for (let i = 0; i < F.capacity; i++) if (F.active[i]) seen.add(F.mode[i]);
    if (k % 30 === 29) {
      for (let i = 0; i < F.capacity; i++) {
        if (!F.active[i]) continue;
        out.push(i, F.mode[i], q(F.n[i]), q(F.e[i]), q(F.alt[i]), q(F.heading[i]), q(F.speed[i]), q(F.bank[i]), q(F.pitch[i]), q(F.flap[i]), q(F.phase[i]), q(F.blend[i]));
      }
    }
  }
  // The trace covers the kettle, the evade, the launch and climb-out, and the ridge.
  for (const m of [FLYER_MODE.kettle, FLYER_MODE.evade, FLYER_MODE.launch, FLYER_MODE.climbOut, FLYER_MODE.ridge]) expect(seen.has(m), `mode ${m}`).toBe(true);
  return sha([new Float64Array(out)]);
}

interface Fixture {
  geometry: Record<string, string>;
  uniforms: Record<string, string>;
  herdTrace: string;
  flyerTrace: string;
}

function compute(): Fixture {
  const geometry: Record<string, string> = {};
  const uniforms: Record<string, string> = {};
  for (const id of INC1) {
    geometry[id] = geometryHash(id);
    uniforms[id] = uniformHash(id);
  }
  return { geometry, uniforms, herdTrace: herdTrace(), flyerTrace: flyerTrace() };
}

describe('increment-1 fauna freeze', () => {
  if (CAPTURE) {
    it('captures the fixture', () => {
      writeFileSync(FIXTURE, `${JSON.stringify(compute(), null, 2)}\n`);
    });
    return;
  }
  const fx = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture;

  it.each(INC1)('%s geometry and pivots are unchanged', (id) => {
    expect(geometryHash(id)).toBe(fx.geometry[id]);
  });

  it.each(INC1)('%s material uniforms are unchanged', (id) => {
    expect(uniformHash(id)).toBe(fx.uniforms[id]);
  });

  // The production path (art.ts creatureMaterials, what CREATURE_ART gives FaunaSystem): the inc-1 materials as
  // frozen, except the deliberate WP8 look-gate albedo lift of the Edmontosaurus (owner-approved: the stampede's
  // contrast against the olive marsh, commit 8c15ac4), pinned here so any further change fails.
  const APPROVED_LIFT: Partial<Record<FaunaSpeciesId, readonly [number, number, number]>> = { edmontosaurus: [1.3, 1.25, 1.12] };
  it('the production materials are the frozen ones, but for the approved look-gate lift', () => {
    expect(ART_ALBEDO_LIFT).toEqual(APPROVED_LIFT);
  });
  it.each(INC1)('%s production material uniforms are the frozen ones (times the approved lift)', (id) => {
    const lift = APPROVED_LIFT[id];
    expect(uniformHash(id, creatureMaterials)).toBe(lift ? uniformHash(id, createFaunaMaterials, lift) : fx.uniforms[id]);
  });

  it('the seeded herd trace (graze, wander, aircraft flee, far plane) is unchanged', () => {
    expect(herdTrace()).toBe(fx.herdTrace);
  }, 60000);

  it('the seeded flyer trace (kettle, evade, launch, ridge) at a tod-10 frame is unchanged', () => {
    expect(flyerTrace()).toBe(fx.flyerTrace);
  }, 60000);
});
