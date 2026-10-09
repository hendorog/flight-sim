// POH 2-9 (3 Oct 2002). Read the flight-model tables; never maintain a second transcription here.
import { FT } from '../../core/math';
import type { PanelDef } from '../../instruments/panelDef';
import { R44_MAP, R44_VNE } from './limits';

type Placards = PanelDef['background']['placards'];
// Columns are individually positioned: the generic placard font is proportional, so padding a single
// string with spaces would misalign values. Positions/size are estimates within the frozen pedestal.
function columns(y: number, values: readonly (readonly (number | null)[])[], altitudeStep: number,
  temperatureMin: number, temperatureStep: number, format: (v: number | null) => string): Placards {
  return [
    { x: 366, y, size: 10, lines: ['ALT FT', ...values.map((_, i) => i ? String(Math.round(i * altitudeStep / FT)) : 'SL')] },
    ...values[0].map((_, j) => ({ x: 425 + 49 * j, y, size: 10,
      lines: [String(Math.round(temperatureMin - 273.15 + j * temperatureStep)), ...values.map(row => format(row[j]))] })),
  ];
}
export const R44_LIMIT_PLACARDS: Placards = [
  { x: 576, y: 1380, size: 10, lines: ['LIMIT MANIFOLD PRESSURE — IN HG', 'MAXIMUM CONTINUOUS POWER / OAT °C'] },
  ...columns(1417, R44_MAP.continuous, R44_MAP.altitudeStep, R44_MAP.temperatureMin, R44_MAP.temperatureStep,
    v => v === null ? 'FT' : v.toFixed(1)),
  { x: 576, y: 1533, size: 10, lines: [`FT = FULL THROTTLE / 5 MIN TAKEOFF: ADD ${R44_MAP.takeoffIncrease.toFixed(1)} IN HG`] },
  { x: 576, y: 1562, size: 10, lines: ['NEVER EXCEED SPEED — KIAS', '2200 LB TOGW AND BELOW / OAT °C'] },
  ...columns(1599, R44_VNE.kias, R44_VNE.altitudeStep, R44_VNE.temperatureMin, R44_VNE.temperatureStep,
    v => v === null || v === 0 ? 'NF' : String(v)),
  { x: 576, y: 1728, size: 10, lines: ['NF = NO FLIGHT / OVER 2200 LB: SUBTRACT 10 KIAS',
    'FOR AUTOROTATION: SUBTRACT 30 KIAS', '100 KIAS MAX: POWER ABOVE MCP OR ANY DOOR OFF'] },
];
