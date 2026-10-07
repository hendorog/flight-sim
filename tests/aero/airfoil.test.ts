import { describe, expect, it } from 'vitest';
import { DEG, wrapPi } from '../../src/core/math';
import {
  addFlapDeflection,
  blendSections,
  clearFlapIncrement,
  evaluateSection,
  flapAlphaCoupling,
  makeFlapModel,
  makeSectionCoefficients,
  makeSectionCondition,
  prepareSection,
  staticSeparation,
  type AirfoilSection,
  type FlapIncrement,
  type SectionCondition,
} from '../../src/physics/aero/airfoil';
import { FX_63_137, NACA_0009, NACA_0012, NACA_2412, NACA_65_2_415, NASA_LS1_0417 } from '../../src/physics/aero/sections';

const noFlap = (): FlapIncrement => clearFlapIncrement({ dAlpha0: 0, dStall: 0, dCd: 0, dCm: 0, chordExtension: 0 });

function condition(s: AirfoilSection, re = s.reRef, mach = 0.1, flap = noFlap()): SectionCondition {
  return prepareSection(s, re, mach, flap, 1.98, 1, makeSectionCondition());
}

/** Static (steady) section coefficients. */
function stat(c: SectionCondition, alphaDeg: number) {
  const a = alphaDeg * DEG;
  return { ...evaluateSection(c, a, staticSeparation(c, a), makeSectionCoefficients()) };
}

function clmax(c: SectionCondition): { cl: number; alpha: number } {
  let best = { cl: -Infinity, alpha: 0 };
  for (let a = 0; a <= 30; a += 0.1) {
    const cl = stat(c, a).cl;
    if (cl > best.cl) best = { cl, alpha: a };
  }
  return best;
}

describe('NACA 2412 (Abbott & von Doenhoff, R = 5.7e6)', () => {
  const c = condition(NACA_2412);
  it('zero-lift angle about -2.1 deg', () => {
    let a = -5;
    while (stat(c, a).cl < 0) a += 0.01;
    expect(a).toBeGreaterThan(-2.4);
    expect(a).toBeLessThan(-1.8);
  });
  it('lift-curve slope about 0.105 per deg', () => {
    const slope = (stat(c, 6).cl - stat(c, -4).cl) / 10;
    expect(slope).toBeGreaterThan(0.1);
    expect(slope).toBeLessThan(0.11);
  });
  it('cl,max about 1.67 at 15-17 deg', () => {
    const m = clmax(c);
    expect(m.cl).toBeGreaterThan(1.6);
    expect(m.cl).toBeLessThan(1.72);
    expect(m.alpha).toBeGreaterThan(14.5);
    expect(m.alpha).toBeLessThan(17.5);
  });
  it('minimum drag about 0.006 and cm,c/4 about -0.047', () => {
    let cdMin = Infinity;
    for (let a = -4; a <= 6; a += 0.25) cdMin = Math.min(cdMin, stat(c, a).cd);
    expect(cdMin).toBeGreaterThan(0.0055);
    expect(cdMin).toBeLessThan(0.0068);
    expect(stat(c, 2).cm).toBeCloseTo(-0.047, 3);
    // Drag at cl = 1.0 about 0.010 (smooth data).
    expect(stat(c, 7.5).cd).toBeGreaterThan(0.009);
    expect(stat(c, 7.5).cd).toBeLessThan(0.013);
  });
  it('cl,max rises with Reynolds number', () => {
    expect(clmax(condition(NACA_2412, 9e6)).cl).toBeGreaterThan(clmax(condition(NACA_2412, 3e6)).cl);
    expect(stat(condition(NACA_2412, 2e6), 0).cd).toBeGreaterThan(stat(condition(NACA_2412, 9e6), 0).cd);
  });
  it('applies Prandtl-Glauert to the attached lift slope', () => {
    const lo = condition(NACA_2412, NACA_2412.reRef, 0);
    const hi = condition(NACA_2412, NACA_2412.reRef, 0.5);
    expect(hi.liftSlope / lo.liftSlope).toBeCloseTo(1 / Math.sqrt(0.75), 6);
  });
});

