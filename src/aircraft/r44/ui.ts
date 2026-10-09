// Simulator control guidance, not an R44 cold-start checklist. Fuel priming/automatic auxiliary pump
// and R44 cold-start acceptance remain flight-model/shared-system work; do not imply they are complete.
import type { UiProfile } from '../types';
import { R44_REFERENCE as V } from './reference';

const onOff = (v: boolean | undefined): string => v ? 'ON' : 'OFF';
export const R44_UI: UiProfile = {
  controlName: 'stick',
  startupSteps: [
    ['Development status', 'R44 PLACEHOLDER — cold start is not validated; use the running runway start'],
    ['Before-start controls', 'Fuel ON: Shift+J; F5 collective down; 5 centres cyclic/pedals; F1 closes throttle'],
    ['Electrical / ignition', 'Click BAT and ALT separately; O strobe; I avionics; 1 / 2 / 3 / 4 select OFF / R / L / BOTH'],
    ['Start limitation', 'The real IO-540 uses PRIME then mixture OFF to crank. PRIME and automatic pump wiring are unavailable; S is only the simulator starter'],
    ['Drive / governor', 'Insert selects clutch ENGAGE; CLUTCH lamp means actuator moving. Delete selects governor; HUD ARMED means not yet acquired'],
    ['Running-start checks', 'POH power-on range: engine/rotor 101–102%; check oil gauges and MAP/Vne placards; hold LIGHT TEST to inspect lenses'],
    ['Collective / throttle', 'F5 / F6 lowers / raises collective; F2 / F3 closes / opens twist throttle; governor switch is on the real collective'],
  ],
  starterAdvice(c) {
    if (!c.masterBattery) return 'BAT is OFF. Click BAT on the console; W switches BAT and ALT together.';
    if (c.fuelSelector === 'off') return 'Fuel shut-off is OFF; Shift+J selects ON.';
    if (c.rotorClutch) return 'Clutch is ENGAGED; Insert disengages it before cranking.';
    return 'R44 cold start is not validated: PRIME and automatic auxiliary-pump wiring are unavailable. Use the running runway start.';
  },
  switches: [
    { id: 'masterBattery', label: 'Battery', read: c => onOff(c.masterBattery) },
    { id: 'alternator', label: 'Alternator', read: c => onOff(c.alternator) },
    { id: 'avionics', label: 'Avionics', read: c => onOff(c.avionics) },
    { id: 'magnetos', label: 'Ignition', read: c => ['OFF', 'R', 'L', 'BOTH'][c.magnetos] },
    { id: 'fuelSelector', label: 'Fuel shut-off', read: c => c.fuelSelector === 'off' ? 'OFF' : 'ON' },
    { id: 'rotorClutch', label: 'Clutch switch', read: c => c.rotorClutch ? 'ENGAGED' : 'DISENGAGED' },
    { id: 'rotorGovernor', label: 'Governor switch', read: c => onOff(c.rotorGovernor) },
    { id: 'nav', label: 'Nav lights', read: c => onOff(c.lights.nav) },
    { id: 'strobe', label: 'Strobe', read: c => onOff(c.lights.strobe) },
    { id: 'landing', label: 'Landing light', read: c => onOff(c.lights.landing) },
  ],
  hud: { levers: [
    { label: 'COLL', read: c => c.collective ?? 0 }, { label: 'THR', read: c => c.throttle },
    { label: 'MIX', read: c => c.mixture, style: 'mixture' },
    { label: 'GOV', read: c => c.rotorGovernor ? 1 : 0,
      text: (c, s) => !c.rotorGovernor ? 'OFF' : s.rotorcraft?.governorActive ? 'ACTIVE' : 'ARMED' },
    { label: 'CLUTCH', read: (_c, s) => s.rotorcraft?.clutchEngagement ?? 0,
      text: (_c, s) => `${Math.round((s.rotorcraft?.clutchEngagement ?? 0) * 100)}%${s.rotorcraft?.clutchLight ? ' MOVING' : ''}` },
  ], readouts: [
    { label: 'NR', text: s => `${((s.rotorcraft?.rotorRpm ?? 0) / V.rotorRpm100 * 100).toFixed(1)}%${s.rotorcraft?.lowRpmHorn ? ' LOW' : ''}` },
    { label: 'ENG', text: s => `${(s.engine.rpm / V.engineRpm100 * 100).toFixed(1)}%` },
    { label: 'MP', text: s => `${s.engine.manifoldPressure.toFixed(1)} inHg` },
    { label: 'BUS', text: s => `${s.electrical.busVoltage.toFixed(1)} V` },
    { label: 'OAT', text: s => `${(s.oat - 273.15).toFixed(0)} °C` },
  ] },
  hints: [
    ['Status', 'R44 PLACEHOLDER — flight model and cockpit await validation; no Flight School or airplane autopilot'],
    ['Cyclic / pedals', 'Arrows / Z, X; F5 / F6 collective; F2 / F3 twist throttle'],
    ['Clutch / governor', 'Insert / Delete; GOV OFF lamp follows the switch, HUD ACTIVE follows actual governor acquisition'],
    ['Mixture', 'Full rich in flight; lift the red knob guard before scrolling. M / Shift+M bypasses the panel guard'],
    ['Fuel injection', 'No carb heat. Real PRIME and clutch-switched auxiliary pump are not implemented'],
    ['Hydraulics', 'Position controls only; hydraulic failures and control forces are not simulated'],
    ['Warning lenses', 'MR TEMP, chip, CO, FIRE, FILTER, AUX PUMP and BRAKE are test-only; LIGHT TEST requires bus power'],
    ['Console', 'Electric attitude/heading gyros; cabin heat has no thermal model; ignition START is a simulator substitute for PRIME'],
  ],
};
