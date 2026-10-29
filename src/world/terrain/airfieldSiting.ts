// Where the generated airfields go (airfields.ts), as a pure function of the world seed and the natural terrain.
// Called by heightfield.ts at load and when the seed changes, with its own naturalHeight and hydrology (passed in,
// so this module does not import heightfield.ts).
//
// Two passes keep it cheap enough for every thread to run at load: a coarse lattice over the ring around the
// home field scores each spot by how flat and dry the ground is in a 1.6 km square (outside the forestry estates); the flattest few then try
// eight runway headings, scored by the spread of the ground along and beside the runway and by high ground
// under the approaches. Fields are then taken best first, spaced apart, a few kilometres from any water.
// Sealed aerodromes go to the best sites, grass strips to most of the rest.

import type { Airfield } from '../airfields';
import { runwayIds } from '../airfields';
import { rng } from '../airport/noise';
import { seeded } from '../worldSeed';
import type { Hydrology, Lake } from './hydrology';
import { estateWeight } from './plantation';

/** Ring around the home field the fields are sited in, m. */
export const AIRFIELD_RING: readonly [number, number] = [14000, 46000];
/** Most fields generated, and how far apart they keep, m. */
export const AIRFIELD_COUNT = 8;
const AIRFIELD_SPACING = 11000;
/** Coarse lattice spacing, m, and how many of its flattest spots go on to the heading search. */
const LATTICE = 2000;
const SHORTLIST = 60;
/** Usable ground: above the sea and below the high country, m. */
const MIN_HEIGHT = 12;
const MAX_HEIGHT = 1100;
/** The best sites become sealed aerodromes (this many, where the runway's ground spreads less than SEALED_SPREAD m);
 * the rest grass strips, a few of them sealed too where the ground is flat enough. */
const SEALED_FIRST = 3;
const SEALED_SPREAD = 40;

/** Runway kits: [length, width, flat margin, blend], m. */
const GRASS = { length: [650, 900], width: 30, flatMargin: 70, blend: 320, approach: 3000 } as const;
const SEALED = { length: [1000, 1400], width: 23, flatMargin: 130, blend: 420, approach: 4000 } as const;

const NAME_A = ['Ash', 'Bram', 'Cal', 'Dun', 'Elm', 'Fair', 'Glen', 'Hart', 'Ivy', 'Kel', 'Lang', 'Mar', 'Nor', 'Oak', 'Pem', 'Red', 'Sand', 'Thorn', 'Wes', 'Brook', 'Holt', 'Kings', 'Lyn', 'Stan'];
const NAME_B = ['by', 'ford', 'ton', 'wick', 'field', 'ley', 'mere', 'stead', 'well', 'combe', 'ham', 'bridge', 'dale', 'hurst'];