/** Angle of zero lift, deg (searched upward from -12 deg). */
function zeroLift(c: SectionCondition): number {
  let a = -12;
  while (stat(c, a).cl < 0) a += 0.01;
  return a;
}

/** Lowest cl reached between 0 and -30 deg, and its angle. */
function clmin(c: SectionCondition): { cl: number; alpha: number } {
  let best = { cl: Infinity, alpha: 0 };
  for (let a = 0; a >= -30; a -= 0.1) {
    const cl = stat(c, a).cl;
    if (cl < best.cl) best = { cl, alpha: a };
  }
  return best;
}

// The three fitted sections (sections.ts): each block checks the record against the rows of
// work/aircraft-data/sections.md it was fitted to, and pins what the fit gave up, so that a refit sees it.
describe('NASA LS(1)-0417 (TN D-7428 fig. 12(b), strip roughness at 0.08c; 2 % wall correction)', () => {
  const c = condition(NASA_LS1_0417);
  it('zero lift at -3.7 deg, cl 0.43 at 0 deg, slope 0.118 per deg', () => {
    expect(zeroLift(c)).toBeCloseTo(-3.7, 0);
    expect(stat(c, 0).cl).toBeCloseTo(0.43, 1);
    const slope = (stat(c, 4).cl - stat(c, -2).cl) / 6;
    expect(slope).toBeGreaterThan(0.108);
    expect(slope).toBeLessThan(0.122);
  });
  it('cl,max 1.55 at R 2.1e6 and 1.92 at 6.3e6 (measured 1.58 and 1.96, less 2 %), peaking within 2 deg of the measured 16 and 19 deg', () => {
    const lo = clmax(c), hi = clmax(condition(NASA_LS1_0417, 6.3e6));
    expect(Math.abs(lo.cl - 1.55)).toBeLessThan(0.03);
    expect(Math.abs(hi.cl - 1.92)).toBeLessThan(0.06);
    expect(clmax(condition(NASA_LS1_0417, 4.3e6)).cl).toBeCloseTo(1.745, 1);
    // The peak where the measured curve is within 0.03 of its maximum (14-16 deg; 16-19 deg at 6.3e6), and the
    // measured lift at 16 deg (R 2.1e6) within 0.05. The record with the break at f = 0.7 peaked at 12.3 deg.
    expect(lo.alpha).toBeGreaterThan(14);
    expect(lo.alpha).toBeLessThan(17);
    expect(hi.alpha).toBeGreaterThan(16.5);
    expect(Math.abs(stat(c, 16).cl - 0.98 * 1.58)).toBeLessThan(0.05);
    // The stall warning compares with the break (stallPos from zero lift): it now lies within 2.5 deg past the peak.
    expect(c.stallPos / DEG + c.alpha0 / DEG - lo.alpha).toBeGreaterThan(0);
    expect(c.stallPos / DEG + c.alpha0 / DEG - lo.alpha).toBeLessThan(2.5);
  });
  it('falls to 1.27 / 1.11 at 18 / 20 deg at R 2.1e6 (measured 1.31 / 1.16); the plateau after it is given up', () => {
    expect(Math.abs(stat(c, 18).cl - 0.98 * 1.34)).toBeLessThan(0.06);
    expect(Math.abs(stat(c, 20).cl - 0.98 * 1.18)).toBeLessThan(0.06);
    // Measured smooth plateau 1.18-1.22 to 24 deg: the record continues down to about 1.0.
    for (const a of [22, 24]) {
      expect(stat(c, a).cl).toBeGreaterThan(0.93);
      expect(stat(c, a).cl).toBeLessThan(1.22);
    }
  });
  it('strip-roughness drag 0.0126 at cl 0.4 (skinFactor 1.28) and cm -0.11 at 2 deg', () => {
    const rough = prepareSection(NASA_LS1_0417, 2.1e6, 0.1, noFlap(), 1.98, 1.28, makeSectionCondition());
    expect(Math.abs(stat(rough, 0).cd - 0.0126)).toBeLessThan(0.0007);
    expect(Math.abs(stat(c, 2).cm + 0.11)).toBeLessThan(0.01);
    // Negative stall unmeasured: XFOIL -1.0 to -1.1 at -15.5 to -17 deg (R 1e6).
    expect(Math.abs(clmin(c).cl + 1.1)).toBeLessThan(0.1);
  });
});

