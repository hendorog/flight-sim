// Reference sites (the airport and the airfields, from sim/worldEnvironment.ts): the horizontal terrain terms of the
// wind (wave speed-up, lee shelter, valley channelling, slope winds) are multiplied by the product over the sites of
// smoothstep(SITE_INNER, SITE_OUTER, distance), so the wind reported at every field stays the setting and the
// crosswind lessons keep their wind.

import { smoothstep } from '../../../core/math';

export interface ReferenceSite {
  north: number;
  east: number;
}

/** Inside SITE_INNER of a site the terms are 0; beyond SITE_OUTER that site does not reduce them, m. */
export const SITE_INNER = 2000;
export const SITE_OUTER = 5000;

/** The mask at NED (north, east), 0..1. */
export function siteMask(sites: readonly ReferenceSite[], north: number, east: number): number {
  let m = 1;
  const outer2 = SITE_OUTER * SITE_OUTER;
  for (let i = 0; i < sites.length; i++) {
    const dn = north - sites[i].north;
    const de = east - sites[i].east;
    const d2 = dn * dn + de * de;
    if (d2 >= outer2) continue;
    m *= smoothstep(SITE_INNER, SITE_OUTER, Math.sqrt(d2));
    if (m === 0) return 0;
  }
  return m;
}
