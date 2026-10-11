// RFM 2-2: retain the printed orientation/columns, including dashes. The flight worker owns the grid.
import { FT } from '../../core/math';
import type { PanelDef } from '../../instruments/panelDef';
import { S269_VNE } from './limits';
import { S269_REFERENCE as V } from './reference';

const d = S269_VNE;
const altitudes = [0, 4000, 6000, 8000, 10000, 12000];
export const S269_VNE_PLACARDS: PanelDef['background']['placards'] = [
  { x: 858, y: 672, size: 15, lines: ['VNE KNOTS IAS'] },
  { x: 858, y: 699, size: 10, lines: ['PRESSURE ALTITUDE × 1000 FT'] },
  { x: 682, y: 722, size: 12, lines: ['OAT °F', ...d.kias[0].map((_, j) =>
    String(Math.round((d.temperatureMin + j * d.temperatureStep - 273.15) * 9 / 5 + 32)))] },
  ...altitudes.map((ft, i) => ({ x: 736 + i * 48, y: 722, size: 12,
    lines: [String(ft / 1000), ...d.kias[Math.round(ft * FT / d.altitudeStep)].map(v => v === 0 ? '—' : String(v))] })),
  { x: 858, y: 883, size: 11, lines: [`MAX VNE DOORS OFF ${V.doorsOffVne} KTS IAS`, '— = NO FLIGHT'] },
];
