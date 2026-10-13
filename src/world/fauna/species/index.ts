// The creature art of increment 1 (WP4), for the fauna system (WP5) and the dev page.
//
// USE (FaunaSystem.init, once per session):
//   const set = buildFaunaSpecies(id);                    // CreatureMeshSet: lod0/lod1/lod2/caster + pivots
//   const mats = createFaunaMaterials(id, set);           // faunaMaterial.ts: { material, depth, uniforms }
//   const inst = createFaunaInstances(capacity);          // one interleaved FAUNA_STRIDE buffer per draw
//   const mesh = createFaunaMesh(set.lod0, inst, mats);   // a Mesh at the origin, frustumCulled = false
//   per frame: writeFaunaInstance(inst.array, i, ...), inst.setCount(n), mats.uniforms.uTime.value = t
// The intended path is Mesh + InstancedBufferGeometry (as the trees); an InstancedMesh would also work but
// would multiply by a pointless identity instanceMatrix.
//
// INSTANCE CHANNELS (fauna/types.ts FAUNA_ATTR; all angles rad):
//   aInstA = (east, alt, north, yaw)   alt = MSL of the body origin: the ground under the hips for the
//                                      hadrosaur; the centre of mass for the azhdarchids, which stands
//                                      FAUNA_SPECIES[id].groundOffsetM * scale above the ground
//   aInstB = (pitch, bank, gaitPhase, gaitBlend)
//            pitch nose-up positive, bank right-wing-down positive (applied bank, then pitch, then yaw)
//            gaitPhase: cycles; advance by speed * dt / strideM(gaitBlend) on the ground, by flapHz * dt aloft
//   aInstC = (flap, headTurn, scale, variant)
//            headTurn: + = right; scale: x body size (lengthM at 1)
//            variant: integer id + 0.99 * a per-animal random fraction (individual tint and timing)
//
// GAIT AND ACTION per rig (gaitBlend is continuous; blend over ~0.5 s for smooth transitions):
//   hadrosaur (edmontosaurus)
//     gaitBlend 0 graze / idle, 1 quadrupedal diagonal walk, 2 bipedal run (forelimbs tuck, body pitches up);
//     flap = ALERT 0..1: 0 relaxed (at gait 0 the head is down grazing, with chewing), 1 head high and still
//     (the freeze before flight; also lifts the head while walking or running).
//   azhdarchid (quetzalcoatlus, azhdarchidSmall)
//     gaitBlend 0 stand (wings folded as forelimbs), 1 quadrupedal walk (folded wings), 1..2 QUAD LAUNCH progress
//     (crouch 1.0-1.35, vault 1.3-1.55, wings open 1.45-1.85, first downstroke 1.7-2.0; see azhdarchidLaunch for
//     the timing and the climb the CPU should add), 2 airborne;
//     flap (airborne) 0 glide/soar (dihedral, tips up) .. 1 full ~1 Hz stroke with tip flex; gaitPhase is then
//     the wingbeat phase (sin(2 pi phase) > 0 = wings above the body).

import type { CreatureMeshSet, FaunaSpeciesBuilder, FaunaSpeciesId } from '../types';
import { AZHDARCHID_GROUND_OFFSET_M, createQuetzalcoatlus, createSmallAzhdarchid } from './azhdarchid';
import { createEdmontosaurus } from './edmontosaurus';

export type FaunaRig = 'hadrosaur' | 'azhdarchid';

export interface FaunaSpeciesInfo {
  id: FaunaSpeciesId;
  rig: FaunaRig;
  build: FaunaSpeciesBuilder;
  /** Display name and nominal size (the field guide has the facts). */
  name: string;
  /** Height of the body origin above the ground when standing, at scale 1, m (0 = origin on the ground). */
  groundOffsetM: number;
  /** Body scale the roster should draw it at (aInstC.z). */
  defaultScale: number;
  /** Ground distance per gait cycle at scale 1, m: walk (gaitBlend 1) and run (gaitBlend 2). */
  strideM: { walk: number; run: number };
  /** Comfortable speeds at scale 1, m/s. */
  speed: { walk: number; run: number };
  /** Wingbeat frequency at scale 1, Hz (0 for ground animals). Smaller animals beat faster: hz / sqrt(scale). */
  flapHz: number;
}

export const FAUNA_SPECIES: Readonly<Record<FaunaSpeciesId, FaunaSpeciesInfo>> = {
  edmontosaurus: {
    id: 'edmontosaurus',
    rig: 'hadrosaur',
    build: createEdmontosaurus,
    name: 'Edmontosaurus annectens',
    groundOffsetM: 0,
    defaultScale: 1,
    strideM: { walk: 3.3, run: 7.2 },
    speed: { walk: 1.6, run: 7 },
    flapHz: 0,
  },
  quetzalcoatlus: {
    id: 'quetzalcoatlus',
    rig: 'azhdarchid',
    build: createQuetzalcoatlus,
    name: 'Quetzalcoatlus northropi',
    groundOffsetM: AZHDARCHID_GROUND_OFFSET_M,
    defaultScale: 1,
    strideM: { walk: 2.6, run: 2.6 },
    speed: { walk: 1.3, run: 2.5 },
    flapHz: 1.0,
  },
  azhdarchidSmall: {
    id: 'azhdarchidSmall',
    rig: 'azhdarchid',
    build: createSmallAzhdarchid,
    name: 'small azhdarchid',
    groundOffsetM: AZHDARCHID_GROUND_OFFSET_M,
    defaultScale: 0.43,
    strideM: { walk: 2.6, run: 2.6 },
    speed: { walk: 1.3, run: 2.5 },
    flapHz: 1.0,
  },
};

/** Stride (m per gait cycle) at a gaitBlend and body scale, for advancing gaitPhase without foot skate. */
export function strideM(id: FaunaSpeciesId, gaitBlend: number, scale = 1): number {
  const s = FAUNA_SPECIES[id].strideM;
  const t = Math.min(1, Math.max(0, gaitBlend - 1));
  return (s.walk + (s.run - s.walk) * t) * scale;
}

/** Build one species' meshes (all LODs, the caster and the pivots). Call once per session. */
export function buildFaunaSpecies(id: FaunaSpeciesId): CreatureMeshSet {
  return FAUNA_SPECIES[id].build();
}

/** Duration of the azhdarchid quad launch at scale 1, s (scale it by sqrt(scale)). */
export const AZHDARCHID_LAUNCH_S = 1.6;

/**
 * The quad launch, t seconds after it starts (scale 1): the gaitBlend to draw (1 -> 2) and the height the CPU
 * should have raised the origin above its standing height, m. The vault throws the animal up and forward;
 * after the first downstroke (t >= AZHDARCHID_LAUNCH_S) it climbs away under flight control at flap ~1.
 */
export function azhdarchidLaunch(t: number): { gaitBlend: number; climbM: number } {
  const L = Math.min(1, Math.max(0, t / AZHDARCHID_LAUNCH_S));
  const k = Math.min(1, Math.max(0, (L - 0.32) / 0.68));
  return { gaitBlend: 1 + L, climbM: 4.0 * k * k * (3 - 2 * k) };
}

export { createFaunaInstances, createFaunaMaterials, createFaunaMesh, writeFaunaInstance } from '../faunaMaterial';
export type { FaunaInstances, FaunaMaterials } from '../faunaMaterial';
