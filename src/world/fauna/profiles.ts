// Species profiles (Deep Time inc 2, WP0b contract, FROZEN for WP1-WP7): every number the behaviour and the
// render budgeting need per species, in one pure, three-free table. The herds (herds.ts), reactions
// (reactions.ts speciesThreat), solo agents (agents.ts), flyers and FaunaSystem's LOD selection read PROFILES[id];
// species/index.ts derives FAUNA_SPECIES's strides, speeds, ground offset and wingbeat from it.
//
// The inc-1 rows are the inc-1 constants copied byte-equal (tests/fauna/inc1Freeze.test.ts holds them to it).
// The inc-2 species import PROFILE from species/<id>.data.ts (that export name is fixed): WP1-WP4 own those files
// and tune their own rows without touching this one. A data file must stay pure: `import type` from here, values
// from reactions.ts at most.

import type { QualityLevel } from '../../core/context';
import { HADROSAUR_REACTION } from './reactions';
import type { FaunaSpeciesId } from './types';
import { PROFILE as ALAMOSAURUS } from './species/alamosaurus.data';
import { PROFILE as PTERANODON } from './species/pteranodon.data';
import { PROFILE as TRICERATOPS } from './species/triceratops.data';
import { PROFILE as TYRANNOSAURUS } from './species/tyrannosaurus.data';

/**
 * How a herd answers a threat at the FLEE level (the aircraft's flee range, or setExternalThreat at THREAT.flee):
 *   'flee'    the alarm wave, then the run (inc 1, unchanged);
 *   'face'    the alarm wave, then each alarmed member turns on the spot toward the source and stops (gait 0, the
 *             alert channel at 1: the ceratopsian pose reads it as head down, horns forward) until calm;
 *   'ignore'  heads turn toward the source; nothing else changes (no freeze, no run).
 * At the ALERT level every kind turns its heads; 'flee' and 'face' herds also stand still (inc 1).
 */
export type ReactionKind = 'flee' | 'face' | 'ignore';

export interface ReactionProfile {
  kind: ReactionKind;
  /** Alert (heads up) within this slant range and below this height above the herd's ground, m. */
  alertRange: number;
  alertHeight: number;
  /** Flee-level threat within this slant range and below this height (and closing), m. */
  fleeRange: number;
  fleeHeight: number;
  /** Speed of the alarm wave through the herd, m/s. */
  waveSpeed: number;
  /** Run speed: starts at fleeSpeed0 and builds to fleeSpeed1 over fleeAccelS, m/s. */
  fleeSpeed0: number;
  fleeSpeed1: number;
  fleeAccelS: number;
  /** Calm-down delay after the last threat (after untilT for an external threat), s. */
  calmMinS: number;
  calmMaxS: number;
  /**
   * 'face' only: an external flee-level threat whose source is nearer than this to the herd's edge makes the herd
   * FLEE instead of facing (a predator right on top of them), m. 0 = never.
   */
  predatorFleeRange: number;
}

/** Herd formation and wandering (herds.ts). */
export interface HerdFormation {
  /** Sunflower formation spacing, m at scale 1. */
  spacing: number;
  /** Closest two animals may stand, m at scale 1. */
  personal: number;
  /** The formation is stretched this much along the heading (herds string out along a bank). */
  stringOut: number;
  /** Speed of a wandering herd's centroid, m/s. */
  wanderSpeed: number;
  /** A member closing on its formation slot walks at most this fast, m/s. */
  memberWalkMax: number;
  /** A wandering herd keeps within this of its home, m. */
  leash: number;
  /** Drawn gait from the speed: walk (gaitBlend 1) up to runFrom m/s, then gaitBlend 1 + (v - runFrom) / runSpan up to 2. */
  runFrom: number;
  runSpan: number;
}

/** Render budgeting (FaunaSystem.render). */
export interface RenderProfile {
  /** LOD0 instances at most per quality (also capped by the shared preset.lod0TriPool). */
  lod0Max: Readonly<Record<QualityLevel, number>>;
  /** Multiplies the preset's lod0/lod1/lod2 ranges for this species (big animals switch later). */
  lodRangeScale: number;
  /**
   * > 0: the species is drawn (LOD2 beyond its LOD1 band) out to exactly this distance, m, whatever the quality;
   * 0: out to the preset's lod2Range * lodRangeScale. (Flyers: x FLYER_RANGE_FACTOR either way.)
   */
  farRangeM: number;
  /** Triangle budget of one LOD0 instance (the body's LOD0 must not exceed it; bodies.test). */
  lod0Tris: number;
  /** Triangle budgets [lod0, lod1, lod2, caster] (bodies.test; types.ts table). */
  tris: readonly [number, number, number, number];
}

