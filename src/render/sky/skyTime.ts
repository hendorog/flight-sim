// The sky's calendar: which absolute instant a (dayOfYear, timeOfDay) of WeatherSettings stands for, for the
// ephemerides of the Moon (celestial.ts) and the planets (planets.ts). Shared by both packages of the night-sky
// plan; frozen by the scaffold.
//
// WeatherSettings has no year, so the sky uses one fixed year, SKY_EPOCH_YEAR. 2016 is chosen because its Moon is
// full on day 172 (2016-06-20, full Moon at 11:02 UT), which keeps the full Moon the default scenario's date has
// always had (celestial.ts LUNAR_EPOCH_OFFSET_DAYS anchored it there), and because the planets of June 2016 are a
// good show: Mars just past a bright opposition and Saturn both near Antares above the Milky Way's core, Jupiter
// in Leo in the evening. 2016 is a leap year: day 172 is 20 June (the menu's calendar labels follow this year).
//
// timeOfDay is local solar time at the airfield, and the sun (core/world.ts sunDirectionNED) is placed from it
// alone. The ephemerides treat it as UT, i.e. the airfield sits at longitude 0: only the Earth's rotation
// relative to the sun matters to the sky, and celestial.ts derives the local sidereal time from the sun.

/** The fixed year of the sky's ephemerides (see the header). */
export const SKY_EPOCH_YEAR = 2016;

/** Julian Date of 0h UT on 1 January of SKY_EPOCH_YEAR (2016-01-01T00:00Z). */
export const SKY_EPOCH_JD = 2457388.5;

/** Julian Date for day `dayOfYear` (1 = 1 January) of SKY_EPOCH_YEAR at `timeOfDay` hours UT (see the header). */
export function skyJulianDate(dayOfYear: number, timeOfDay: number): number {
  return SKY_EPOCH_JD + (dayOfYear - 1) + timeOfDay / 24;
}

/** Days since J2000.0 (2000-01-01T12:00 TT, JD 2451545.0; TT - UT ignored) for the same instant. */
export function skyDaysSinceJ2000(dayOfYear: number, timeOfDay: number): number {
  return skyJulianDate(dayOfYear, timeOfDay) - 2451545.0;
}
