// PLACEHOLDER UI, not a Raven II checklist. The panel owner replaces this with validated system guidance.
import type { UiProfile } from '../types';
import { R44_REFERENCE as V } from './reference';
export const R44_UI: UiProfile = {
  controlName: 'stick', startupSteps: [['Development scaffold', 'Use the running runway start; R44 startup systems and checklists are unfinished.']],
  starterAdvice: () => 'R44 cold start is not validated. Use scenario=runway to inspect the placeholder.',
  switches: [
    { id: 'rotorClutch', label: 'Clutch', read: c => c.rotorClutch ? 'ENGAGED' : 'DISENGAGED' },
    { id: 'rotorGovernor', label: 'Governor', read: c => c.rotorGovernor ? 'ON' : 'OFF' },
  ],
  hud: { levers: [
    { label: 'COLL', read: c => c.collective ?? 0 }, { label: 'THR', read: c => c.throttle },
    { label: 'MIX', read: c => c.mixture, style: 'mixture' },
    { label: 'GOV', read: c => c.rotorGovernor ? 1 : 0,
      text: (c, s) => !c.rotorGovernor ? 'OFF' : s.rotorcraft?.governorActive ? 'ACTIVE' : 'ARMED' },
  ], readouts: [
    { label: 'NR', text: s => `${((s.rotorcraft?.rotorRpm ?? 0) / V.rotorRpm100 * 100).toFixed(1)}%${s.rotorcraft?.lowRpmHorn ? ' LOW' : ''}` },
    { label: 'ENG', text: s => `${(s.engine.rpm / V.engineRpm100 * 100).toFixed(1)}%` },
    { label: 'MP', text: s => `${s.engine.manifoldPressure.toFixed(1)} inHg` },
  ] },
  hints: [['Status', 'R44 PLACEHOLDER — flight model, cockpit and panel await validation'],
    ['Cyclic / pedals', 'Arrows / Z, X; F5 / F6 collective; F2 / F3 twist throttle'],
    ['Clutch / governor', 'Insert / Delete'],
    ['Hydraulics', 'Main rotor controls use position inputs; hydraulic failures and forces are not simulated']],
};
