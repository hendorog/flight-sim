import { describe, expect, it } from 'vitest';
import { blackbodyRgb, bvToTemperature, decodeStarCatalog, starColour, starIndexByHR } from '../../src/render/sky/starCatalog';

// No @types/node in this project: load node:fs dynamically (as tests/aero does).
interface Fs {
  readFileSync(path: URL): Uint8Array;
}
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as Fs;
const bytes = fs.readFileSync(new URL('../../public/sky/stars/bsc5.bin', import.meta.url));
const cat = decodeStarCatalog(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
const DEG = 180 / Math.PI;

function star(hr: number): { ra: number; dec: number; vmag: number; bv: number } {
  const i = starIndexByHR(cat, hr);
  expect(i, `HR ${hr}`).toBeGreaterThanOrEqual(0);
  return { ra: cat.ra[i] * DEG, dec: cat.dec[i] * DEG, vmag: cat.vmag[i], bv: cat.bv[i] };
}

describe('Bright Star Catalogue (bsc5.bin)', () => {
  it('holds the 9096 stars of BSC5 in HR order', () => {
    expect(cat.count).toBeGreaterThanOrEqual(9000);
    expect(cat.count).toBeLessThanOrEqual(9110);
    expect(cat.count).toBe(9096);
    for (let i = 1; i < cat.count; i++) expect(cat.hr[i]).toBeGreaterThan(cat.hr[i - 1]);
  });

  it('decodes Sirius (HR 2491) and Polaris (HR 424)', () => {
    const sirius = star(2491);
    expect(sirius.vmag).toBeCloseTo(-1.46, 5);
    expect(Math.abs(sirius.ra - 101.29)).toBeLessThan(0.01);
    expect(Math.abs(sirius.dec - -16.72)).toBeLessThan(0.01);
    expect(sirius.bv).toBeCloseTo(0.0, 2);
    const polaris = star(424);
    expect(Math.abs(polaris.dec - 89.26)).toBeLessThan(0.01);
  });

  it('marks HR numbers without data as absent', () => {
    // HR 92 is one of the 14 retained non-stellar entries (no position).
    expect(starIndexByHR(cat, 92)).toBe(-1);
    expect(starIndexByHR(cat, 9110)).toBeGreaterThan(9000);
  });

  it('rejects a file that is not one', () => {
    expect(() => decodeStarCatalog(new ArrayBuffer(16))).toThrow();
  });
});

describe('star colours', () => {
  it('B-V to temperature (Ballesteros): the Sun ~5800 K, Vega ~10 000 K, Betelgeuse ~3600 K', () => {
    expect(bvToTemperature(0.65)).toBeGreaterThan(5600);
    expect(bvToTemperature(0.65)).toBeLessThan(6000);
    expect(bvToTemperature(0.0)).toBeGreaterThan(9500);
    expect(bvToTemperature(1.85)).toBeLessThan(3800);
  });

  it('blackbody colours have luminance 1, red when cool and blue when hot', () => {
    for (const t of [2000, 3500, 5800, 10000, 30000]) {
      const c = blackbodyRgb(t);
      expect(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]).toBeCloseTo(1, 6);
    }
    const cool = blackbodyRgb(3500);
    const hot = blackbodyRgb(20000);
    expect(cool[0]).toBeGreaterThan(cool[2]);
    expect(hot[2]).toBeGreaterThan(hot[0]);
    // ~6500 K is near the D65 white.
    const w = blackbodyRgb(6500);
    expect(Math.max(...w) - Math.min(...w)).toBeLessThan(0.1);
  });

  it('displayed colours keep luminance 1 and are white without a B-V', () => {
    const c = starColour(1.85);
    expect(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]).toBeCloseTo(1, 6);
    expect(c[0]).toBeGreaterThan(c[2]);
    expect(starColour(NaN)).toEqual([1, 1, 1]);
  });
});
