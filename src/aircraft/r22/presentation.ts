import type { AircraftPresentation, UiProfile } from '../types';
import { C152_PRESENTATION } from '../c152/presentation';
import { HP } from '../../core/math';
import { R22_ROTORCRAFT } from './rotorcraft';
import { R22_VISUAL } from './visual';

export const R22_UI: UiProfile = {
  controlName: 'stick',
  startupSteps: [ ['Collective', 'F5 fully down'], ['Fuel and mixture', 'Fuel ON; Shift+M full rich'],
    ['Master and ignition', 'W on; 4 BOTH'], ['Throttle and starter', 'F3 a little; hold S'],
    ['Clutch and governor', 'Insert engage clutch; Delete enable governor; F4 throttle full'],
    ['Lift', 'Wait for NR near 530 RPM, then ease F6 collective up; trim cyclic and pedals'] ],
  starterAdvice: C152_PRESENTATION.ui.starterAdvice,
  switches: [...C152_PRESENTATION.ui.switches,
    { id: 'rotorClutch', label: 'Rotor clutch', read: c => c.rotorClutch ? 'ENGAGED' : 'DISENGAGED' },
    { id: 'rotorGovernor', label: 'Rotor governor', read: c => c.rotorGovernor ? 'ON' : 'OFF' }],
  hud: { levers: [
    { label: 'COLL', read: c => c.collective ?? 0 }, { label: 'THR', read: c => c.throttle },
    { label: 'MIX', read: c => c.mixture, style: 'mixture' },
  ], readouts: [
    { label: 'NR', text: s => `${Math.round(s.rotorcraft?.rotorRpm ?? 0)}${s.rotorcraft?.lowRpm ? ' LOW' : ''}` },
    { label: 'RPM', text: s => `${Math.round(s.engine.rpm)}` },
    { label: 'MP', text: s => s.engine.manifoldPressure.toFixed(1) },
  ] },
  hints: [['Cyclic / pedals', 'Arrow keys / Z, X'], ['Collective down / up', 'Hold F5 / F6'],
    ['Clutch / governor', 'Insert / Delete'], ['Flight model', 'Experimental R22; autopilot unavailable']],
};
const checklists = { ...C152_PRESENTATION.training.checklists };
for (const id of Object.keys(checklists) as (keyof typeof checklists)[])
  checklists[id] = { ...checklists[id], items: [] };

export const R22_PRESENTATION: AircraftPresentation = {
  ...C152_PRESENTATION, id: 'r22', visual: R22_VISUAL, ui: R22_UI,
  instrumentSystems: { ...C152_PRESENTATION.instrumentSystems, busDeadVolts: 10,
    lamps: [{ id: 'lowVolts', lit: i => i.state.electrical.busVoltage > 10 && i.state.electrical.busVoltage < 12.5 }] },
  audio: { ...C152_PRESENTATION.audio, flapMotor: false, busPoweredV: 10,
    stallWarner: { kind: 'electric', baseHz: 800, sweepHz: 0, needsBus: true },
    engines: [{ engine: { ...C152_PRESENTATION.audio.engines[0].engine, ratedPowerW: 131 * HP,
      gearRatio: R22_ROTORCRAFT.engineRatio },
      prop: { blades: 2, diameterM: R22_ROTORCRAFT.main.radius * 2, cruiseThrustN: 6000, level: 1 } }] },
  panel: { ...C152_PRESENTATION.panel, id: 'r22',
    gauges: C152_PRESENTATION.panel.gauges.filter(g => g.kind !== 'flapLever' && g.kind !== 'trimBar').map(g => g.kind === 'asi'
      ? { ...g, marks: { ...g.marks, arcs: [{ from: 0, to: 102, color: 'green' }], redLine: 102 } } : g) },
  // Legacy training schema requires airplane fields. No R22 lessons or checklists are published.
  training: { ...C152_PRESENTATION.training, id: 'r22', icaoType: 'R22',
    name: 'Robinson R22 Beta II (experimental)', registration: 'N22FS', registrations: undefined,
    systems: undefined, controls: undefined, flapDetentsDeg: [0], flapLeverForDeg: { 0: 0 },
    vspeeds: { ...C152_PRESENTATION.training.vspeeds, Vs0: 0, Vs1: 0, Vr: 0, Vx: 53, Vy: 53,
      Vglide: 65, Va: 0, Vno: 102, Vne: 102, Vapp: 60, Vref: 0, Vcruise: 80, Vdownwind: 70 },
    checklists,
    school: { syllabus: false, reason: 'Helicopter lessons and checklists are not implemented.' } },
};
export default R22_PRESENTATION;