export interface SpeciesProfile {
  /** Ground distance per gait cycle at scale 1, m: walk (gaitBlend 1) and run (gaitBlend 2). */
  strideM: { readonly walk: number; readonly run: number };
  /** Comfortable speeds at scale 1, m/s (solo agents: walk and charge / run). */
  speed: { readonly walk: number; readonly run: number };
  /** Height of the body origin above the ground when standing, at scale 1, m (0 = origin on the ground). */
  groundOffsetM: number;
  /** Wingbeat frequency at scale 1, Hz (0 for ground animals). */
  flapHz: number;
  formation: HerdFormation;
  reaction: ReactionProfile;
  render: RenderProfile;
}

/** The inc-1 LOD0 cap per quality (presets.ts lod0Max before inc 2), shared by the inc-1 species. */
const INC1_LOD0_MAX = Object.freeze({ low: 20, medium: 40, high: 60, ultra: 100 });

/** The inc-1 herd formation (herds.ts constants before inc 2). */
const INC1_FORMATION: HerdFormation = Object.freeze({ spacing: 7, personal: 4.5, stringOut: 1.5, wanderSpeed: 0.8, memberWalkMax: 1.6, leash: 600, runFrom: 2, runSpan: 3 });

const HADROSAUR: ReactionProfile = Object.freeze({ kind: 'flee', ...HADROSAUR_REACTION, predatorFleeRange: 0 });

/** Azhdarchid body origin height (species/azhdarchid.ts AZHDARCHID_GROUND_OFFSET_M; copied: this module is three-free). */
export const AZHDARCHID_ORIGIN_M = 2.4;

const EDMONTOSAURUS: SpeciesProfile = Object.freeze({
  strideM: Object.freeze({ walk: 3.3, run: 7.2 }),
  speed: Object.freeze({ walk: 1.6, run: 7 }),
  groundOffsetM: 0,
  flapHz: 0,
  formation: INC1_FORMATION,
  reaction: HADROSAUR,
  render: Object.freeze({ lod0Max: INC1_LOD0_MAX, lodRangeScale: 1, farRangeM: 0, lod0Tris: 2600, tris: Object.freeze([2600, 450, 70, 2600] as const) }),
});

const AZHDARCHID_RENDER: RenderProfile = Object.freeze({ lod0Max: INC1_LOD0_MAX, lodRangeScale: 1, farRangeM: 0, lod0Tris: 1900, tris: Object.freeze([1900, 320, 50, 1900] as const) });

const QUETZALCOATLUS: SpeciesProfile = Object.freeze({
  strideM: Object.freeze({ walk: 2.6, run: 2.6 }),
  speed: Object.freeze({ walk: 1.3, run: 2.5 }),
  groundOffsetM: AZHDARCHID_ORIGIN_M,
  flapHz: 1.0,
  formation: INC1_FORMATION,
  reaction: HADROSAUR,
  render: AZHDARCHID_RENDER,
});

const AZHDARCHID_SMALL: SpeciesProfile = QUETZALCOATLUS;

export const PROFILES: Readonly<Record<FaunaSpeciesId, SpeciesProfile>> = Object.freeze({
  edmontosaurus: EDMONTOSAURUS,
  quetzalcoatlus: QUETZALCOATLUS,
  azhdarchidSmall: AZHDARCHID_SMALL,
  tyrannosaurus: TYRANNOSAURUS,
  triceratops: TRICERATOPS,
  alamosaurus: ALAMOSAURUS,
  pteranodon: PTERANODON,
});

/** Stride (m per gait cycle) of a profile at a gaitBlend and body scale (walk below 1, blended to run at 2). */
export function profileStride(p: SpeciesProfile, gaitBlend: number, scale = 1): number {
  const t = Math.min(1, Math.max(0, gaitBlend - 1));
  return (p.strideM.walk + (p.strideM.run - p.strideM.walk) * t) * scale;
}
