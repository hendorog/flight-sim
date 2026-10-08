import { clamp } from '../../core/math';

/** Uniform pressure-altitude/temperature placard grid. SI axes, KIAS cells; zero means no flight. */
export interface SpeedPlacard {
  altitudeStep: number; temperatureMin: number; temperatureStep: number;
  kias: readonly (readonly number[])[];
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
