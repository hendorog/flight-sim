// The large-scale layout of a seeded world (any seed but 0): where the land and the sea are, where the mountain
// ranges run, and which country is plain and which is hill country. Seed 0 keeps the hand-shaped layout of
// heightfield.ts (coast to the south, range to the north, valley along the runway) and never calls this module.
//
// The layout is a few very broad noise fields, turned and shifted by the seed. The home airfield stays at the origin,
// so the shift is chosen by a short search: the first candidate layout that puts the field on dry lowland, with a
// coast and high mountains within reach of a light aircraft, wins. Pure (no three.js); every thread runs the same
// search at load and gets the same answer.

import { fbm, gnoise, mulberry32 } from './noise';
import { onWorldSeed, seeded, worldSeed } from '../worldSeed';
import { AIRPORT } from '../../core/world';

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
  /** Inland distance at the field, m; nearest coast and nearest high range found on the rings, m (Infinity if none). */
  inlandAtField: number;
  coastKm: number;
  rangeKm: number;
}

let report: LayoutReport = { candidate: -1, tried: 0, inlandAtField: 0, coastKm: Infinity, rangeKm: Infinity };
/** The layout search's result for the current seed. */
export const layoutReport = (): LayoutReport => report;

const CANDIDATES = 160;
const M: Macro = { inland: 0, uplift: 0, foothill: 0, hilly: 0 };

/** Choose the layout for the current seed: the first candidate that suits the home field, else the best scored. */
function chooseLayout(): void {
  if (worldSeed() === 0) return;
  const rnd = mulberry32(seeded(0x1a7b0));
  let best = -Infinity;
  let bestL: Layout = { ...L };
  let bestR: LayoutReport = report;
  for (let k = 0; k < CANDIDATES; k++) {
    const a = rnd() * Math.PI * 2;
    L.cos = Math.cos(a);
    L.sin = Math.sin(a);
    L.offX = (rnd() - 0.5) * 4e6;
    L.offY = (rnd() - 0.5) * 4e6;
    L.sea = -0.12 + 0.16 * rnd();
    const r = scoreLayout(k);
    if (r.score > best) {
      best = r.score;
      bestL = { ...L };
      bestR = r.report;
    }
    if (r.ok) break;
  }
  Object.assign(L, bestL);
  report = bestR;
}

/**
 * Score the current candidate. Hard needs: the field on dry lowland well inland, no mountains or foothills over it or
 * under its approaches.
 * Wants: a coast 15-70 km away, a high range 15-80 km away, land on most of the ring the generated airfields use.
 */
function scoreLayout(k: number): { ok: boolean; score: number; report: LayoutReport } {
  macroAt(0, 0, M);
  const inland0 = M.inland;
  let worstUp = M.uplift;
  let worstFoot = M.foothill;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    macroAt(4000 * Math.cos(a), 4000 * Math.sin(a), M);
    worstUp = Math.max(worstUp, M.uplift);
    worstFoot = Math.max(worstFoot, M.foothill);
  }
  // Both approaches to the home runway, out to the 12 km its approach protection reaches: no foothills under them
  // (the protection would cut a flat wedge into them).
  const hc = Math.cos(AIRPORT.runway.heading);
  const hs = Math.sin(AIRPORT.runway.heading);
  for (const along of [-12000, -9000, -6000, 6000, 9000, 12000]) {
    macroAt(along * hc, along * hs, M);
    worstUp = Math.max(worstUp, M.uplift);
    worstFoot = Math.max(worstFoot, M.foothill);
  }
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
  const landFrac = landRing / Math.max(1, ringPts);
  const okField = inland0 > 9000 && worstUp < 0.02 && worstFoot < 0.35;
  const okCoast = coast >= 15 && coast <= 70;
  const okRange = range >= 15 && range <= 80;
  const ok = okField && okCoast && okRange && landFrac > 0.6;
  const score = (okField ? 4 : 0) + (okCoast ? 2 : 0) + (okRange ? 2 : 0) + landFrac - worstFoot;
  return { ok, score, report: { candidate: k, tried: k + 1, inlandAtField: inland0, coastKm: coast, rangeKm: range } };
}

chooseLayout();
onWorldSeed(chooseLayout);
