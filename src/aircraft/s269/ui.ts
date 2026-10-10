import type { UiProfile } from '../types';
import { R22_UI } from '../r22/ui';
// Explicit development guidance, not a substitute starting checklist for the manual-clutch CB.
export const S269_UI: UiProfile = {
  ...R22_UI,
  startupSteps: [
    ['300CB scaffold — flight model and instruments unfinished', ''],
    ['Use the running runway scenario for inspection', ''],
    ['Real clutch HOLD, spring trim and primer are not implemented', ''],
  ],
  switches: R22_UI.switches.filter(s => s.id !== 'rotorGovernor'),
  hud: { levers: R22_UI.hud.levers.filter(l => l.label !== 'GOV'), readouts: [
    { label: 'NR', text: s => `${(s.rotorcraft?.rotorRpm ?? 0).toFixed(0)} RPM` },
    { label: 'ENG', text: s => `${s.engine.rpm.toFixed(0)} RPM` },
    { label: 'MP', text: s => `${s.engine.manifoldPressure.toFixed(1)} inHg` },
  ] },
  hints: [
    ['Cyclic / pedals', 'Arrow keys / Z, X; individual cyclic sticks'],
    ['Collective / manual throttle', 'F5 / F6 and F2 / F3; no governor fitted'],
    ['Clutch placeholder', 'Insert: two-position stand-in; real ENGAGE/HOLD/RELEASE is unfinished'],
    ['300CB scaffold', 'Articulated dynamics, ground resonance, spring trim and panel are not validated'],
  ],
};
