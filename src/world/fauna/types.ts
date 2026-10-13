// Fauna contracts (Deep Time). Shared by the creature art (WP4: rig.ts, faunaMaterial.ts, species/*), the
// behaviour and rendering system (WP5: FaunaSystem.ts, herds, flight, habitat...) and the field guide (WP7).
// Fixed by WP0; the packages build against it in parallel.
//
// RENDERING MODEL: procedural meshes (no assets, no skinning). Each species is one CreatureMeshSet: three LODs and
// a shadow-caster geometry built from one body plan, every vertex carrying `aBone` (index into BONE, < BONE_COUNT)
// and `aBoneW` (2-bone blend near joints), plus baked vertex colour. Animation is analytic, in the vertex shader,
// about the per-species pivots (uniform vec4 uPivots[BONE_COUNT]), driven by three interleaved per-instance vec4
// attributes (FAUNA_STRIDE floats per instance):
//
//   aInstA = (east, alt, north, yaw)          world position, m (alt MSL; three.js z = -north), heading rad
//                                             (0 = north, clockwise, as everywhere in NED)
//   aInstB = (pitch, bank, gaitPhase, gaitBlend)   rad, rad, cycles (fract used), GAIT value 0..2 (blended)
//   aInstC = (flap, headTurn, scale, variant)      0 glide .. 1 full stroke, rad (+ right), x body size, variant id
//
// Gait phase is advanced on the CPU by distance / stride so feet do not skate; uTime only drives secondary noise.
//
// Pure: types and constants only (three.js types are type-only imports).

import type { BufferGeometry } from 'three';
import type { RosterId } from '../era/types';

/** The species of increment 1. */
export const FAUNA_SPECIES_IDS = ['edmontosaurus', 'quetzalcoatlus', 'azhdarchidSmall'] as const;
export type FaunaSpeciesId = (typeof FAUNA_SPECIES_IDS)[number];

/** Floats per instance in the interleaved instance buffer (48 bytes). */
export const FAUNA_STRIDE = 12;
/** Instance attribute names and their float offsets within one instance (each a vec4). */
export const FAUNA_ATTR = { aInstA: 0, aInstB: 4, aInstC: 8 } as const;
export type FaunaAttrName = keyof typeof FAUNA_ATTR;

/** aInstB.w gaitBlend values: 0 graze / idle, 1 walk (hadrosaur quadrupedal), 2 run (hadrosaur bipedal). */
export const GAIT = { graze: 0, walk: 1, run: 2 } as const;

/**
 * Analytic bones (aBone values). Every rig uses the same indices; a body without a part (wings on a hadrosaur)
 * leaves its pivot at the parent's. At most 16 (uPivots[16]).
 */
export const BONE = {
  root: 0,
  spine1: 1,
  spine2: 2,
  neck1: 3,
  neck2: 4,
  head: 5,
  jaw: 6,
  tail1: 7,
  tail2: 8,
  tail3: 9,
  legFL: 10,
  legFR: 11,
  legHL: 12,
  legHR: 13,
  wingL: 14,
  wingR: 15,
} as const;
export type Bone = (typeof BONE)[keyof typeof BONE];
export const BONE_COUNT = 16;

/**
 * One species' geometry. All four geometries share the same body plan and pivots and carry the attributes
 * position, normal, color (baked linear albedo 0.03-0.15 with countershading, mottling, crest colour and AO),
 * aBone (float) and aBoneW (float: weight of aBone; 1 - w goes to its parent).
 * Body space: metres, +x forward (head), +y up, +z right; origin on the ground under the hips (ground creatures)
 * or at the centre of mass (flyers), so aInstA places the feet on the terrain.
 */
export interface CreatureMeshSet {
  /** Near, ~2500 tris (hadrosaur) / ~1800 (azhdarchid). */
  lod0: BufferGeometry;
  /** Mid, ~400 / ~300. */
  lod1: BufferGeometry;
  /** Far, ~60 / ~40: still animated (rigid limbs and wings) so distant herds never read as rocks. */
  lod2: BufferGeometry;
  /** Shadow caster (LOD0-class silhouette, may be simplified), drawn with the animated depth material. */
  caster: BufferGeometry;
  /** BONE_COUNT x vec4: pivot (x, y, z) in body space, m, and w = parent bone index (-1 for root). */
  pivots: Float32Array;
  /** Nose-to-tail length (ground creatures) or wing span (flyers) at scale 1, m. */
  lengthM: number;
}

/** Builds a species' meshes (WP4, species/*.ts). Called once per session, in FaunaSystem.init. */
export type FaunaSpeciesBuilder = () => CreatureMeshSet;

/** How a roster entry lives: ground herds, or soaring flyers (kettles on thermals; they also stand and launch). */
export type FaunaRole = 'herd' | 'flyer';

export interface FaunaRosterEntry {
  species: FaunaSpeciesId;
  role: FaunaRole;
  /** Group size range (herd members, kettle birds). */
  groupMin: number;
  groupMax: number;
  /** Relative share of habitat cells this species takes among its role. */
  weight: number;
  /** aInstC.z body scale (1 = the species' lengthM; the small azhdarchid is the Quetzalcoatlus rig at 0.43). */
  scale: number;
  /** aInstC.w variant id (crest and colour variant on a shared rig). */
  variant: number;
}

/** An era's animals. The 'none' roster (the present day) has no entries and builds no fauna system. */
export interface FaunaRoster {
  id: RosterId;
  entries: readonly FaunaRosterEntry[];
}

/** Diagnostics exposed on window.__sim.fauna.stats. */
export interface FaunaStats {
  /** Instances drawn last frame. */
  visible: number;
  /** terrainHeight calls last frame (hard cap 200). */
  terrainCalls: number;
  /** Instance buffer reallocations since init (must stay 0). */
  reallocs: number;
  /** CPU time of the last update, ms. */
  cpuMs: number;
}
