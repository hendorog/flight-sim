// Lockheed AH-56A Cheyenne: HUD levers, readouts and hints. Simulator control reference, not a checklist (those are on F).
// Sources: ASTA-72 = USAASTA 72-08 (ICS aircraft) and AMCS-73 = USAASTA 72-44 (AMCS aircraft) safety-of-flight releases and test text,
// APE-I = USAASTA 70-02. Keys: F5 / F6 collective; F1 / F2 / F3 / F4 the ENGINE CONDITION grip (the twist grip stops: OFF, IDLE, RUN);
// the propeller keys (; and Shift+;) turn the PROP twist grip (blade angle) and the snap keys set the hover detent, autorotation and
// reverse; the Nf RPM SET beep is on the shifted pair; gear, tail-wheel lock and brakes are in the controls list. The state blocks of
// the stages that have not landed (pusher, controlGyro, gear) are read defensively: absent, a readout shows a dash.
import { DEG } from '../../core/math';
import type { AircraftState, ControlInputs } from '../../core/types';
import type { UiProfile } from '../types';
import { AH56_N2_BEEP, AH56_NG_PCT, AH56_PROP_BETA_DEG } from './facts';
import { ah56CollectiveIndicatedDeg } from './panel';
import { ah56TorquePct } from './panelMarkings';

const onOff = (v: boolean | undefined): string => v ? 'ON' : 'OFF';
const GRIP_TEXT = { cutoff: 'OFF', groundIdle: 'IDLE', between: 'BETWEEN', fullOpen: 'RUN' } as const;
const gripText = (c: ControlInputs, s: AircraftState): string => {
  const t = s.rotorcraft?.turboshaft;
  return t ? GRIP_TEXT[t.grip] + (t.governorMode === 'manual' ? ' (MANUAL)' : '') : `${Math.round(c.throttle * 100)}%`;
};
const betaDeg = (s: AircraftState): number | null => s.rotorcraft?.pusher ? s.rotorcraft.pusher.beta / DEG : null;
const gearText = (s: AircraftState): string => s.gear.retractable ? (s.gear.inTransit ? 'IN TRANSIT' : s.gear.locked.every(Boolean) ? 'DOWN' : 'UP') : '—';

