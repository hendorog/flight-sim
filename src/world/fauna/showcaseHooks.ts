// Showcase hooks (Deep Time inc 2, WP0b contract, FROZEN for WP1-WP7): what each inc-2 species adds to the
// scripted first minute. FaunaSystem.spawnShowcase, after the river herd, calls every hook whose species is in the
// era's roster, in SHOWCASE_HOOKS order, and spawns what it returns:
//   herd   a PINNED herd (never released for distance) of `size` at (north, east), heading `heading`;
//   solo   one solo agent (agents.ts) driven by brains.ts BRAINS[species];
//   flyer  `count` birds: with `kettle` (0 or 1) they take places in that showcase kettle (kettle composition is
//          data: KETTLE_BIRDS stay the total, hook birds replace the default azhdarchids from the END of the
//          default line-up, kettleComposition); without it they stand on the ground at (north, east) like the
//          resting pair (and launch when the aircraft comes near).
// Each hook lives in species/<id>.showcase.ts under the fixed export name `showcase`. Hooks are pure and
// three-free; they may read the terrain through ctx.terrain (counted; keep it to a handful of reads, init only).
// `ground` omitted = FaunaSystem reads the terrain there (1 read). Seeds make every spawn deterministic.

import type { QualityLevel } from '../../core/context';
import * as Anchors from '../era/cretaceousAnchors';
import type { FaunaTerrain } from './habitat';
import { KETTLE_BIRDS, type ShowcaseSite } from './showcase';
import type { FaunaSpeciesId } from './types';
import { showcase as alamosaurusShowcase } from './species/alamosaurus.showcase';
import { showcase as pteranodonShowcase } from './species/pteranodon.showcase';
import { showcase as triceratopsShowcase } from './species/triceratops.showcase';
import { showcase as tyrannosaurusShowcase } from './species/tyrannosaurus.showcase';

export interface ShowcaseContext {
  /** The safari's computed anchors (TREX_LAIR, TRICERATOPS_GROUP, ALAMOSAURUS_STAND, KETTLE0_EVENING, SAFARI ...). */
  anchors: typeof Anchors;
  /** The river herd's actual site (riverHerdSite: the herd spawned before the hooks run). */
  riverHerd: ShowcaseSite;
  /** Counted terrain (init only). */
  terrain: FaunaTerrain;
  quality: QualityLevel;
}

export interface ShowcaseHerd {
  kind: 'herd';
  species: FaunaSpeciesId;
  north: number;
  east: number;
  ground?: number;
  /** Heading the herd faces / strings out along, rad (0 north, clockwise). */
  heading: number;
  size: number;
  seed: number;
  /** Roster scale (default the roster entry's) and variant (default the entry's). */
  scale?: number;
  variant?: number;
}

export interface ShowcaseSolo {
  kind: 'solo';
  species: FaunaSpeciesId;
  north: number;
  east: number;
  ground?: number;
  heading: number;
  seed: number;
  scale?: number;
  variant?: number;
}

export interface ShowcaseFlyer {
  kind: 'flyer';
  species: FaunaSpeciesId;
  count: number;
  /** Join showcase kettle 0 (ahead of the safari) or 1 (past the other runway end). */
  kettle?: 0 | 1;
  /** Without `kettle`: where the birds stand (required then), their heading and seed. */
  north?: number;
  east?: number;
  heading?: number;
  seed?: number;
}

export type ShowcaseSpawn = ShowcaseHerd | ShowcaseSolo | ShowcaseFlyer;

export interface ShowcaseHook {
  species: FaunaSpeciesId;
  showcase(ctx: ShowcaseContext): readonly ShowcaseSpawn[];
}

/** Every hook, in spawn order (the T. rex before the herds it hunts; the flyers last). */
export const SHOWCASE_HOOKS: readonly ShowcaseHook[] = Object.freeze([
  { species: 'tyrannosaurus', showcase: tyrannosaurusShowcase },
  { species: 'triceratops', showcase: triceratopsShowcase },
  { species: 'alamosaurus', showcase: alamosaurusShowcase },
  { species: 'pteranodon', showcase: pteranodonShowcase },
] as const);

/** The default line-up of a showcase kettle (inc 1): one Quetzalcoatlus and five small azhdarchids. */
export const DEFAULT_KETTLE: readonly FaunaSpeciesId[] = Object.freeze(['quetzalcoatlus', 'azhdarchidSmall', 'azhdarchidSmall', 'azhdarchidSmall', 'azhdarchidSmall', 'azhdarchidSmall']);

/**
 * Kettle k's line-up given the hooks' spawns: the default, with the hooks' kettle-k birds (in order) replacing
 * places from the end, KETTLE_BIRDS in total. Writes into `out` (length KETTLE_BIRDS) and returns it.
 */
export function kettleComposition(spawns: readonly ShowcaseSpawn[], k: 0 | 1, out: FaunaSpeciesId[] = []): FaunaSpeciesId[] {
  out.length = 0;
  for (let b = 0; b < KETTLE_BIRDS; b++) out.push(DEFAULT_KETTLE[b] ?? 'azhdarchidSmall');
  const extra: FaunaSpeciesId[] = [];
  for (const s of spawns) {
    if (s.kind !== 'flyer' || s.kettle !== k) continue;
    for (let c = 0; c < Math.max(0, Math.floor(s.count)); c++) extra.push(s.species);
  }
  // The hook birds fill from the end, keeping their order: [..., hook0, hook1, hook2].
  const n = Math.min(extra.length, KETTLE_BIRDS);
  for (let j = 0; j < n; j++) out[KETTLE_BIRDS - n + j] = extra[j];
  return out;
}

/** Run every hook whose species `has` (the roster's species), in order: the showcase spawns. */
export function showcaseSpawns(ctx: ShowcaseContext, has: (id: FaunaSpeciesId) => boolean): ShowcaseSpawn[] {
  const out: ShowcaseSpawn[] = [];
  for (const hook of SHOWCASE_HOOKS) {
    if (!has(hook.species)) continue;
    for (const s of hook.showcase(ctx)) if (s.species === hook.species || has(s.species)) out.push(s);
  }
  return out;
}

export { Anchors };
