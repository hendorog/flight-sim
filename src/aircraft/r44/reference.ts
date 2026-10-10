// Published Raven II references, POH 1-4..1-6 and 2-2/2-6/2-7. See docs/r44-sources.md.
import { HP, LB } from '../../core/math';
export const R44_REFERENCE = {
  engineRpm100: 2665, rotorRpm100: 400,
  continuousPower: 205 * HP, takeoffPower: 245 * HP,
  mainUsableGal: 29.5, auxUsableGal: 17.0, kgPerGal: 6 * LB,
  vne: 130, asiGreenMin: 0, asiGreenMax: 110,
} as const;
