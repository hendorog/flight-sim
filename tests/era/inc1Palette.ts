// Deep Time, increment 2 (WP8 integration): the increment-1 Cretaceous ground palette, frozen, so the shader
// baseline tests can compare the current Cretaceous terrain program with tests/fixtures/eraCretaceousTerrainInc1.json
// (never regenerated) after WP7's palette pass. Palette entries are shader text: normaliseToInc1() maps each current
// literal back to its increment-1 literal before the byte compare, so the compare still pins everything else.

import { ERA_GROUND, PALETTES } from '../../src/world/terrain/eraPalette';
import { VOLCANO_PALETTE } from '../../src/world/terrain/volcano';

/** Increment 1's values of the Cretaceous entries that increment 2 retuned (git df93577, before WP7). */
const INC1_PALETTE: Readonly<Record<string, string>> = Object.freeze({
  meadowWet: 'vec3(0.036, 0.050, 0.016)',
  meadowDry: 'vec3(0.095, 0.072, 0.028)',
  floor: 'vec3(0.034, 0.036, 0.020)',
  turfA: 'vec3(0.034, 0.062, 0.026)',
  turfB: 'vec3(0.066, 0.068, 0.034)',
  rockA: 'vec3(0.108, 0.088, 0.068)',
  rockB: 'vec3(0.205, 0.168, 0.128)',
  strataTintA: 'vec3(0.88, 0.84, 0.80)',
  strataTintB: 'vec3(1.14, 1.02, 0.88)',
  sand: 'vec3(0.31, 0.27, 0.20)',
  snow: 'vec3(0.74, 0.76, 0.80)',
  mud: 'vec3(0.060, 0.046, 0.030)',
  mudLight: 'vec3(0.095, 0.078, 0.056)',
  riverBed: 'vec3(0.042, 0.034, 0.024)',
  bankRoughA: 'vec3(0.036, 0.062, 0.024)',
  bankRoughB: 'vec3(0.070, 0.080, 0.034)',
  reeds: 'vec3(0.085, 0.100, 0.040)',
  alpine: 'vec3(0.070, 0.066, 0.040)',
  scree: 'vec3(0.150, 0.135, 0.118)',
  canopyBroadleaf: 'vec3(0.62, 0.66, 0.46)',
  canopyConifer: 'vec3(0.42, 0.52, 0.46)',
  seaAtten: 'vec3(0.42, 0.10, 0.13)',
  seaBodyDeep: 'vec3(0.0045, 0.016, 0.016)',
  seaBodyShallow: 'vec3(0.016, 0.036, 0.024)',
  riverAtten: 'vec3(0.95, 1.35, 2.3)',
  riverBody: 'vec3(0.048, 0.036, 0.019)',
});
const INC1_GROUND: Readonly<Record<string, string>> = Object.freeze({
  soil: 'vec3(0.120, 0.070, 0.045)',
  marsh: 'vec3(0.068, 0.090, 0.026)',
  marshWet: 'vec3(0.026, 0.032, 0.020)',
  mudFlat: 'vec3(0.118, 0.098, 0.060)',
  mudCrack: 'vec3(0.045, 0.034, 0.024)',
  trail: 'vec3(0.070, 0.056, 0.040)',
});
/** VOLCANO_PALETTE as increment 1 inlined it (eraHooks' 'exact increment-1 literals' test pins these). */
export const INC1_VOLCANO_PALETTE: Readonly<Record<string, string>> = Object.freeze({
  basalt: 'vec3(0.052, 0.049, 0.046)',
  scoria: 'vec3(0.12, 0.052, 0.03)',
  ash: 'vec3(0.05, 0.048, 0.046)',
  ashPale: 'vec3(0.095, 0.088, 0.078)',
  craterOchre: 'vec3(0.16, 0.09, 0.04)',
  craterSulphur: 'vec3(0.52, 0.44, 0.12)',
  craterPale: 'vec3(0.5, 0.48, 0.42)',
});

function pairs(): [string, string][] {
  const out: [string, string][] = [];
  const add = (cur: Readonly<Record<string, unknown>> | null, old: Readonly<Record<string, string>>): void => {
    if (!cur) return;
    for (const [k, v] of Object.entries(cur)) if (typeof v === 'string' && k in old && v !== old[k]) out.push([v, old[k]]);
  };
  add(PALETTES.cretaceous as unknown as Record<string, unknown>, INC1_PALETTE);
  add(ERA_GROUND.cretaceous as unknown as Record<string, unknown> | null, INC1_GROUND);
  add(VOLCANO_PALETTE as unknown as Record<string, unknown>, INC1_VOLCANO_PALETTE);
  return out;
}

/** The program text with each retuned Cretaceous palette literal put back to its increment-1 value (two-phase, so a
 *  new value equal to another entry's old value cannot chain). */
export function normaliseToInc1(text: string): string {
  const p = pairs();
  let s = text;
  p.forEach(([cur], i) => (s = s.split(cur).join(`\u0000INC1_${i}\u0000`)));
  p.forEach(([, old], i) => (s = s.split(`\u0000INC1_${i}\u0000`).join(old)));
  return s;
}
