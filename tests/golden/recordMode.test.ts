// The per-record switch of the golden helper (tests/golden/golden.ts): FS_GOLDEN_EXACT=1 compares the C172S
// records exactly, and a record built with `{ exact: false }` (a Stage D type's) at the tolerance.

import { describe, expect, it } from 'vitest';
import { compareExact, compareSections, comparisonMode, type GoldenSection } from './golden';

describe('golden comparison mode per record', () => {
  it('an exact run compares a record exactly unless it opts out', () => {
    expect(comparisonMode(true)).toBe('exact');
    expect(comparisonMode(true, {})).toBe('exact');
    expect(comparisonMode(true, { exact: true })).toBe('exact');
    expect(comparisonMode(true, { exact: false })).toBe('tolerance');
  });

  it('a run without FS_GOLDEN_EXACT compares every record at the tolerance', () => {
    expect(comparisonMode(false)).toBe('tolerance');
    expect(comparisonMode(false, { exact: true })).toBe('tolerance');
    expect(comparisonMode(false, { exact: false })).toBe('tolerance');
  });

  it('a one-ulp change fails only the record compared exactly', () => {
    const stored: GoldenSection = { a: 1.7, b: true };
    const actual: GoldenSection = { a: 0.9 + 0.8, b: true };
    const check = (mode: 'exact' | 'tolerance') => (mode === 'exact' ? compareExact(actual, stored).differing : compareSections(actual, stored).length);
    expect(check(comparisonMode(true))).toBe(1);
    expect(check(comparisonMode(true, { exact: false }))).toBe(0);
  });
});
