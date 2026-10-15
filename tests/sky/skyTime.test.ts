import { describe, expect, it } from 'vitest';
import { SKY_DAYS_IN_YEAR, SKY_EPOCH_YEAR, skyDateLabel, skyDaysSinceJ2000, skyJulianDate } from '../../src/render/sky/skyTime';

describe('sky calendar', () => {
  it('maps day 1, 0h to 1 January of the epoch year', () => {
    const ms = Date.UTC(SKY_EPOCH_YEAR, 0, 1);
    expect(skyJulianDate(1, 0)).toBeCloseTo(ms / 86400000 + 2440587.5, 9);
  });
  it('day 172 is 20 June 2016 (leap year) and counts days from J2000', () => {
    const ms = Date.UTC(2016, 5, 20, 12);
    expect(skyJulianDate(172, 12)).toBeCloseTo(ms / 86400000 + 2440587.5, 9);
    expect(skyDaysSinceJ2000(172, 12)).toBeCloseTo(skyJulianDate(172, 12) - 2451545, 9);
  });
  it('the calendar spans the whole leap year: 29 February and 31 December are reachable', () => {
    expect(SKY_DAYS_IN_YEAR).toBe(366);
    const ms = (d: number): number => Date.UTC(SKY_EPOCH_YEAR + 1, 0, 1) - Date.UTC(SKY_EPOCH_YEAR, 0, d);
    expect(ms(SKY_DAYS_IN_YEAR + 1)).toBe(0);
    expect(skyDateLabel(1)).toBe('1 Jan');
    expect(skyDateLabel(60)).toBe('29 Feb');
    expect(skyDateLabel(172)).toBe('20 Jun');
    expect(skyDateLabel(SKY_DAYS_IN_YEAR)).toBe('31 Dec');
  });
});