describe('NACA 65(2)-415 (TR 824 p. 217, smooth lift; standard-roughness drag)', () => {
  const c = condition(NACA_65_2_415);
  it('zero lift at -2.8 deg, cl 0.31 at 0 deg, slope 0.107 per deg', () => {
    expect(zeroLift(c)).toBeCloseTo(-2.8, 0);
    expect(Math.abs(stat(c, 0).cl - 0.31)).toBeLessThan(0.02);
    const slope = (stat(c, 4).cl - stat(c, -2).cl) / 6;
    expect(Math.abs(slope - 0.107)).toBeLessThan(0.003);
  });
  it('cl,max 1.43 / 1.58 / 1.61 at R 3.0 / 6.0 / 8.9e6 within 2 deg of the measured angles; cl 1.06 / 1.01 at 22 / 24 deg (R 3e6)', () => {
    const r3 = condition(NACA_65_2_415, 3e6);
    const m3 = clmax(r3), m6 = clmax(c);
    expect(Math.abs(m3.cl - 1.43)).toBeLessThan(0.03);
    expect(Math.abs(m6.cl - 1.58)).toBeLessThan(0.03);
    expect(Math.abs(clmax(condition(NACA_65_2_415, 8.9e6)).cl - 1.61)).toBeLessThan(0.05);
    // Measured peaks 16 deg (3e6) and 18 deg (6e6, within 0.03 of it from 16 to 19); the record at f = 0.7 had 13.2 / 14.9.
    expect(m3.alpha).toBeGreaterThan(14);
    expect(m6.alpha).toBeGreaterThan(15.5);
    expect(Math.abs(stat(r3, 16).cl - 1.43)).toBeLessThan(0.05);
    expect(Math.abs(stat(c, 18).cl - 1.58)).toBeLessThan(0.1);
    expect(Math.abs(stat(r3, 22).cl - 1.06)).toBeLessThan(0.12);
    expect(Math.abs(stat(r3, 24).cl - 1.01)).toBeLessThan(0.12);
  });
  it('cl,min -1.04 at -13 deg (R 6e6), rounded to -16 deg', () => {
    const m = clmin(c);
    expect(Math.abs(m.cl + 1.04)).toBeLessThan(0.05);
    expect(Math.abs(m.alpha + 13)).toBeLessThan(3.5);
  });
  it('cm -0.071 at 0 deg; standard-roughness cd,min 0.0101 at cl 0.2-0.3 with skinFactor 1.66', () => {
    expect(Math.abs(stat(c, 0).cm + 0.071)).toBeLessThan(0.006);
    const rough = prepareSection(NACA_65_2_415, 6e6, 0.1, noFlap(), 1.98, 1.66, makeSectionCondition());
    expect(Math.abs(stat(rough, 0).cd - 0.0101)).toBeLessThan(0.0006);
  });
});

