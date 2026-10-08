// Condensed simulator startup in POH 4-6 / 4-7 order (sources in reference.ts). Physical inspection,
// friction locks, priming pump, rotor brake and circuit breakers are not simulated.
import type { UiProfile } from '../types';
import { R22_INSTRUMENT_REFERENCE as V } from './reference';

const onOff = (v: boolean | undefined): string => v ? 'ON' : 'OFF';
export const R22_UI: UiProfile = {
  controlName: 'stick',
  startupSteps: [
    ['Before start', 'Fuel ON (Shift+J); controls free; hold F5 collective down; 5 centres cyclic and pedals'],
    ['Carb heat / mixture', '/ COLD; hold Shift+M full rich; mixture guard installed; landing light and radios OFF'],
    ['Clutch / governor', 'Insert: clutch DISENGAGED; Delete: governor ON; set altimeter with K / Shift+K'],
    ['Start', 'F1 throttle closed; click BAT on and ALT off; O strobe ON; 4 BOTH, hold S then release'],
    ['Engage drive', 'F3 / F2 set engine 50–60%; Insert engage clutch; blades must turn within 5 seconds'],
    ['After start', 'Click ALT on; oil pressure ≥25 psi within 30 s; I radios on; wait for CLUTCH light out'],
    ['Warm-up / checks', '70–75% RPM; gauges green; at 75%, 2 / 3 / 4 check mags (≤7% drop); / check CAT response'],
    ['Run-up', 'Roll throttle down briefly: tach needles split; check MAP placard; governor ON; ease F3 to 102–104%'],
    ['Low RPM check / lift', 'Raise collective slightly, reduce throttle: horn/light at 97%; restore 102–104%; clear area, ease F6 up'],
  ],
  starterAdvice(c) {
    if (!c.masterBattery) return 'Starter: BAT is OFF. Click BAT on the console (W switches BAT and ALT together).';
    if (c.fuelSelector === 'off') return 'Fuel shut-off OFF: Shift+J selects ON.';
    if (c.mixture < 0.8) return 'Hold Shift+M for full rich before starting.';
    if (c.rotorClutch) return 'Disengage the clutch (Insert) before cranking.';
    return null;
  },
  switches: [
    { id: 'masterBattery', label: 'Battery', read: c => onOff(c.masterBattery) },
    { id: 'alternator', label: 'Alternator', read: c => onOff(c.alternator) },
    { id: 'avionics', label: 'Avionics', read: c => onOff(c.avionics) },
    { id: 'magnetos', label: 'Ignition', read: c => ['OFF', 'R', 'L', 'BOTH'][c.magnetos] },
    { id: 'fuelSelector', label: 'Fuel shut-off', read: c => c.fuelSelector === 'off' ? 'OFF' : 'ON' },
    { id: 'carbHeat', label: 'Carb heat', read: c => `${Math.round(c.carbHeat * 100)}%` },
    { id: 'rotorClutch', label: 'Clutch switch', read: c => c.rotorClutch ? 'ENGAGED' : 'DISENGAGED' },
    { id: 'rotorGovernor', label: 'Governor switch', read: c => onOff(c.rotorGovernor) },
    { id: 'nav', label: 'Nav lights', read: c => onOff(c.lights.nav) },
    { id: 'strobe', label: 'Strobe', read: c => onOff(c.lights.strobe) },
    { id: 'landing', label: 'Landing light', read: c => onOff(c.lights.landing) },
  ],
  hud: {
    levers: [
      { label: 'COLL', read: c => c.collective ?? 0 }, { label: 'THR', read: c => c.throttle },
      { label: 'MIX', read: c => c.mixture, style: 'mixture' }, { label: 'CARB', read: c => c.carbHeat },
      { label: 'GOV', read: c => c.rotorGovernor ? 1 : 0,
        text: (c, s) => !c.rotorGovernor ? 'OFF' : s.rotorcraft?.governorActive ? 'ACTIVE' : 'ARMED' },
    ],
    readouts: [
      { label: 'NR', text: s => `${((s.rotorcraft?.rotorRpm ?? 0) / V.rotorRpm100 * 100).toFixed(1)}%${s.rotorcraft?.lowRpmHorn ? ' LOW' : ''}` },
      { label: 'ENG', text: s => `${(s.engine.rpm / V.engineRpm100 * 100).toFixed(1)}%` },
      { label: 'MP', text: s => `${s.engine.manifoldPressure.toFixed(1)} inHg` },
    ],
  },
  hints: [
    ['Cyclic / pedals', 'Arrow keys / Z, X; use small inputs'],
    ['Collective down / up', 'Hold F5 / F6; throttle F2 / F3 is separate'],
    ['Clutch / governor', 'Insert / Delete. Governor switch is on the collective in the real R22'],
    ['Carburettor heat', '/ toggles; console knob allows partial heat. Avoid yellow CAT band; full heat below 18 inHg MP'],
    ['Mixture guard', 'Click the guard before turning the red knob; M / Shift+M keyboard control bypasses the panel guard'],
    ['Console limits', 'CAT is estimated; cabin heat has no thermal model; BRAKE, chip, MR TEMP and CO lamps test only'],
    ['Flight model', 'Experimental R22; airplane autopilot and Flight School unavailable'],
  ],
};
