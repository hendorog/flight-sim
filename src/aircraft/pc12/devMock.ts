// Pilatus PC-12/47: extra mock readings for the dev instruments page (src/dev/instruments.ts loads every
// src/aircraft/<id>/devMock.ts and calls the one of the selected type after the generic mock flight). The generic
// mock flight scripts a piston engine; this writes the turboprop's figures for the EIS: torque (as the POWER-TURBINE
// torque EngineState.torque holds, so pc12TorquePsi gives the psi on the dial), ITT, Ng, Np, the second generator, and
// the power lever aft of the gate (URL `reverse=0..1`, with the blades marked as in beta). Nothing here is a model: the
// numbers are a plausible power setting for the throttle the mock flight scripts (take-off 44 psi, cruise about 31),
// the readings of an engine whose power lever is IDLE through the cold start, run-up and engine failure.
import type { DevMock } from '../../dev/devMock';
import { PC12_GEAR_RATIO, PC12_PSI_PER_NM, PC12_NP_GOVERNED, PC12_TORQUE_PSI } from './facts';

const reverseParam = (): number => {
  if (typeof location === 'undefined') return 0;
  const v = Number(new URLSearchParams(location.search).get('reverse') ?? 0);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
};
/** Power-turbine N m that reads `psi` on the torque gauge. */
const ptNm = (psi: number): number => psi / (PC12_GEAR_RATIO * PC12_PSI_PER_NM);

export const devMock: DevMock = (s, c, t) => {
  const e = s.engines[0];
  const reverse = reverseParam();
  c.reverse = reverse;
  const running = e.running && e.rpm > 300;
  const p = reverse > 0 ? 0 : c.throttle;
  if (!running) {
    e.ng = 0;
    e.itt = t > 4.5 && t < 6 ? 300 : 20;
    e.torque = 0;
    e.propRpm = 0;
    s.propellers[0].rpm = 0;
    s.propellers[0].beta = false;
    s.electrical.alternators[0] = 0;
    s.electrical.alternators[1] = 0;
    return;
  }
  // Ground idle 55 % Ng, take-off about 99 %; ITT 460 at idle to 790 at take-off; torque from 4 psi at idle.
  const reversePsi = reverse * 34.25;
  const psi = reverse > 0 ? reversePsi : 4 + (PC12_TORQUE_PSI.takeoff - 4) * p ** 1.2;
  e.ng = reverse > 0 ? 55 + 40 * reverse : 55 + 44 * p;
  e.itt = reverse > 0 ? 460 + 300 * reverse : 460 + 330 * p;
  e.torque = ptNm(psi);
  e.propRpm = reverse > 0 ? 1650 * Math.min(1, 0.6 + reverse) : p < 0.1 && s.onGround ? 1060 : PC12_NP_GOVERNED;
  s.propellers[0].rpm = e.propRpm;
  s.propellers[0].beta = reverse > 0 || (p < 0.1 && s.onGround);
  e.oilPressure = 88;
  e.oilTemp = 62;
  e.fuelFlow = ((180 + 340 * p) * 0.45359237) / 3600; // kg/s from lb/h
  s.electrical.alternators[0] = 60 + 140 * p;
  s.electrical.alternators[1] = 12;
};
