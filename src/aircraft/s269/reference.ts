// Published RFM CSP-C1-1 (16 Jan 2019), 1-8..1-11, 2-3/2-6/2-7, 5-1.
// Selected installation: carburetted 300CB, S/N 0106–0138, single 33 US gal tank, standard right PIC.
import { HP, LB } from '../../core/math';
export const S269_REFERENCE = {
  // These are conversion references for the placeholder percent tach, not a Schweizer percent dial.
  engineRpm100: 2700, rotorRpm100: 471,
  continuousPower: 180 * HP, takeoffPower: 180 * HP,
  mainUsableGal: 32.5, kgPerGal: 6 * LB,
  vne: 94, doorsOffVne: 90, vy: 41, autorotationKias: 52,
  rotorPowerOn: [442, 471], rotorPowerOff: [390, 504],
} as const;
