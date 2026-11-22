// Which world seed a session is built from (worldSeed.ts; mirrors eraChoice.ts). Node-safe: tests/sim/seedChoice.test.ts
// runs it with a fake store.
//
//   at boot     a lesson (lesson= in the URL) always flies in today's world, seed 0, where the Flight School's route is;
//               else seed=<n> in the URL; else the stored preference ('fs.seed'); else 0, today's world. A seed given by
//               URL is not stored (dev and test links do not change the world the owner flies next). The Simulator
//               constructor calls setWorldSeed() with the result right after the era.
//   the menu    commands.setSeed stores the preference and reloads without the URL parameters that would undo the
//               choice (seedSwitchUrl); a flight saved in another seed's world is not resumed (decideBoot).

import { normalizeSeed } from '../world/worldSeed';
import { ERA_SWITCH_DROPS } from './eraChoice';
import type { SimParams } from './params';
import type { KeyValueStore } from './resume';

/** localStorage key of the chosen seed. */
export const SEED_PREF_KEY = 'fs.seed';

/** The largest seed "Random" draws (six digits are easy to read out and type back). */
export const RANDOM_SEED_MAX = 999999;

export interface SeedChoice {
  seed: number;
  source: 'lesson' | 'url' | 'preference' | 'default';
}

/** The seed this session is built from (see the header for the order). */
export function chooseSeed(params: Pick<SimParams, 'seed'> & { school?: Pick<SimParams['school'], 'lesson'> }, store: KeyValueStore | null): SeedChoice {
  // The Flight School's route (training/content/syllabus/route.ts) is laid out in today's world: a lesson always
  // flies there, whatever the URL or the preference says (the preference is kept for the next free flight).
  if (params.school?.lesson) return { seed: 0, source: 'lesson' };
  if (params.seed !== undefined) return { seed: params.seed, source: 'url' };
  let pref: string | null = null;
  try {
    pref = store?.getItem(SEED_PREF_KEY) ?? null;
  } catch {
    pref = null;
  }
  if (pref !== null && pref.trim() !== '' && Number.isFinite(Number(pref))) return { seed: normalizeSeed(pref), source: 'preference' };
  return { seed: 0, source: 'default' };
}

/** Store the seed the pilot chose in the menu. */
export function saveSeedPreference(store: KeyValueStore | null, seed: number): void {
  try {
    store?.setItem(SEED_PREF_KEY, String(normalizeSeed(seed)));
  } catch {
    /* ignore */
  }
}

/** A random seed, 1..RANDOM_SEED_MAX (never 0, which is today's world). */
export function randomSeed(random: () => number = Math.random): number {
  return 1 + Math.floor(random() * RANDOM_SEED_MAX);
}

/**
 * The page a change of seed reloads into: the current URL without `seed` and the parameters a change of era drops
 * (the old world's scenario, lesson, resume and so on). The aircraft and the era stay.
 */
export function seedSwitchUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('seed');
  for (const k of ERA_SWITCH_DROPS) if (k !== 'era') url.searchParams.delete(k);
  return url.toString();
}

/** The same for a dev page (no commands.setSeed): the address names the seed (today's world: none). */
export function seedDevChoiceUrl(href: string, seed: number): string {
  const url = new URL(seedSwitchUrl(href));
  if (normalizeSeed(seed) !== 0) url.searchParams.set('seed', String(normalizeSeed(seed)));
  return url.toString();
}

/** How the menu names a seed. */
export function seedLabel(seed: number): string {
  return seed === 0 ? "0 (today's world)" : String(seed);
}

/**
 * The page a lesson started in a seeded world reloads into (TrainingSystem.start): the current URL without its seed
 * and the start parameters a change of world drops, with lesson= (and phase=, brief=0, standard=) for this lesson.
 * chooseSeed then builds seed 0 for it; the pilot's seed preference is left as it was.
 */
export function lessonSeedZeroUrl(href: string, lessonId: string, opts: { phase?: string; brief?: boolean; standard?: 'easa' | 'faa' } = {}): string {
  const url = new URL(href);
  url.searchParams.delete('seed');
  for (const k of ERA_SWITCH_DROPS) if (k !== 'era') url.searchParams.delete(k);
  url.searchParams.set('lesson', lessonId);
  if (opts.phase !== undefined) url.searchParams.set('phase', opts.phase);
  if (opts.brief === false) url.searchParams.set('brief', '0');
  if (opts.standard !== undefined) url.searchParams.set('standard', opts.standard);
  return url.toString();
}
