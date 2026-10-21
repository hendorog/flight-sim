// Hingeless rotor core (plan revision 2, section 4): the AR-280 reference and the fixture's 80 kt derivatives and modes
// (R18, R19). The reference module is ar280.ts (AGARD AR-280 Tables 6.2.8-6.2.13, P).
import { describe, expect, it } from 'vitest';
import { AR280_AFDD, AR280_DLR, AR280_MODES, eigenvalues, linearModel, modes } from './ar280';

describe('AR-280 reference (Tables 6.2.8-6.2.13, P): the derivative sets reproduce their own modes', () => {
  it('eigenvalue helper: a known 3x3 and a damped oscillator', () => {
    const e = eigenvalues([[2, 0, 0], [0, -1, 0], [0, 0, 5]]).map((x) => x.re).sort((a, b) => a - b);
    expect(e[0]).toBeCloseTo(-1, 12); expect(e[1]).toBeCloseTo(2, 12); expect(e[2]).toBeCloseTo(5, 12);
    const o = modes(eigenvalues([[0, 1], [-4, -0.8]])).oscillations[0];
    expect(o.omega).toBeCloseTo(2, 10); expect(o.zeta).toBeCloseTo(0.2, 10);
  });
  for (const [k, ref] of [[AR280_DLR, AR280_MODES.DLR], [AR280_AFDD, AR280_MODES.AFDD]] as const) {
    it(`${k.name}: state-matrix form (Ixz folded in) gives the Table 6.2.13 modes`, () => {
      const m = modes(eigenvalues(linearModel(k)));
      const [phugoid, dutch] = m.oscillations;
      const real = m.subsidences;
      // Roll mode, the two aperiodic pitch modes and the spiral: the four real roots.
      expect(real).toHaveLength(4);
      expect(Math.abs(real[3] / ref.roll - 1), `roll ${real[3]}`).toBeLessThan(0.02);
      expect(Math.abs(real[2] / ref.pitch[0] - 1), `pitch 1 ${real[2]}`).toBeLessThan(0.03);
      expect(Math.abs(real[1] / ref.pitch[1] - 1), `pitch 2 ${real[1]}`).toBeLessThan(0.1);
      expect(Math.abs(real[0] - ref.spiral), `spiral ${real[0]}`).toBeLessThan(0.015);
      expect(Math.abs(dutch.omega / ref.dutchRoll.omega - 1), `Dutch roll ${JSON.stringify(dutch)}`).toBeLessThan(0.03);
      expect(Math.abs(dutch.zeta - ref.dutchRoll.zeta)).toBeLessThan(0.02);
      expect(Math.abs(phugoid.omega / ref.phugoid.omega - 1), `phugoid ${JSON.stringify(phugoid)}`).toBeLessThan(0.05);
      expect(Math.abs(phugoid.zeta - ref.phugoid.zeta)).toBeLessThan(0.05);
    });
  }
  it('read as L/Ixx, N/Izz with the Ixz coupling outside, the DLR roll mode would be 9.8, not 8.49', () => {
    const k = AR280_DLR, Ixx = 1433, Izz = 4099, Ixz = 660, det = Ixx * Izz - Ixz * Ixz;
    const L = k.L.map((x, i) => (Izz * x * Ixx + Ixz * k.N[i] * Izz) / det);
    const N = k.N.map((x, i) => (Ixz * k.L[i] * Ixx + Ixx * x * Izz) / det);
    const real = modes(eigenvalues(linearModel({ ...k, L, N }))).subsidences;
    expect(Math.max(...real)).toBeGreaterThan(9.5);
  });
});