describe('Wortmann FX 63-137 (PROVISIONAL: UIUC Re 0.5e6, NREL/SR-500-34515; no data at flight Reynolds number)', () => {
  const c = condition(FX_63_137);
  it('cl 0.82 at 0 deg, zero lift -7.3 deg (straight part extrapolated)', () => {
    expect(Math.abs(stat(c, 0).cl - 0.82)).toBeLessThan(0.03);
    expect(zeroLift(c)).toBeCloseTo(-7.3, 0);
  });
  it('soft stall: cl,max 1.76, within 0.06 of it from 11 to 20 deg; the record keeps it at any Reynolds number (assumed)', () => {
    expect(Math.abs(clmax(c).cl - 1.76)).toBeLessThan(0.03);
    for (const [a, measured] of [[11.37, 1.714], [14.28, 1.749], [17.34, 1.746], [20.29, 1.715]]) {
      expect(Math.abs(stat(c, a).cl - measured)).toBeLessThan(0.06);
    }
    expect(clmax(condition(FX_63_137, 3e6)).cl).toBeCloseTo(clmax(c).cl, 6);
  });
  it('collapses beyond the measured range (from 20.3 deg): cl 1.0-1.3 at 25-30 deg, not the plateau', () => {
    expect(stat(c, 25).cl).toBeLessThan(1.3);
    expect(stat(c, 25).cl).toBeGreaterThan(1.0);
    expect(stat(c, 30).cl).toBeLessThan(1.15);
    // Without the collapse the record held 1.72 at 25 deg.
    const noCollapse = condition({ ...FX_63_137, collapseAfter: undefined, collapseWidth: undefined });
    expect(stat(noCollapse, 25).cl).toBeGreaterThan(1.65);
    expect(stat(noCollapse, 20.29).cl).toBe(stat(c, 20.29).cl);
  });
  it('cm -0.20 at low angles, -0.147 at 10 deg; cd,min 0.0087 near cl 0.63', () => {
    expect(Math.abs(stat(c, 0).cm + 0.199)).toBeLessThan(0.008);
    expect(Math.abs(stat(c, 10.28).cm + 0.147)).toBeLessThan(0.01);
    expect(Math.abs(stat(c, -1.96).cd - 0.0087)).toBeLessThan(0.0006);
  });
});

describe('every wing section has a lift break', () => {
  it('cl at 30 deg is at most 1.3 (a separated section carries about 1.0-1.2; the plate alone 0.86)', () => {
    for (const s of [NACA_2412, NASA_LS1_0417, NACA_65_2_415, FX_63_137]) {
      for (const re of [1e6, 3e6, 6e6]) expect(stat(condition(s, re), 30).cl, s.name).toBeLessThan(1.3);
    }
  });
});

describe('breakSeparation and the soft-stall collapse (AirfoilSection)', () => {
  it('absent, the separation curve is the f = 0.7 one bit for bit (the Cessna 172S sections)', () => {
    // The curve as it was written before breakSeparation and the collapse existed.
    const before = (c: SectionCondition, alpha: number): number => {
      let x: number, hi: number, lo: number;
      if (Math.cos(alpha) >= 0) {
        x = wrapPi(alpha - c.alpha0);
        hi = c.stallPos;
        lo = c.stallNeg;
      } else {
        x = wrapPi(alpha - Math.PI);
        hi = c.reverseStall;
        lo = -c.reverseStall;
      }
      if (x > hi) return 0.7 * Math.exp((hi - x) / c.s2);
      if (x < lo) return 0.7 * Math.exp((x - lo) / c.s2);
      return Math.max(1 - 0.3 * (Math.exp((x - hi) / c.s1) + Math.exp((lo - x) / c.s1)), 0.7);
    };
    for (const s of [NACA_2412, NACA_0012, NACA_0009]) {
      for (const re of [1e6, s.reRef]) {
        const c = condition(s, re);
        for (let a = -180; a <= 180; a += 0.37) expect(staticSeparation(c, a * DEG)).toBe(before(c, a * DEG));
      }
    }
  });
  it('the break is at f = breakSeparation, continuous, and the lift peaks with the flow separated further forward', () => {
    const s = { ...NACA_2412, breakSeparation: 0.45, s1: 6 * DEG, stallPos: 21 * DEG };
    const c = condition(s);
    const atBreak = c.alpha0 + c.stallPos;
    expect(staticSeparation(c, atBreak)).toBeCloseTo(0.45, 2);
    expect(staticSeparation(c, atBreak + 1e-9)).toBeCloseTo(staticSeparation(c, atBreak - 1e-9), 6);
    // At the peak f lies between the break's 0.45 and 0.7 (sections.md 5.2: 0.45-0.6 for these sections).
    const f = staticSeparation(c, clmax(c).alpha * DEG);
    expect(f).toBeGreaterThan(0.45);
    expect(f).toBeLessThan(0.7);
  });
  it('blendSections mixes breakSeparation (absent = 0.7) and takes a one-sided collapse', () => {
    const half = blendSections(NACA_2412, NASA_LS1_0417, 0.5);
    expect(half.breakSeparation).toBeCloseTo(0.5 * (0.7 + NASA_LS1_0417.breakSeparation!), 12);
    const fx = blendSections(NACA_2412, FX_63_137, 0.5);
    expect(fx.collapseAfter).toBe(FX_63_137.collapseAfter);
    expect(fx.collapseWidth).toBe(FX_63_137.collapseWidth);
    expect(blendSections(NACA_2412, NACA_0012, 0.5).collapseAfter).toBeUndefined();
  });
});

