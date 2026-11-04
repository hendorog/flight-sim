// The large-scale layout of a seeded world (any seed but 0): where the land and the sea are, where the mountain
// ranges run, and which country is plain and which is hill country. Seed 0 keeps the hand-shaped layout of
// heightfield.ts (coast to the south, range to the north, valley along the runway) and never calls this module.
//
// The layout is a few very broad noise fields, turned and shifted by the seed. The home airfield stays at the origin,
// so the shift is chosen by a search: the first candidate whose macro fields suit (the field on land, land around it
// for the generated airfields, a coast or a range within reach) and whose ground takes a runway (homeSiting.ts) wins,
// and the home field moves there with its own name, heading and elevation (core/world.ts setHomeAirport). Anything
// goes - a coastal plain, a plateau, a basin among mountains, a hillside - as long as the field could be built and
// flown. Pure (no three.js); every thread runs the same search at load and gets the same answer.

import { fbm, gnoise, mulberry32 } from './noise';
import { onWorldSeed, seeded, worldSeed } from '../worldSeed';
import { SEED0_HOME, setHomeAirport } from '../../core/world';
import { siteHome, type HomeSite } from './homeSiting';

/** The macro fields at one point (macroAt). */
export interface Macro {
  /** Warped distance inland from the coast, m (negative offshore); drives the coastal profile. */
  inland: number;
  /** Alpine uplift, about [0, 1.15]: the mountain ranges. */
  uplift: number;
  /** Foothill belt around the ranges, [0, 1]. */
  foothill: number;
  /** Hill-country factor, [0.35, 1]: low in the plains, 1 in the hill country. */
  hilly: number;
}

interface Layout {
  /** Rotation of the layout frame, rad, and its offset, m. */
  cos: number;
  sin: number;
  offX: number;
  offY: number;
  /** Continent noise threshold: more land as it falls. */
  sea: number;
}

const L: Layout = { cos: 1, sin: 0, offX: 0, offY: 0, sea: 0 };

/** Continent wavelength, ridge (range) wavelength, plains/hill-country wavelength, m. */
const CONTINENT = 170000;
const RANGES = 75000;
const COUNTRY = 38000;
/** Metres of "inland" per unit of the continent noise above the threshold. */
const INLAND_SCALE = 95000;

/** The macro fields at a point (any seed but 0). Writes into `out` and returns it. */
export function macroAt(north: number, east: number, out: Macro): Macro {
  // The layout frame: turned and shifted by the seed.
  const x = L.cos * east - L.sin * north + L.offX;
  const y = L.sin * east + L.cos * north + L.offY;

  // Land and sea: a broad fBm, warped so the coast does not follow the noise lattice, with today's small-scale
  // headlands and bays on top.
  const wx = x + 22000 * fbm(x / 60000 + 3.1, y / 60000 - 7.4, 2);
  const wy = y + 22000 * fbm(x / 60000 - 5.6, y / 60000 + 1.3, 2);
  const cont = fbm(wx / CONTINENT, wy / CONTINENT, 4);
  out.inland = (cont - L.sea) * INLAND_SCALE + 1800 * fbm(east / 9000 - 2.3, north / 9000 + 4.2, 2) + 3500 * fbm(east / 28000 + 11.3, north / 28000 - 4.2, 3);

  // Mountain ranges: the crest lines of a ridged noise (long, branching belts), strongest where two octaves agree.
  const rx = x + 14000 * fbm(x / 30000 + 8.8, y / 30000 + 2.2, 2);
  const ry = y + 14000 * fbm(x / 30000 - 1.7, y / 30000 - 6.6, 2);
  const r1 = 1 - Math.abs(gnoise(rx / RANGES + 0.37, ry / RANGES - 0.81));
  const r2 = 1 - Math.abs(gnoise(rx / (RANGES * 0.45) - 4.1, ry / (RANGES * 0.45) + 2.9));
  const ridge = 0.72 * r1 + 0.28 * r2;
  const land = smooth(2000, 22000, out.inland);
  out.uplift = smooth(0.74, 0.93, ridge) * land * (0.85 + 0.3 * fbm(east / 55000 - 3.3, north / 55000 + 1.9, 2));
  out.foothill = smooth(0.55, 0.8, ridge) * smooth(-1000, 15000, out.inland);

  // Plains and hill country.
  out.hilly = 0.35 + 0.65 * smooth(-0.25, 0.25, fbm(x / COUNTRY - 2.6, y / COUNTRY + 5.2, 2));
  return out;
}

