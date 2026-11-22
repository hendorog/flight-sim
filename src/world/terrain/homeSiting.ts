// Where a seeded world's home airfield sits in its landscape, and which way its runway runs (any seed but 0; seed 0
// keeps Fable Regional, core/world.ts). The field stays at the world's origin: seededLayout.ts turns and shifts the
// landscape under it and asks siteHome whether the ground at the origin will take a runway. Anything goes - a coastal
// plain, a plateau, a hillside shelf, a mountain valley, a lakeshore - so long as an airfield could really be built
// there and the starts can be flown:
//
//   the pad      the runway and its flat margin within MAX_SPREAD of relief (the cut and fill the terrain makes),
//                all of it on land, the field below MAX_ELEVATION
//   approach     the low-numbered end (the 'runway' and 'final' starts use it) is approached over ground below a
//                4 % slope from its threshold out to 10 km (the 3 degree path is 5.2 %), with a small allowance
//   far end      the ground beyond the far end (the climb-out, and the other runway's approach) stays under the
//                same 4 % slope: the terrain trims both approach corridors to it, so no wedge is cut into a hill
//   circuit      nothing within the traffic pattern stands higher than CIRCUIT_CLEAR below pattern altitude
//
// Of the headings that pass, the one with the least relief under the pad and the most open far end wins: real
// runways follow the ground. Pure (no three.js), given the natural-height function (no import of heightfield.ts).

import { runwayIds } from '../airfields';

/** Most relief the airfield's pad may stand on, m: the flattening cuts and fills at most about half of it. */
export const MAX_SPREAD = 70;
/** Highest field elevation, m (about 5900 ft: a light aircraft still climbs on a summer day). */
export const MAX_ELEVATION = 1800;
/** Pattern altitude above the field (1000 ft) less this margin, m: the highest ground allowed in the circuit. */
const CIRCUIT_CLEAR = 1000 * 0.3048 - 100;
/** Runway half-length plus the flat margin along it, and the margin across, m (core/world.ts AIRPORT: 900 + 450). */
const PAD_ALONG = 1350;
const PAD_ACROSS = 465;
/** Headings tried, over the half circle. */
const HEADINGS = 18;

export interface HomeSite {
  /** True heading of the low-numbered end's take-off direction, rad, [0, pi). */
  heading: number;
  ids: [string, string];
  /** Field elevation, m (rounded). */
  elevation: number;
  /** Relief under the pad, m. */
  spread: number;
}

/** How the ground at the origin takes a runway on one heading (siteRunway). */
export interface RunwayFit {
  heading: number;
  /** Field elevation, m (rounded), and the relief under the pad, m (Infinity: part of it off land). */
  elevation: number;
  spread: number;
  /** Most the ground stands over the 4 % slope out from the low-numbered threshold and beyond the far end, m. */
  approach: number;
  open: number;
  /** Most the ground in the circuit stands over the field, m. */
  circuit: number;
  /** All the checks pass. */
  ok: boolean;
}

/** The runway on `heading` (rad) at the origin over the ground `natural`: the pad, the approach, the far end, the circuit. */
export function siteRunway(natural: (north: number, east: number) => number, heading: number): RunwayFit {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const at = (along: number, across: number): number => natural(c * along - s * across, s * along + c * across);
  // The pad: relief and elevation.
  let lo = Infinity;
  let hi = -Infinity;
  let sum = 0;
  let n = 0;
  for (let i = -6; i <= 6; i++) {
    for (let j = -2; j <= 2; j++) {
      const h = at((i / 6) * PAD_ALONG, (j / 2) * PAD_ACROSS);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
      sum += h;
      n++;
    }
  }
  const elevation = Math.round(sum / n);
  const fit: RunwayFit = { heading, elevation, spread: lo < 2 ? Infinity : hi - lo, approach: Infinity, open: Infinity, circuit: Infinity, ok: false };
  if (lo < 2 || hi - lo > MAX_SPREAD || elevation > MAX_ELEVATION) return fit;
  // The approach to the low-numbered end (from -along) and the climb-out beyond the far end (+along).
  let approach = 0;
  let open = 0;
  for (let b = 500; b <= 10000; b += 500) {
    for (const x of [-400, 0, 400]) approach = Math.max(approach, at(-900 - b, x) - (elevation + 0.04 * b));
    // The far end's approach corridor is trimmed to the same 4 % (heightfield.ts): ground much above it would be
    // cut into a wedge with sheer walls, so it is held to the same allowance.
    for (const x of [-400, 0, 400]) open = Math.max(open, at(900 + b, x) - (elevation + 0.04 * b));
  }
  fit.approach = approach;
  fit.open = open;
  if (approach > 25 || open > 25) return fit;
  // The circuit: either side of the runway (left- or right-hand), out to the base legs.
  let circuit = -Infinity;
  for (let a = -3500; a <= 3500; a += 700) {
    for (const x of [-1800, -900, 0, 900, 1800]) circuit = Math.max(circuit, at(a, x));
  }
  fit.circuit = circuit - elevation;
  fit.ok = circuit <= elevation + CIRCUIT_CLEAR;
  return fit;
}

/** The best runway at the origin of the current layout, or null when the ground will not take one. */
export function siteHome(natural: (north: number, east: number) => number): HomeSite | null {
  let best: (HomeSite & { score: number }) | null = null;
  for (let k = 0; k < HEADINGS; k++) {
    const heading = (k / HEADINGS) * Math.PI;
    const f = siteRunway(natural, heading);
    if (!f.ok) continue;
    const score = f.spread + 0.3 * Math.max(0, f.approach + 25) + 0.3 * Math.max(0, f.open + 25);
    if (!best || score < best.score) best = { heading, ids: runwayIds(heading), elevation: f.elevation, spread: f.spread, score };
  }
  return best && { heading: best.heading, ids: best.ids, elevation: best.elevation, spread: best.spread };
}