describe('symmetric tail sections', () => {
  it('NACA 0012: cl,max ~1.55 at ~16 deg, symmetric', () => {
    const c = condition(NACA_0012);
    const m = clmax(c);
    expect(m.cl).toBeGreaterThan(1.48);
    expect(m.cl).toBeLessThan(1.62);
    expect(stat(c, 0).cl).toBeCloseTo(0, 9);
    expect(stat(c, -10).cl).toBeCloseTo(-stat(c, 10).cl, 9);
  });
  it('NACA 0009: cl,max ~1.3 at ~13 deg', () => {
    const m = clmax(condition(NACA_0009));
    expect(m.cl).toBeGreaterThan(1.22);
    expect(m.cl).toBeLessThan(1.4);
    expect(m.alpha).toBeLessThan(clmax(condition(NACA_0012)).alpha);
  });
});

describe('full-range behaviour', () => {
  const c = prepareSection(NACA_2412, 3e6, 0.1, noFlap(), 1.98, 1, makeSectionCondition());
  it('becomes a flat plate post-stall: cl ~ sin 2a, cd ~ 2 sin^2 a', () => {
    const at45 = stat(c, 45), at90 = stat(c, 90), at135 = stat(c, 135);
    // A finite surface relieves the broadside normal force (Viterna: 1.11 + 0.018 AR) but not at 45 deg.
    const finite = prepareSection(NACA_2412, 3e6, 0.1, noFlap(), 1.25, 1, makeSectionCondition());
    expect(stat(finite, 90).cd).toBeCloseTo(1.25, 1);
    expect(stat(finite, 30).cl).toBeGreaterThan(0.75);
    expect(at45.cl).toBeCloseTo(0.99, 1);
    expect(at45.cd).toBeCloseTo(0.99, 1);
    expect(at90.cl).toBeCloseTo(0, 2);
    expect(at90.cd).toBeCloseTo(1.99, 1);
    expect(at135.cl).toBeCloseTo(-0.99, 1);
    // Centre of pressure near mid-chord at 90 deg: nose-down quarter-chord moment ~ -cd90/4.
    expect(at90.cm).toBeCloseTo(-0.5, 1);
  });
  it('is continuous from -180 to 180 deg', () => {
    let prev = stat(c, -180);
    for (let a = -179.9; a <= 180; a += 0.1) {
      const cur = stat(c, a);
      expect(Math.abs(cur.cl - prev.cl)).toBeLessThan(0.08);
      expect(Math.abs(cur.cd - prev.cd)).toBeLessThan(0.05);
      expect(Math.abs(cur.cm - prev.cm)).toBeLessThan(0.05);
      prev = cur;
    }
  });
  it('keeps a positive lift slope at a frozen separation point (well-posed dynamic stall)', () => {
    const out = makeSectionCoefficients();
    for (const f of [1, 0.7, 0.3, 0]) {
      for (let a = 0; a <= 35; a += 1) {
        evaluateSection(c, a * DEG, f, out);
        expect(out.dcl).toBeGreaterThan(0);
      }
    }
  });
});

