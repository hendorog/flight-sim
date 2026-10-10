// Simulator control reference, not a cold-start checklist. RFM 4-15/4-16 requires clutch HOLD.
import type { UiProfile } from '../types';

const onOff = (v: boolean | undefined): string => v ? 'ON' : 'OFF';
export const S269_UI: UiProfile = {
  controlName: 'stick',
  startupSteps: [
    ['300CB development status', 'Cold start is not validated. Use the running runway scenario for panel inspection.'],
    ['Start limitation', 'The RFM requires ENGAGE / HOLD cycles; this build has no clutch HOLD or spring trim. No guided start is provided.'],
    ['Supported electrical controls', 'Click BAT and ALT independently; I radio; 1 / 2 / 3 / 4 select OFF / R / L / BOTH.'],
    ['Manual flight controls', 'F5 / F6 collective down / up; F2 / F3 twist throttle closed / open. No governor is installed.'],
    ['Instrument reference', 'Engine 2530–2700 RPM; rotor power on 442–471 RPM. The green rotor dial also includes power-off 390–504 RPM.'],
    ['Panel limitations', 'Tach dials are separate until the coaxial renderer is integrated. CLUTCH DISENGAGED and transmission lenses are test-only.'],
  ],
  starterAdvice(c) {
    if (!c.masterBattery) return 'BAT is OFF. Click BAT; W switches BAT and ALT together.';
    if (c.fuelSelector === 'off') return 'Fuel shutoff is OFF. Push the FUEL control in or use Shift+J.';
    return '300CB cold start is not validated: clutch HOLD, spring trim and the carburettor priming sequence are unavailable. Use the running runway scenario.';
  },
  switches: [
    { id: 'masterBattery', label: 'Battery', read: c => onOff(c.masterBattery) },
    { id: 'alternator', label: 'Alternator', read: c => onOff(c.alternator) },
    { id: 'avionics', label: 'Radio', read: c => onOff(c.avionics) },
    { id: 'magnetos', label: 'Ignition', read: c => ['OFF', 'R', 'L', 'BOTH'][c.magnetos] },
    { id: 'fuelSelector', label: 'Fuel shutoff', read: c => c.fuelSelector === 'off' ? 'OFF' : 'ON' },
    { id: 'carbHeat', label: 'Carb heat', read: c => `${Math.round(c.carbHeat * 100)}%` },
    { id: 'rotorClutch', label: 'Clutch command (HOLD unavailable)', read: c => c.rotorClutch ? 'ENGAGE' : 'RELEASE' },
    { id: 'nav', label: 'Position lights', read: c => onOff(c.lights.nav) },
    { id: 'beacon', label: 'Beacon', read: c => onOff(c.lights.beacon) },
    { id: 'landing', label: 'Landing light', read: c => onOff(c.lights.landing) },
  ],
  hud: { levers: [
    { label: 'COLL', read: c => c.collective ?? 0 }, { label: 'THR', read: c => c.throttle },
    { label: 'MIX', read: c => c.mixture, style: 'mixture' }, { label: 'CARB', read: c => c.carbHeat },
    { label: 'BELT', read: (_c, s) => s.rotorcraft?.clutchEngagement ?? 0,
      text: (_c, s) => `${Math.round((s.rotorcraft?.clutchEngagement ?? 0) * 100)}%${s.rotorcraft?.clutchLight ? ' MOVING' : ''}` },
  ], readouts: [
    { label: 'NR', text: s => `${(s.rotorcraft?.rotorRpm ?? 0).toFixed(0)} RPM` },
    { label: 'ENG', text: s => `${s.engine.rpm.toFixed(0)} RPM` },
    { label: 'MP', text: s => `${s.engine.manifoldPressure.toFixed(1)} inHg` },
    { label: 'VNE', text: s => s.rotorcraft ? (s.rotorcraft.vneKias === 0 ? 'NO FLIGHT' :
      `${s.rotorcraft.vneKias.toFixed(0)} KIAS${s.rotorcraft.airspeedLimitExceeded ? ' EXCEEDED' : ''}`) : '—' },
    { label: 'BUS', text: s => `${s.electrical.busVoltage.toFixed(1)} V` },
    { label: 'OAT', text: s => `${(s.oat - 273.15).toFixed(0)} °C` },
  ] },
  hints: [
    ['Cyclic / pedals', 'Arrow keys / Z, X; individual sticks. Electric spring trim is not simulated.'],
    ['Collective / manual throttle', 'F5 / F6 and F2 / F3; no governor fitted.'],
    ['Clutch limitation', 'Insert or CLUTCH* selects ENGAGE / RELEASE only. RFM HOLD is unavailable; no cold-start validation.'],
    ['Mixture / carb heat', 'Scroll the red mixture knob or M / Shift+M. / toggles carb heat; its knob permits partial heat.'],
    ['Warning lenses', 'LAMP TEST is a simulator all-lens test. Transmission and clutch-disengaged sensors are absent; those lights are test-only.'],
    ['Instrumentation', 'Separate absolute tach dials are temporary. CAT and voltage thresholds are estimates; hours currently follow engine running.'],
    ['300CB placeholder', 'Articulated handling, clutch and trim await validation. No Flight School or airplane autopilot.'],
  ],
};
