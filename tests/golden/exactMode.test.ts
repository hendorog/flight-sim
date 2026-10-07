// The comparison rules of the golden helper itself (tests/golden/golden.ts): what the tolerance mode lets
// through and the exact mode (FS_GOLDEN_EXACT=1) does not, and the one-line summary a record prints.

import { describe, expect, it } from 'vitest';
import { compareExact, compareSections, exactSummary, type GoldenSection } from './golden';

describe('golden comparison rules', () => {
  const stored: GoldenSection = { a: 1.7, b: 0, c: true, d: 'NaN', e: -2.5e-7, f: 'hold' };

  it('exact: identical values pass, and a run-time -0 equals a stored 0', () => {
    const x = compareExact({ a: 1.7, b: -0, c: true, d: 'NaN', e: -2.5e-7, f: 'hold' }, stored);
    expect(x.differing).toBe(0);
    expect(x.total).toBe(6);
    expect(exactSummary('file/section', x, stored, stored)).toBe('[golden-exact] file/section: 0 of 6 values not identical');
  });

  it('exact: a one-ulp change fails where the tolerance mode passes', () => {
    const actual: GoldenSection = { ...stored, a: 0.9 + 0.8, e: -2.5e-7 * (1 + 4e-16) };
    expect(actual.a).not.toBe(1.7);
    expect(compareSections(actual, stored)).toEqual([]);
    const x = compareExact(actual, stored);
    expect(x.differing).toBe(2);
    expect(x.worstKey).toBe('e');
    expect(x.worstRelative).toBeGreaterThan(0);
    expect(x.worstRelative).toBeLessThan(1e-15);
    expect(exactSummary('file/section', x, actual, stored)).toMatch(/^\[golden-exact\] file\/section: 2 of 6 values not identical; worst e: .* \(golden -2\.5e-7\), relative \d\.\d\de-16, absolute /);
  });

  it('exact: booleans, strings, missing and extra keys count as not identical', () => {
    const x = compareExact({ a: 1.7, b: 0, c: false, d: 'Infinity', f: 'hold', g: 3 }, stored);
    // c, d differ; e is missing; g is extra.
    expect(x.differing).toBe(4);
    expect(x.total).toBe(7);
    expect(x.worstKey).toBe('c');
    expect(x.problems).toContain('in the golden but not recorded: e');
    expect(x.problems).toContain('recorded but not in the golden: g');
  });

  it('exact: a number against a stored non-finite name is a difference', () => {
    expect(compareExact({ d: 1 }, { d: 'NaN' }).differing).toBe(1);
  });
});