describe('flaps', () => {
  it('a measured large-deflection table (largeDeflection) follows the LS(1)-0417 20 % plain flap, which the DATCOM table cannot', () => {
    // sections.md 1.6 (NASA CR-2833, R 2.2e6, sealed): dcl at 20 / 30 / 40 deg is 1.7 / 2.4 / 2.9 times the 10-deg value.
    const dcl = (g: Parameters<typeof makeFlapModel>[0], deg: number) => {
      const at = (d: number) => {
        const inc = noFlap();
        addFlapDeflection(makeFlapModel(g), d * DEG, inc, 0);
        return stat(prepareSection(NASA_LS1_0417, 2.2e6, 0.13, inc, 1.98, 1.28, makeSectionCondition()), 0).cl;
      };
      return at(deg) - at(0);
    };
    const table = { kind: 'plain' as const, chordFraction: 0.2, viscousEffectiveness: 0.56 };
    const measured = { kind: 'plain' as const, chordFraction: 0.2, viscousEffectiveness: 0.56, largeDeflection: [1, 1, 0.86, 0.8, 0.69, 0.57, 0.4] };
    for (const [deg, ratio] of [[20, 1.7], [30, 2.4], [40, 2.9]]) {
      expect(Math.abs(dcl(measured, deg) / dcl(measured, 10) / ratio - 1), `${deg} deg`).toBeLessThan(0.08);
      // The plain table: 7 % low at 20 deg, 20-30 % at 30-40 (review-Bm-aero finding 6).
      expect(dcl(table, deg) / dcl(table, 10) / ratio).toBeLessThan(0.95);
    }
    // Absent, the model is the table's (the Cessna 172S's surfaces carry none).
    expect(makeFlapModel(table).effect).toBeUndefined();
    expect(() => makeFlapModel({ ...table, largeDeflection: [1, 1, 0.9] })).toThrow();
  });
  it('single-slotted 30 % chord flap at 30 deg: shift, c_l,max gain, drag and nose-down moment', () => {
    const inc = noFlap();
    addFlapDeflection(makeFlapModel({ kind: 'slotted', chordFraction: 0.3 }), 30 * DEG, inc);
    const flapped = condition(NACA_2412, 3e6, 0.1, inc);
    const clean = condition(NACA_2412, 3e6);
    expect(inc.dAlpha0 / DEG).toBeLessThan(-9);
    expect(inc.dAlpha0 / DEG).toBeGreaterThan(-14);
    const gain = clmax(flapped).cl - clmax(clean).cl;
    expect(gain).toBeGreaterThan(0.9);
    expect(gain).toBeLessThan(1.4);
    expect(clmax(flapped).alpha).toBeLessThan(clmax(clean).alpha);
    expect(stat(flapped, 0).cd - stat(clean, 0).cd).toBeGreaterThan(0.02);
    expect(stat(flapped, 0).cm).toBeLessThan(stat(clean, 0).cm - 0.15);
  });
  it('plain flap effectiveness follows thin-aerofoil theory at small deflection', () => {
    const m = makeFlapModel({ kind: 'plain', chordFraction: 0.25 });
    // Glauert: tau(0.25) = 0.609
    expect(m.tau).toBeCloseTo(0.609, 3);
    const inc = noFlap();
    addFlapDeflection(m, 2 * DEG, inc);
    expect(inc.dAlpha0 / (-0.609 * 2 * DEG)).toBeCloseTo(1, 2);
    const up = noFlap();
    addFlapDeflection(m, -10 * DEG, up);
    expect(up.dAlpha0).toBeGreaterThan(0);
    expect(up.dCm).toBeGreaterThan(0);
    // A real surface's viscous loss scales the effectiveness.
    const real = noFlap();
    addFlapDeflection(makeFlapModel({ kind: 'plain', chordFraction: 0.25, viscousEffectiveness: 0.75 }), 2 * DEG, real);
    expect(real.dAlpha0 / inc.dAlpha0).toBeCloseTo(0.75, 6);
  });
});

