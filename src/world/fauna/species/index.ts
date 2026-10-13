// The creature art (inc 1 WP4; inc 2 registry by WP0b, bodies by WP1-WP4), for the fauna system and the dev page.
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

//   theropod (tyrannosaurus, rig 2; poses/theropod.ts, WP1)
//     gaitBlend 0 crouch / idle, 1 walk (strideM.walk), 2 charge (strideM.run); flap = ROAR 0..1 (jaw open, head
//     up, neck shake); headTurn spread over neck1, neck2 and head. Written by the solo agent pool (agents.ts).
//   ceratopsian (triceratops, rig 3; poses/ceratopsian.ts, WP2)
//     gaitBlend 0 graze, 1 diagonal walk with a head nod, 2 trot; flap = ALERT 0..1 (herds.ts: 1 while alert and
//     while FACING a threat; the pose lowers the head and horns at 1).
//   sauropod (alamosaurus, rig 4; poses/sauropod.ts, WP3)
//     gaitBlend 0 browse (neck sweeps up into the canopy), 1 pace-like walk, 2 = the walk x1.3; flap = ALERT 0..1
//     (head raised); headTurn over the 4 neck bones (neck1, neck2, wingL = neck3, wingR = neck4).
//   Every rig: aInstC.w variant as above; the pose files must keep the stance feet on the ground (fRootOff).

import { PROFILES, profileStride } from '../profiles';
import type { CreatureMeshSet, FaunaRig, FaunaSpeciesBuilder, FaunaSpeciesId, SpeciesRender } from '../types';
import { ALAMOSAURUS_RENDER, createAlamosaurus } from './alamosaurus';
import { AZHDARCHID_RENDER, createQuetzalcoatlus, createSmallAzhdarchid } from './azhdarchid';
import { EDMONTOSAURUS_RENDER, createEdmontosaurus } from './edmontosaurus';
import { PTERANODON_RENDER, createPteranodon } from './pteranodon';
import { TRICERATOPS_RENDER, createTriceratops } from './triceratops';
import { TYRANNOSAURUS_RENDER, createTyrannosaurus } from './tyrannosaurus';

export type { FaunaRig } from '../types';

export interface FaunaSpeciesInfo {
  id: FaunaSpeciesId;
  /** Shorthand for render.rig. */
  rig: FaunaRig;
  build: FaunaSpeciesBuilder;
  /** The animated material's view of the species (rig, sub-joints, fold, sub-blend): species/<id>.ts <NAME>_RENDER. */
  render: SpeciesRender;
  /** Display name and nominal size (the field guide has the facts). */
  name: string;
  /** Height of the body origin above the ground when standing, at scale 1, m (0 = origin on the ground). From PROFILES. */
  groundOffsetM: number;
  /** Body scale the roster should draw it at (aInstC.z). */
  defaultScale: number;
  /** Ground distance per gait cycle at scale 1, m: walk (gaitBlend 1) and run (gaitBlend 2). From PROFILES. */
  strideM: { walk: number; run: number };
  /** Comfortable speeds at scale 1, m/s. From PROFILES. */
  speed: { walk: number; run: number };
  /** Wingbeat frequency at scale 1, Hz (0 for ground animals). Smaller animals beat faster: hz / sqrt(scale). From PROFILES. */
  flapHz: number;
}

function info(id: FaunaSpeciesId, name: string, build: FaunaSpeciesBuilder, render: SpeciesRender, defaultScale = 1): FaunaSpeciesInfo {
  const p = PROFILES[id];
  return {
    id,
    rig: render.rig,
    build,
    render,
    name,
    groundOffsetM: p.groundOffsetM,
    defaultScale,
    strideM: { walk: p.strideM.walk, run: p.strideM.run },
    speed: { walk: p.speed.walk, run: p.speed.run },
    flapHz: p.flapHz,
  };
}

/**
 * The species registry (FROZEN after WP0b): one row per FAUNA_SPECIES_IDS entry. The inc-2 rows point at the
 * packages' fixed exports (create<Name>, <NAME>_RENDER); the WP0b stubs draw the Edmontosaurus body (T. rex,
 * Triceratops, Alamosaurus) and the small azhdarchid (Pteranodon).
 */
export const FAUNA_SPECIES: Readonly<Record<FaunaSpeciesId, FaunaSpeciesInfo>> = {
  edmontosaurus: info('edmontosaurus', 'Edmontosaurus annectens', createEdmontosaurus, EDMONTOSAURUS_RENDER),
  quetzalcoatlus: info('quetzalcoatlus', 'Quetzalcoatlus northropi', createQuetzalcoatlus, AZHDARCHID_RENDER),
  azhdarchidSmall: info('azhdarchidSmall', 'small azhdarchid', createSmallAzhdarchid, AZHDARCHID_RENDER, 0.43),
  tyrannosaurus: info('tyrannosaurus', 'Tyrannosaurus rex', createTyrannosaurus, TYRANNOSAURUS_RENDER),
  triceratops: info('triceratops', 'Triceratops horridus', createTriceratops, TRICERATOPS_RENDER),
  alamosaurus: info('alamosaurus', 'Alamosaurus sanjuanensis', createAlamosaurus, ALAMOSAURUS_RENDER),
  pteranodon: info('pteranodon', 'Pteranodon longiceps', createPteranodon, PTERANODON_RENDER),
};

/** Stride (m per gait cycle) at a gaitBlend and body scale, for advancing gaitPhase without foot skate. */
export function strideM(id: FaunaSpeciesId, gaitBlend: number, scale = 1): number {
  return profileStride(PROFILES[id], gaitBlend, scale);
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

// (The drawing helpers live in ../faunaMaterial: createFaunaInstances, createFaunaMaterials, createFaunaMesh,
// writeFaunaInstance. They are not re-exported here: faunaMaterial reads FAUNA_SPECIES, so a re-export would
// be an import cycle.)