function smooth(e0: number, e1: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** How the chosen layout scored (for tests and the dev pages). */
export interface LayoutReport {
  /** Candidate index chosen, and how many were tried. */
  candidate: number;
  tried: number;
  /** Inland distance at the field, m; nearest coast and nearest high range found on the rings, km (Infinity if none). */
  inlandAtField: number;
  coastKm: number;
  rangeKm: number;
  /** The home field's site (homeSiting.ts), null if no candidate took a runway (then seed 0's field stands). */
  site: HomeSite | null;
}

let report: LayoutReport = { candidate: -1, tried: 0, inlandAtField: 0, coastKm: Infinity, rangeKm: Infinity, site: null };
/** The layout search's result for the current seed. */
export const layoutReport = (): LayoutReport => report;

const CANDIDATES = 400;
const M: Macro = { inland: 0, uplift: 0, foothill: 0, hilly: 0 };

/**
 * The natural ground of the current layout, for the home field's site (homeSiting.ts). heightfield.ts registers it
 * at load (it imports this module, so this one cannot import it).
 */
let natural: ((north: number, east: number) => number) | null = null;
export function setLayoutGround(f: (north: number, east: number) => number): void {
  natural = f;
}

/**
 * Choose the layout for the current seed: the first candidate whose macro fields suit (homeScreen) and whose ground
 * at the origin takes a runway (homeSiting.ts), then move the home field there (core/world.ts setHomeAirport).
 */
function chooseLayout(): void {
  // Seed 0 keeps Fable Regional (and back to it after another seed); the home field moves before anything that
  // derives from it rebuilds (core/world.ts onHomeAirport runs inside setHomeAirport, before heightfield's water).
  setHomeAirport(SEED0_HOME);
  if (worldSeed() === 0) return;
  const rnd = mulberry32(seeded(0x1a7b0));
  let fallback: { L: Layout; report: LayoutReport } | null = null;
  for (let k = 0; k < CANDIDATES; k++) {
    const a = rnd() * Math.PI * 2;
    L.cos = Math.cos(a);
    L.sin = Math.sin(a);
    L.offX = (rnd() - 0.5) * 4e6;
    L.offY = (rnd() - 0.5) * 4e6;
    L.sea = -0.12 + 0.16 * rnd();
    const r = homeScreen(k);
    if (!r) continue;
    fallback ??= { L: { ...L }, report: r };
    const site = natural ? siteHome(natural) : null;
    if (!site) continue;
    report = { ...r, site };
    setHomeAirport({ ...homeName(), elevation: site.elevation, heading: site.heading, ids: site.ids, approachLength: SEEDED_APPROACH });
    return;
  }
  // No candidate took a runway (not seen): the first that suited, with seed 0's field on its plain.
  if (fallback) {
    Object.assign(L, fallback.L);
    report = fallback.report;
  }
}

/** Protected approach length of a seeded world's home field, m (its approach is checked clear out to 10 km). */
const SEEDED_APPROACH = 8000;

/**
 * The macro fields' screen of the current candidate: the field on land, most of the ring the generated airfields use
 * on land too, and a coast or a high range within reach. Anything else - coast or inland, plain or mountains - goes.
 */
function homeScreen(k: number): LayoutReport | null {
  macroAt(0, 0, M);
  const inland0 = M.inland;
  if (inland0 < 1500) return null;
  let coast = Infinity;
  let range = Infinity;
  let landRing = 0;
  let ringPts = 0;
  for (let rk = 10; rk <= 80; rk += 5) {
    const n = Math.round(rk * 0.8) + 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      macroAt(rk * 1000 * Math.cos(a), rk * 1000 * Math.sin(a), M);
      if (M.inland < 0) coast = Math.min(coast, rk);
      if (M.uplift > 0.6) range = Math.min(range, rk);
      if (rk >= 15 && rk <= 45) {
        ringPts++;
        if (M.inland > 3000) landRing++;
      }
    }
  }
  if (landRing / Math.max(1, ringPts) < 0.55) return null;
  if (coast > 80 && range > 80) return null;
  return { candidate: k, tried: k + 1, inlandAtField: inland0, coastKm: coast, rangeKm: range, site: null };
}

const NAME_A = ['Ash', 'Bel', 'Carr', 'Dray', 'Eske', 'Fen', 'Gar', 'Hal', 'Ing', 'Kil', 'Loch', 'Mor', 'Nant', 'Orm', 'Pen', 'Quarr', 'Ros', 'Shel', 'Tarn', 'Ux', 'Vale', 'Wynd', 'Yar', 'Zenn'];
const NAME_B = ['brook', 'bury', 'caster', 'don', 'field', 'gate', 'haven', 'holme', 'ley', 'mouth', 'port', 'ridge', 'thorpe', 'water'];
const NAME_KIND = ['Regional', 'Airport', 'Municipal', 'County'];

/** The home field's name and ICAO code for the current seed ('Kilhaven Regional', 'KKLH'). */
function homeName(): { name: string; icao: string } {
  const r = mulberry32(seeded(0x40e1));
  const place = NAME_A[Math.floor(r() * NAME_A.length)] + NAME_B[Math.floor(r() * NAME_B.length)];
  const kind = NAME_KIND[Math.floor(r() * NAME_KIND.length)];
  const letters = (place[0] + place.slice(1).replace(/[aeiou]/g, '')).toUpperCase().replace(/^K/, '');
  return { name: `${place} ${kind}`, icao: ('K' + letters + 'XXX').slice(0, 4) };
}

chooseLayout();
onWorldSeed(chooseLayout);
