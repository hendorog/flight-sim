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

/**
 * Every species, APPEND-ONLY (indices are stable: per-species typed arrays and the inc-1 fixture rely on them).
 * Increment 1: edmontosaurus, quetzalcoatlus, azhdarchidSmall. Increment 2 (WP0b; bodies by WP1-WP4):
 * tyrannosaurus (rig theropod), triceratops (ceratopsian), alamosaurus (sauropod), pteranodon (azhdarchid rig,
 * a Look-only variant).
 */
export const FAUNA_SPECIES_IDS = ['edmontosaurus', 'quetzalcoatlus', 'azhdarchidSmall', 'tyrannosaurus', 'triceratops', 'alamosaurus', 'pteranodon'] as const;
export type FaunaSpeciesId = (typeof FAUNA_SPECIES_IDS)[number];
/** Index of a species in FAUNA_SPECIES_IDS (for per-species typed arrays). */
export const speciesIndex = (id: FaunaSpeciesId): number => FAUNA_SPECIES_IDS.indexOf(id);

/**
 * Rig kinds: the FAUNA_RIG define of the animated material (faunaMaterial.ts), which selects the pose code
 * (poses/*.ts). There is no rig 5. FAUNA_WINGS (the wing fold tuck, the 14/15 side mirroring and the wing
 * sub-joints) is defined for the azhdarchid rig only.
 */
export const RIG = { hadrosaur: 0, azhdarchid: 1, theropod: 2, ceratopsian: 3, sauropod: 4 } as const;
export type FaunaRig = keyof typeof RIG;
export type RigIndex = (typeof RIG)[FaunaRig];

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
 * BONE ALIASES (documentation and named indices; BONE_COUNT stays 16). The new rigs reuse the inc-1 indices:
 *
 *   sauropod (rig 4)   neck3 = wingL (14), neck4 = wingR (15); the jaw (6) is parked on the head (no jaw).
 *                      Chain: head -> wingR -> wingL -> neck2 -> neck1 -> spine2 -> spine1 -> root, 7 steps
 *                      (the shader walks at most 8 parents, faunaMaterial.ts faunaSkin). So pivots are NOT
 *                      parent-before-child for this rig (head 5 has parent 15): only acyclic, depth <= 8.
 *                      Without FAUNA_WINGS the material treats 14/15 as plain bones: no fold, no mirroring,
 *                      no limb sub-joints.
 *   theropod (rig 2)   legFL/legFR = the two-finger arms (sub-joints at uSub[0..2] if wanted); jaw = the roar.
 *   ceratopsian (3)    frill and horns are rigid on the head bone; the beak is on the jaw.
 */
export const BONE_ALIAS = {
  sauropod: { neck3: BONE.wingL, neck4: BONE.wingR },
  theropod: { armL: BONE.legFL, armR: BONE.legFR, roarJaw: BONE.jaw },
  ceratopsian: { frill: BONE.head, horns: BONE.head, beak: BONE.jaw },
} as const;

/**
 * Triangle budgets per species: [lod0, lod1, lod2, caster] at most (tests/fauna/bodies.test.ts reads them from
 * profiles.ts PROFILES[id].render.tris, which copies this table). The inc-1 rows are the inc-1 test budgets.
 *
 *   edmontosaurus    2600  450  70  2600      tyrannosaurus  4000  600  80  1500
 *   quetzalcoatlus   1900  320  50  1900      triceratops    2200  350  60   900
 *   azhdarchidSmall  1900  320  50  1900      alamosaurus    3500  500  90  3500
 *                                             pteranodon     1500  250  40   600
 */

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

/**
 * What the animated material needs of a species besides its meshes (species/<id>.ts exports it as <NAME>_RENDER;
 * species/index.ts FAUNA_SPECIES[id].render): the rig (FAUNA_RIG, selects the pose code), the limb sub-joints
 * (uSub[SUB_COUNT], rig.ts packSubJoints; w >= 1e5 = unused), the wing fold (uFold[4] quaternions; identity
 * without one, rig.ts identityFold) and the sub-joint blend width (limb coordinate units).
 */
export interface SpeciesRender {
  rig: FaunaRig;
  subJoints(): Float32Array;
  fold(): Float32Array;
  subBlend: number;
}

/**
 * How a roster entry lives: ground herds, soaring flyers (kettles on thermals; they also stand and launch), or
 * solo agents (agents.ts SoloAgentPool, driven by a species brain from brains.ts: the showcase T. rex, and from
 * inc 2b roaming ones placed beside streamed herds).
 */
export type FaunaRole = 'herd' | 'flyer' | 'solo';

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
  /**
   * Spawned by the habitat streaming (ambient herds, ambient kettles) when true or absent. False: the species
   * only appears where a showcase hook places it (the system still builds its meshes).
   */
  ambient?: boolean;
  /**
   * Where the habitat streaming places this entry (inc 2b, habitat.ts): 'waterside' (or absent) = layer 1, the
   * herds beside the river and the lake shores (probeHabitatCell); 'plain' / 'open' / 'woodland' = layer 2 (probeCell:
   * cells layer 1 left empty, each kind its own predicate); 'nearHerd' = a solo animal placed beside a streamed prey
   * herd (FaunaSystem: the roaming T. rex).
   */
  habitat?: HabitatKind;
  /**
   * Layers 2 and 3: the share of 2 km cells (layer 2: among those layer 1 left empty; layer 3: every cell) that draw
   * this entry, before its habitat test.
   * 'nearHerd': the share of streamed prey herds that get one.
   */
  occupancy?: number;
  /**
   * Layers 2 and 3 (fauna across the landscape, AGENT choice): a further share of cells drawing this entry, laid out
   * after every entry's `occupancy` band, so each cell that drew an entry before still draws it. Absent: 0.
   */
  occupancyExtra?: number;
  /**
   * Flyers: ambient-kettle weight x this near water (within 2 km of the river, a lake zone, or the coastal strip
   * below 40 m), / this elsewhere. Absent: x 1.
   */
  waterAffinity?: number;
}

/** Habitat kinds of the streaming (FaunaRosterEntry.habitat). */
export type HabitatKind = 'waterside' | 'plain' | 'open' | 'woodland' | 'nearHerd';

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
  /** Triangles submitted last frame (instances x their LOD's triangles, casters excluded). */
  tris: number;
  /** Fauna draw calls last frame (meshes with at least one instance; count-0 meshes are hidden), casters excluded. */
  draws: number;
}
