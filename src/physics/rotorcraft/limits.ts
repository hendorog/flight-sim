import { clamp } from '../../core/math';

/** Uniform pressure-altitude/temperature placard grid. SI axes, KIAS cells; zero means no flight. */
export interface SpeedPlacard {
  altitudeStep: number; temperatureMin: number; temperatureStep: number;
  kias: readonly (readonly number[])[];
  /** Non-uniform temperature axis, K, ascending (one per column); overrides temperatureMin/Step. Absent: uniform. */
  temperatures?: readonly number[];
  /** Heavier placards (MD 500E Fig 2-6): the last band whose aboveMass the take-off mass exceeds replaces kias. kg. */
  massBands?: readonly { aboveMass: number; kias: readonly (readonly number[])[] }[];
}
/** Configuration corrections to a base speed grid. Mass in kg, speeds/reductions in KIAS. */
export interface SpeedCorrections {
  heavyMass: number; heavyReduction: number; powerOffReduction: number; highPowerCap: number; doorsOffCap: number;
  /**
   * Autorotation floor per placard (base kias, then each mass band): powerOff Vne = min(chart, max(chart -
   * powerOffReduction, floor), powerOffCap) (MD 500E Fig 2-6: "reduce speed by 22 K (85/90/95 K min); do not exceed
   * chart Vne"; RFM 2-2: 130 KIAS maximum). Absent: the legacy chart - reduction.
   */
  powerOffFloor?: readonly number[];
  powerOffCap?: number;
}
export interface SpeedConfiguration {
  takeoffMass: number; powerOff?: boolean; aboveMcp?: boolean; doorsOff?: boolean;
}
export function configuredVne(d: SpeedPlacard, corrections: SpeedCorrections | undefined,
  altitude: number, temperature: number, c: SpeedConfiguration): number {
  const base = placardVne(d, altitude, temperature, c.takeoffMass);
  if (!corrections || base === 0) return base;
  if (c.powerOff && corrections.powerOffFloor) {
    const floor = corrections.powerOffFloor[placardBand(d, c.takeoffMass)] ?? 0;
    return Math.max(0, Math.min(base, Math.max(base - corrections.powerOffReduction, floor),
      corrections.powerOffCap ?? Infinity, c.doorsOff ? corrections.doorsOffCap : Infinity));
  }
  const reduction = c.powerOff ? corrections.powerOffReduction : c.takeoffMass > corrections.heavyMass ? corrections.heavyReduction : 0;
  return Math.max(0, Math.min(base - reduction, c.aboveMcp ? corrections.highPowerCap : Infinity,
    c.doorsOff ? corrections.doorsOffCap : Infinity));
}
/** MCP grid in inHg. Null means full throttle; the adjacent finite trend supplies interpolation
 * below that cell, where a MAP limitation still exists. Above the chart, use the last row. */
export interface ManifoldPlacard {
  altitudeStep: number; temperatureMin: number; temperatureStep: number;
  continuous: readonly (readonly (number | null)[])[];
  takeoffIncrease: number;
}
export function placardMap(d: ManifoldPlacard, altitude: number, temperature: number): number {
  const rows = d.continuous.length - 1, cols = d.continuous[0].length - 1;
  const snap = (v: number): number => Math.abs(v - Math.round(v)) < 1e-12 ? Math.round(v) : v;
  const row = snap(clamp(altitude / d.altitudeStep, 0, rows));
  const col = snap(clamp((temperature - d.temperatureMin) / d.temperatureStep, 0, cols));
  const i = Math.min(rows - 1, Math.floor(row)), j = Math.min(cols - 1, Math.floor(col));
  const a = row - i, b = col - j;
  // Only contributing corners count: an exact full-throttle cell (including interior null cells)
  // has no MAP restriction. Mixed corners retain the finite altitude trend below the FT region.
  const corners = [[i, j, (1-a)*(1-b)], [i+1, j, a*(1-b)], [i, j+1, (1-a)*b], [i+1, j+1, a*b]];
  if (corners.every(([r, c, w]) => w < 1e-10 || d.continuous[r][c] === null)) return Infinity;
  const cell = (r: number, c: number): number => {
    const v = d.continuous[r][c];
    if (v !== null) return v;
    // Continue the altitude trend only for interpolation toward a full-throttle corner.
    let last = r - 1;
    while (last >= 0 && d.continuous[last][c] === null) last--;
    if (last < 0) return Infinity;
    const value = d.continuous[last][c]!;
    if (last === 0) return value;
    return value + (r - last) * (value - d.continuous[last - 1][c]!);
  };
  return corners.reduce((sum, [r, c, w]) => w < 1e-10 ? sum : sum + cell(r, c) * w, 0);
}
/** Index of the placard a take-off mass selects: 0 the base kias, k the k-th mass band. */
export function placardBand(d: SpeedPlacard, mass = 0): number {
  let band = 0;
  d.massBands?.forEach((b, i) => { if (mass > b.aboveMass) band = i + 1; });
  return band;
}
export function placardVne(d: SpeedPlacard, pressureAltitude: number, temperature: number, mass?: number): number {
  const band = d.massBands && mass !== undefined ? placardBand(d, mass) : 0;
  const kias = band > 0 ? d.massBands![band - 1].kias : d.kias;
  const rows = kias.length - 1, cols = kias[0].length - 1;
  const t = d.temperatures;
  if (pressureAltitude > rows * d.altitudeStep || (t ? temperature < t[0] || temperature > t[cols] :
    temperature < d.temperatureMin || temperature > d.temperatureMin + cols * d.temperatureStep)) return 0;
  const row = clamp(pressureAltitude / d.altitudeStep, 0, rows);
  let col: number;
  if (t) {
    let k = 0;
    while (k < cols - 1 && temperature > t[k + 1]) k++;
    col = k + clamp((temperature - t[k]) / (t[k + 1] - t[k]), 0, 1);
  } else col = clamp((temperature - d.temperatureMin) / d.temperatureStep, 0, cols);
  const i = Math.min(rows - 1, Math.floor(row)), j = Math.min(cols - 1, Math.floor(col));
  const a = row - i, b = col - j;
  const cells = [[kias[i][j], (1-a)*(1-b)], [kias[i+1][j], a*(1-b)],
    [kias[i][j+1], (1-a)*b], [kias[i+1][j+1], a*b]];
  if (cells.some(([v, w]) => v === 0 && w > 1e-10)) return 0;
  return cells.reduce((sum, [v, w]) => sum + v*w, 0);
}
