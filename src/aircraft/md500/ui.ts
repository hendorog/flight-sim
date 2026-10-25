// MD 500E: HUD levers, readouts and hints. Simulator control reference, not a checklist (those are on F). Facts:
// RFM CSP-E-1 Rev 16 4-2..4-4 (start), 2-5 (limits), 3-14 (governor failure). Keys: F5 / F6 collective; F1 / F2 / F3 twist grip
// (F1 stops at GROUND IDLE); ; and ' are the N2 INC / DEC beep switch on the collective head (turbine-core / T1b wiring).
import type { AircraftState, ControlInputs } from '../../core/types';
import type { UiProfile } from '../types';
import { MD500_N2_PCT, MD500_N1_PCT, md500TorquePsi } from './facts';

const onOff = (v: boolean | undefined): string => v ? 'ON' : 'OFF';
const GRIP_TEXT = { cutoff: 'CUTOFF', groundIdle: 'IDLE', between: 'BETWEEN', fullOpen: 'FLY' } as const;
const gripText = (c: ControlInputs, s: AircraftState): string => {
  const t = s.rotorcraft?.turboshaft;
  const base = t ? GRIP_TEXT[t.grip] : `${Math.round(c.throttle * 100)}%`;
  return t && t.governorMode === 'manual' ? `${base} (MANUAL)` : base;
};
/** Percent N2 at which the beep set point sits, as 0..1 across the 97.5 - 104.5 % beep range (display only). */
const setFraction = (s: AircraftState): number => {
  const set = s.rotorcraft?.turboshaft?.n2SetPct ?? MD500_N2_PCT.setTakeoff;
  return Math.min(1, Math.max(0, (set - 97.5) / (104.5 - 97.5)));
};
export const MD500_UI: UiProfile = {
  controlName: 'stick',
  startupSteps: [
    ['Before start', 'Collective full down (F5), cyclic about 1/3 forward of full aft and centred (5), twist grip at CUTOFF, GEN OFF, fuel valve IN'],
    ['Electrical', 'Click BAT. ENGINE OUT, XMSN OIL PRESS and GEN OUT are lit until the engine runs; press PRESS TO TEST to check every lens'],
    ['Start', 'Hold START (S, or the console START). At 12 – 15 % N1 roll the grip to GROUND IDLE (F1, or F3 from CUTOFF with the idle release). Watch TOT'],
    ['Abort start if', 'no TOT rise, no oil pressure, the rotor is not turning by 25 % N1, or the ammeter reads zero or positive (RFM 4-3)'],
    ['Release START', 'At 58 – 60 % N1. Idle is 64 – 65 % N1. XMSN OIL PRESS goes out within 30 s; press RE-IGN P RST, then switch GEN ON'],
    ['Run-up', 'Grip FULL OPEN (F3). N2 and Nr needles must lie on each other at 102 – 103 %; the beep switch (; / \') sets 98 % or less to 104 – 105 %'],
    ['Shutdown', 'Ground idle 2 minutes, then CUTOFF: the needles split with Nr lagging, ENGINE OUT lights at 55 % N1'],
  ],
  starterAdvice(c) {
    if (!c.masterBattery) return 'BAT is OFF. Click BAT on the console.';
    if (c.fuelSelector === 'off') return 'The fuel valve is pulled (closed). Push the FUEL VALVE knob in, or Shift+J.';
    if ((c.collective ?? 0) > 0.02) return 'Lower the collective (F5) before starting.';
    return 'Hold START; roll the grip to GROUND IDLE at 12–15 % N1; release at 58–60 %';
  },
  switches: [
    { id: 'masterBattery', label: 'Battery', read: c => onOff(c.masterBattery) },
    { id: 'alternator', label: 'Generator', read: c => onOff(c.alternator) },
    { id: 'fuelPump', label: 'Start pump', read: c => onOff(c.fuelPump) },
    { id: 'fuelSelector', label: 'Fuel valve', read: c => c.fuelSelector === 'off' ? 'CLOSED' : 'OPEN' },
    { id: 'rotorGovernor', label: 'N2 governor', read: c => c.rotorGovernor === false ? 'FAILED' : 'ON' },
    { id: 'magnetos', label: 'Ignition', read: c => c.magnetos ? 'ON' : 'AUTO' },
    { id: 'avionics', label: 'Radios', read: c => onOff(c.avionics) },
    { id: 'nav', label: 'Position lights', read: c => onOff(c.lights.nav) },
    { id: 'beacon', label: 'Anti-collision', read: c => onOff(c.lights.beacon) },
    { id: 'landing', label: 'Landing light', read: c => onOff(c.lights.landing) },
  ],
  hud: { levers: [
    { label: 'COLL', read: c => c.collective ?? 0 },
    { label: 'GRIP', read: c => c.throttle, text: gripText },
    { label: 'N2 SET', read: (_c, s) => setFraction(s), style: 'marker',
      text: (_c, s) => `${(s.rotorcraft?.turboshaft?.n2SetPct ?? MD500_N2_PCT.setTakeoff).toFixed(1)}%` },
  ], readouts: [
    { label: 'N1', text: s => `${(s.engine.ng ?? 0).toFixed(1)}%${(s.engine.ng ?? 0) > MD500_N1_PCT.continuous ? ' HIGH' : ''}` },
    { label: 'TOT', text: s => `${(s.engine.itt ?? 0).toFixed(0)} °C${s.rotorcraft?.turboshaft?.overTemp ? ' LIMIT' : ''}` },
    { label: 'TQ', text: s => `${md500TorquePsi(s.engine.torque).toFixed(0)} psi${s.rotorcraft?.turboshaft?.overTorque ? ' LIMIT' : ''}` },
    { label: 'N2/NR', text: s => {
      const t = s.rotorcraft?.turboshaft;
      return t ? `${t.n2Pct.toFixed(0)} / ${t.nrPct.toFixed(0)}%${t.needlesSplit ? ' SPLIT' : ''}${t.engineOutLight ? ' ENG OUT' : ''}` : '—';
    } },
    { label: 'VNE', text: s => s.rotorcraft ? (s.rotorcraft.vneKias === 0 ? 'NO FLIGHT' :
      `${s.rotorcraft.vneKias.toFixed(0)} KIAS${s.rotorcraft.airspeedLimitExceeded ? ' EXCEEDED' : ''}`) : '—' },
    { label: 'BUS', text: s => `${s.electrical.busVoltage.toFixed(1)} V` },
    { label: 'OAT', text: s => `${(s.oat - 273.15).toFixed(0)} °C` },
  ] },
  hints: [
    ['Cyclic / pedals', 'Arrow keys / Z, X; 5 centres. Trim: Home / End and 6 / 7 (spring trim, as the RFM trim switch)'],
    ['Collective', 'F5 / F6 down / up. The twist grip and N2 beep switch are on the collective head'],
    ['Twist grip', 'F2 / F3 close / open; F1 stops at GROUND IDLE. Below full open the N2 governor is out and you hold 102 – 103 % yourself (RFM 3-14)'],
    ['N2 beep', '; lowers and \' raises the governor set point (98 % or less to 104 – 105 %). Take-off 103 %'],
    ['Start', 'Hold S (the console START is the same button). The igniter fires with the starter; no magnetos'],
    ['Warning lenses', 'ENGINE OUT lights below 55 % N1 or Nr 468 rpm (the horn needs the GEN switch ON). Press RE-IGN P RST to reset it'],
    ['Needles', 'In powered flight N2 and Nr lie on each other; they split in autorotation and at shutdown (freewheel)'],
    ['Limits', 'Torque 81.3 psi continuous (74.3 above 738 °C TOT), 87.2 for 5 min; TOT 755 / 810; N1 105 %'],
  ],
};
