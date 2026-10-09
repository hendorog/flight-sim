import { clamp } from '../../core/math';

/** Uniform pressure-altitude/temperature placard grid. SI axes, KIAS cells; zero means no flight. */
export interface SpeedPlacard {
  altitudeStep: number; temperatureMin: number; temperatureStep: number;
  kias: readonly (readonly number[])[];
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
  const row = clamp(altitude / d.altitudeStep, 0, rows);
  const col = clamp((temperature - d.temperatureMin) / d.temperatureStep, 0, cols);
  const i = Math.min(rows - 1, Math.floor(row)), j = Math.min(cols - 1, Math.floor(col));
  if (row === rows && d.continuous[rows][Math.floor(col)] === null) return Infinity;
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
  const a = row - i, b = col - j;
  return cell(i,j)*(1-a)*(1-b) + cell(i+1,j)*a*(1-b) + cell(i,j+1)*(1-a)*b + cell(i+1,j+1)*a*b;
}
export function placardVne(d: SpeedPlacard, pressureAltitude: number, temperature: number): number {
  const rows = d.kias.length - 1, cols = d.kias[0].length - 1;
  if (pressureAltitude > rows * d.altitudeStep || temperature < d.temperatureMin ||
    temperature > d.temperatureMin + cols * d.temperatureStep) return 0;
  const row = clamp(pressureAltitude / d.altitudeStep, 0, rows);
  const col = clamp((temperature - d.temperatureMin) / d.temperatureStep, 0, cols);
  const i = Math.min(rows - 1, Math.floor(row)), j = Math.min(cols - 1, Math.floor(col));
  const a = row - i, b = col - j;
  const cells = [[d.kias[i][j], (1-a)*(1-b)], [d.kias[i+1][j], a*(1-b)],
    [d.kias[i][j+1], (1-a)*b], [d.kias[i+1][j+1], a*b]];
  if (cells.some(([v, w]) => v === 0 && w > 1e-10)) return 0;
  return cells.reduce((sum, [v, w]) => sum + v*w, 0);
}