describe('NACA 2412 pitching moment through the stall (Abbott & von Doenhoff, R = 3.1e6)', () => {
  // The measured c_m,c/4 rises from -0.045 to about -0.03 at the lift peak and falls to about -0.06 at 18 deg and
  // -0.10 at 20-21 deg; the Leishman-Beddoes centre-of-pressure terms (momentK1/K2 in sections.ts) reproduce it. Without
  // them the model stayed at -0.05 to -0.066, too little nose-down moment after the break.
  it('follows the measured moment break: -0.03 at the peak, -0.06 at 18 deg, -0.09 to -0.10 at 20-21 deg', () => {
    // The wing strips' separated-flow normal force at 90 deg: Viterna & Corrigan 1.11 + 0.018 AR for the C172's AR 7.5.
    const c = prepareSection(NACA_2412, 3.1e6, 0.08, noFlap(), 1.11 + 0.018 * 7.48, 1, makeSectionCondition());
    const data: [number, number][] = [[12, -0.042], [16, -0.03], [18, -0.06], [20, -0.09], [21, -0.1]];
    for (const [a, cm] of data) {
      const m = stat(c, a).cm;
      console.log(`2412 R 3.1e6, ${a} deg: cm ${m.toFixed(3)} (data ${cm})`);
      // 0.02: the data are read off the published plot, and between 17 and 19 deg the measured moment falls by
      // ~0.03 per degree, so the 18 deg reading is the least certain.
      expect(Math.abs(m - cm)).toBeLessThan(0.02);
    }
  });
});

describe('control-surface large-deflection loss and the section angle of attack', () => {
  // Thin-aerofoil (Glauert) pressure recovery over the flap chord per unit alpha over that per unit delta, from 0.1
  // flap chord behind the hinge to 0.95 of the way to the trailing edge. Reference values from an 800-panel
  // discrete-vortex solution of the flapped plate (which also reproduces tau): 0.542 (cf 0.42), 0.524 (0.40),
  // 0.431 (0.30), 0.405 (0.26).
  it('couples alpha into the equivalent flap inclination by k = 0.54 (elevator), 0.52 (rudder), 0.41 (ailerons)', () => {
    const ref: [number, number][] = [[0.42, 0.542], [0.4, 0.524], [0.3, 0.431], [0.26, 0.405]];
    for (const [cf, k] of ref) {
      const got = flapAlphaCoupling(cf);
      console.log(`flap chord ${cf}: k ${got.toFixed(3)} (panel solution ${k})`);
      expect(Math.abs(got - k)).toBeLessThan(0.01);
    }
  });

  it('an elevator deflected up with the tail meeting the air from below keeps more effectiveness, but not all', () => {
    // 28 deg up at a tail angle of attack of +15 deg: equivalent inclination -28 + 0.54 * 15 = -20 deg.
    const m = makeFlapModel({ kind: 'plain', chordFraction: 0.42, viscousEffectiveness: 0.88 });
    const at = (alpha: number) => {
      const inc = noFlap();
      addFlapDeflection(m, -28 * DEG, inc, alpha * DEG);
      return inc.dAlpha0 / (m.tau * 0.88 * 28 * DEG);
    };
    const zero = at(0), loaded = at(15);
    console.log(`elevator -28 deg: effectiveness ${zero.toFixed(3)} at alpha 0, ${loaded.toFixed(3)} at alpha +15`);
    expect(loaded).toBeGreaterThan(zero);
    expect(loaded).toBeLessThan(0.85);
  });
});