export function siteAirfields(natural: (north: number, east: number) => number, hydro: Hydrology, lakes: readonly Lake[]): Airfield[] {
  const r = rng(seeded(7300));
  const river = { dist: Infinity, level: 0, halfWidth: 0, s: 0, side: 0, beyondSource: 0 };
  const valley = { dist: 0, level: 0, floodplain: 0 };
  const dry = (n: number, e: number, clear: number): boolean => {
    for (const l of lakes) if (Math.hypot(n - l.north, e - l.east) < l.bound + clear) return false;
    hydro.queryValley(n, e, valley);
    if (valley.dist < valley.floodplain + clear) return false;
    hydro.queryRiver(n, e, river);
    return !(river.dist < river.halfWidth + clear);
  };

  // --- Pass 1: the flattest dry spots on the lattice (jittered so the fields do not line up).
  const spots: { n: number; e: number; score: number }[] = [];
  const R1 = AIRFIELD_RING[1];
  for (let n = -R1; n <= R1; n += LATTICE) {
    for (let e = -R1; e <= R1; e += LATTICE) {
      const jn = n + (r() - 0.5) * LATTICE * 0.6;
      const je = e + (r() - 0.5) * LATTICE * 0.6;
      const d = Math.hypot(jn, je);
      if (d < AIRFIELD_RING[0] || d > R1) continue;
      let lo = Infinity, hi = -Infinity;
      for (let i = -2; i <= 2; i++) {
        for (let j = -2; j <= 2; j++) {
          const h = natural(jn + i * 400, je + j * 400);
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
      }
      if (lo < MIN_HEIGHT || hi > MAX_HEIGHT) continue;
      if (!dry(jn, je, 600)) continue;
      // Not inside a forestry estate (plantation.ts): its compartments and tracks would run across the field.
      let estate = 0;
      for (const [i, j] of [[0, 0], [-3, -3], [-3, 3], [3, -3], [3, 3]]) estate = Math.max(estate, estateWeight(je + j * 400, jn + i * 400, lo));
      if (estate > 0.1) continue;
      spots.push({ n: jn, e: je, score: hi - lo });
    }
  }
  spots.sort((a, b) => a.score - b.score);

  // --- Pass 2: the best runway heading at each shortlisted spot.
  type Cand = { n: number; e: number; heading: number; length: number; elevation: number; spread: number; score: number };
  const cands: Cand[] = [];
  for (const s of spots.slice(0, SHORTLIST)) {
    let best: Cand | null = null;
    for (let k = 0; k < 8; k++) {
      const heading = (k / 8) * Math.PI;
      const c = Math.cos(heading), sn = Math.sin(heading);
      const at = (along: number, across: number) => natural(s.n + c * along - sn * across, s.e + sn * along + c * across);
      const half = SEALED.length[1] / 2 + 150;
      const hs: number[] = [];
      for (let i = -6; i <= 6; i++) for (const a of [-90, 0, 90]) hs.push(at((i / 6) * half, a));
      const lo = Math.min(...hs), hi = Math.max(...hs);
      const elevation = hs.reduce((x, y) => x + y, 0) / hs.length;
      // High ground under the approaches: how far it stands above a 4 % slope from each runway end.
      let block = 0;
      for (const dir of [-1, 1]) {
        for (let b = 500; b <= 3000; b += 500) block = Math.max(block, at(dir * (half + b), 0) - (elevation + 0.04 * b));
      }
      if (lo < MIN_HEIGHT) continue;
      const score = hi - lo + Math.max(0, block);
      if (!best || score < best.score) best = { n: s.n, e: s.e, heading, length: 0, elevation, spread: hi - lo, score };
    }
    if (best && dry(best.n, best.e, 900)) cands.push(best);
  }
  cands.sort((a, b) => a.score - b.score);

  // --- Take the best, spaced apart, and fit each one's kit to its ground.
  const fields: Airfield[] = [];
  const used = new Set<string>();
  for (const c of cands) {
    if (fields.length >= AIRFIELD_COUNT) break;
    if (fields.some((f) => Math.hypot(f.north - c.n, f.east - c.e) < AIRFIELD_SPACING)) continue;
    const sealed = c.spread < SEALED_SPREAD && (fields.length < SEALED_FIRST || r() < 0.25);
    const kit = sealed ? SEALED : GRASS;
    const length = Math.round((kit.length[0] + r() * (kit.length[1] - kit.length[0])) / 10) * 10;
    let name = '';
    let code = '';
    for (let k = 0; k < 20 && (!name || used.has(code)); k++) {
      name = NAME_A[Math.floor(r() * NAME_A.length)] + NAME_B[Math.floor(r() * NAME_B.length)];
      // K, then the name's first letter and consonants (a leading K not doubled).
      const letters = (name[0] + name.slice(1).replace(/[aeiou]/g, '')).toUpperCase().replace(/^K/, '');
      code = ('K' + letters + 'XXX').slice(0, 4);
    }
    used.add(code);
    fields.push({
      code,
      name: `${name} ${sealed ? 'Aerodrome' : 'Airstrip'}`,
      kind: sealed ? 'sealed' : 'grass',
      north: Math.round(c.n),
      east: Math.round(c.e),
      elevation: Math.round(c.elevation),
      heading: c.heading,
      ids: runwayIds(c.heading),
      length,
      width: kit.width,
      flatMargin: kit.flatMargin,
      blend: kit.blend,
      approachLength: kit.approach,
      circuit: r() < 0.7 ? 'left' : 'right',
      frequency: Math.round((122.7 + Math.floor(r() * 12) * 0.025) * 1000) / 1000,
      apronAlong: Math.round((r() - 0.5) * length * (sealed ? 0.6 : 0.5)),
    });
  }
  return fields;
}