export const AH56_UI: UiProfile = {
  controlName: 'stick',
  startupSteps: [
    ['Before start', 'Collective full down (F5), condition grip OFF (F1 then Shift+F1), prop at the hover detent, Nf RPM SET to DECR for 5 s before the engine start (ASTA-72 SoF). Tail wheel LOCKED for the take-off'],
    ['Electrical', 'Click BAT, boost pump ON. Press LAMP TEST: every caution lens lights. The panel shows the control system flown: AMCS (default) or ICS (URL config=ics)'],
    ['Start', 'Hold START (S, or the panel STARTER). At 20 % Ng roll the engine condition grip to IDLE; the rest of the start is automatic (the APU is not modelled). Watch TIT'],
    ['After start', 'Ng idle 58 – 72 %, Nf and Nr about 60 %. Generator ON. Grip to RUN (F4): Nf / Nr rise to 95 – 105 % (97.5 % on the AMCS aircraft, 100 % on the ICS)'],
    ['Run-up', 'Nf / Nr both on the tape bars together; RPM SET sets them. Torque, TIT and the hydraulic bars in the green. Rotor brake off'],
    ['Take-off', 'Collective for a hover, prop at the −2.2° detent. Helicopter mode: collective up with the prop at +8°, then collective back to 13° (AMCS) and the prop up for the climb. Raise the gear at about 95 KCAS'],
    ['Shutdown', 'Prop to the hover detent, collective down, grip to IDLE then OFF; rotor brake only below 40 % Nr with the engine off and TIT under 320 °C'],
  ],
  starterAdvice(c) {
    if (!c.masterBattery) return 'BAT is OFF. Click BAT on the panel.';
    if ((c.collective ?? 0) > 0.02) return 'Lower the collective (F5) before starting.';
    return 'Hold START; at 20 % Ng roll the condition grip to IDLE; the rest is automatic';
  },
  switches: [
    { id: 'masterBattery', label: 'Battery', read: c => onOff(c.masterBattery) },
    { id: 'alternator', label: 'Generator', read: c => onOff(c.alternator) },
    { id: 'fuelPump', label: 'Boost pump', read: c => onOff(c.fuelPump) },
    { id: 'gearLever', label: 'Landing gear', read: c => c.gearLever === 'up' ? 'UP' : 'DOWN' },
    { id: 'tailWheelLock', label: 'Tail wheel', read: c => c.tailWheelLock ? 'LOCKED' : 'UNLOCKED' },
    { id: 'beacon', label: 'Anti-collision', read: c => onOff(c.lights.beacon) },
    { id: 'nav', label: 'Position lights', read: c => onOff(c.lights.nav) },
    { id: 'landing', label: 'Landing light', read: c => onOff(c.lights.landing) },
  ],
  hud: { levers: [
    // Collective as the cockpit indicator reads it, with the propeller blade angle beside it, both in degrees.
    { label: 'COLL', read: c => c.collective ?? 0, text: (c, s) => `${ah56CollectiveIndicatedDeg(s, c).toFixed(1)}°` },
    { label: 'PROP β', read: c => c.propLever ?? 0, text: (_c, s) => { const b = betaDeg(s); return b === null ? '—' : `${b.toFixed(1)}°`; } },
    { label: 'GRIP', read: c => c.throttle, text: gripText },
    { label: 'Nf SET', read: (_c, s) => Math.min(1, Math.max(0, ((s.rotorcraft?.turboshaft?.n2SetPct ?? 100) - AH56_N2_BEEP.range[0] * 100) / ((AH56_N2_BEEP.range[1] - AH56_N2_BEEP.range[0]) * 100))), style: 'marker',
      text: (_c, s) => s.rotorcraft?.turboshaft ? `${s.rotorcraft.turboshaft.n2SetPct.toFixed(1)}%` : '—' },
    { label: 'GEAR', read: c => c.gearLever === 'up' ? 0 : 1, text: (_c, s) => gearText(s) },
    { label: 'TAIL WHL', read: c => c.tailWheelLock ? 1 : 0, text: c => c.tailWheelLock ? 'LOCKED' : 'UNLOCKED' },
  ], readouts: [
    { label: 'TQ', text: s => `${ah56TorquePct(s.engine.torque).toFixed(0)}%${ah56TorquePct(s.engine.torque) > 114 ? ' LIMIT' : ''}` },
    { label: 'TIT', text: s => `${(s.engine.itt ?? 0).toFixed(0)} °C${(s.engine.itt ?? 0) > 740 ? ' LIMIT' : ''}` },
    { label: 'Ng', text: s => `${(s.engine.ng ?? 0).toFixed(1)}%${(s.engine.ng ?? 0) > AH56_NG_PCT.continuous ? ' HIGH' : ''}` },
    { label: 'Nf/Nr', text: s => { const t = s.rotorcraft?.turboshaft; return t ? `${t.n2Pct.toFixed(0)} / ${t.nrPct.toFixed(0)}%${t.needlesSplit ? ' SPLIT' : ''}` : '—'; } },
    { label: 'CONTROL', text: s => s.rotorcraft?.controlGyro ? (s.rotorcraft.controlGyro.mode === 'ics' ? 'ICS' : 'AMCS') : '—' },
    { label: 'G', text: s => s.gLoad.toFixed(2) },
    { label: 'VNE', text: s => s.rotorcraft ? (s.rotorcraft.vneKias === 0 ? 'NO FLIGHT' : `${s.rotorcraft.vneKias.toFixed(0)} KCAS${s.rotorcraft.airspeedLimitExceeded ? ' EXCEEDED' : ''}`) : '—' },
  ] },
  hints: [
    ['Prop blade angle', `Hover detent ${AH56_PROP_BETA_DEG.hoverDetent}° / autorotation +${AH56_PROP_BETA_DEG.autorotation}° / full reverse ${AH56_PROP_BETA_DEG.flightMin}° (snap keys, see Controls); ; and Shift+; turn the prop grip. The blade angle above +28° is touchy: small grip, big power change`],
    ['Cyclic', 'Arrow keys / Z, X. The keyboard cyclic re-centres when you let go (AMCS: stick released = attitude held)'],
    ['Cyclic stirs', 'Avoid cyclic stirs above 0.5 Hz on the ICS aircraft (prohibited); single 2 cycles/s inputs are permitted'],
    ['Collective', 'F5 / F6 down / up. The panel and HUD show the collective as the cockpit indicator does: the AMCS reads 7° more than the ICS (13° AMCS = 6° ICS in cruise)'],
    ['Condition grip', 'F1 / F2 / F3 / F4 move the engine condition grip (OFF, IDLE, RUN); Shift+F1 reaches OFF through the idle release. The prop grip is the one in front of it'],
    ['Landing', 'Tail wheel LOCKED for take-off and landing. Run-on landings at 60 – 70 KCAS or less; reverse prop and main-gear brakes only. Gear down by 130 KCAS (lowered at about 120 on the deceleration)'],
    ['Autorotation', 'Collective down, prop to +8°, 85 – 95 KCAS; recover above 500 ft AGL. Autorotation landings are prohibited'],
    ['Limits', 'Torque 114 % (3925 shp), TIT 740 °C continuous, Ng 100 %, Nr 95 – 105 % power on, 85 – 110 % off'],
    ['Rear panel', 'The pilot panel is reconstructed from report text: no photograph of it is known, so its layout is UNVERIFIED. The APU, Nf ALTERNATE, ABORT STOP, ROTOR BRAKE, DIR TRIM and HYDRAULIC 1 / 1A / 2 controls are drawn in their normal positions but not modelled (they do not operate)'],
  ],
};
