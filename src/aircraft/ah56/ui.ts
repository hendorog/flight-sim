// Lockheed AH-56A Cheyenne: HUD levers, readouts and hints. Simulator control reference, not a checklist (those are on F).
// Sources: ASTA-72 = USAASTA 72-08 (ICS aircraft) and AMCS-73 = USAASTA 72-44 (AMCS aircraft) safety-of-flight releases and test text,
// APE-I = USAASTA 70-02. Keys: F5 / F6 collective; F1 / F2 / F3 / F4 the ENGINE CONDITION grip (the twist grip stops: OFF, IDLE, RUN);
// the propeller keys (; and ') turn the PROP twist grip (blade angle) and the snap keys set the hover detent, autorotation and
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
    // The unlock toast carries the sim's taxi advice (tuning round 2, KNOWN_ISSUES T1: the free castor diverges above walking pace).
    { id: 'tailWheelLock', label: 'Tail wheel', read: c => c.tailWheelLock ? 'LOCKED' : 'UNLOCKED: turns below 5 kt only; lock it (Shift+\') above 10 kt' },
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
    ['Prop blade angle', `Hover detent ${AH56_PROP_BETA_DEG.hoverDetent}° / autorotation +${AH56_PROP_BETA_DEG.autorotation}° / full reverse ${AH56_PROP_BETA_DEG.flightMin}° (snap keys, see Controls); ; and ' turn the prop grip. The blade angle above +28° is touchy: small grip, big power change. PROP SCHEDULE (a sim aid, on at the start): until you touch the prop grip the blade angle follows the trim schedule with airspeed, so to speed up just lower the nose a little; a prop key or snap hands the grip back to you`],
    ['Cyclic', 'Arrow keys. The keyboard stick stays where you leave it (it does not spring back). With the STAB ASSIST on, where the stick sits is the attitude flown: hold a key and the nose moves (about 22°/s of bank and 12°/s of pitch, up to 30° of bank and 15° of pitch; near the ground the bank stays within about 8°), let go and the aircraft stays at that attitude; press the opposite key to come back, or 5 to centre the stick (the attitude you started with). With the STAB ASSIST off the stick is the raw control gyro, a rate command (the real AMCS: stick released = attitude held): a keyboard stick left off centre keeps the nose moving'],
    ['Pedals', 'Z / X turn the nose while held (up to about 35°/s in the hover) and the turn stops when you let go; the STAB ASSIST then holds the new heading, and in forward flight it keeps the sideslip at zero, so the climb, the cruise and the turns need no pedal. The keyboard pedal is not sprung back: it settles where the heading is held'],
    ['STAB ASSIST', 'Shift+A. A sim aid, ON at the start: the keyboard stick flies the attitude it is left at (at every speed), the pedal keys turn the nose and the heading is held when they rest, the yaw damped up to 60 KIAS, the pedals walked to zero sideslip in forward flight, the heading held on the wheels above 6 kt with the tail wheel locked (taxi, run-on, rolling take-off), and the height held while the collective keys rest below 30 KIAS (F5 / F6 held: about a 3.5 m/s descent / 4.5 m/s climb, slowing near the ground). The real aircraft had no such system; switch it off to fly the raw gyro (then a stick or pedal left off centre keeps the nose moving)'],
    ['Taxi', 'Tail wheel LOCKED (Shift+\') to taxi straight, feet off the pedal keys above 10 kt; unlock only to turn, below 5 kt. Unlocked, the free castor swings the tail out above walking pace unless the pedals catch it at once (sim advice; the test pilots taxied unlocked to 20 kt)'],
    ['Cyclic stirs', 'Avoid cyclic stirs above 0.5 Hz on the ICS aircraft (prohibited); single 2 cycles/s inputs are permitted'],
    ['ICS pitch trim', 'The ICS configuration\'s pitch trim is unrepresentative above 120 KCAS: with the collective and prop held the model needs about 0.07 in of forward stick per knot (the 1972 test aircraft 0.015), and 4.5 in forward at 190 KCAS with the CG aft. The AMCS default is not affected'],
    ['ICS on keys', 'The ICS configuration (URL config=ics) has the AMCS\'s keyboard beginner profile and aids, and on keys its runway lift-off rolls onto a wingtip: fly the ICS with a stick, or start it in the hover (URL hover=1). Left hands off for a minute its hover grows a slow pitch-roll oscillation that reaches the ground from a 3 m hover in about 50 s'],
    ['Collective', 'F5 / F6 down / up (with the STAB ASSIST below 30 KIAS, held = descend / climb, at rest = the height held; in forward flight they move the lever). Shift+F5 / Shift+F6 at hand speed: Shift+F5 drops to the autorotation entry (15 %) for an engine failure in forward flight above 500 ft; with the engine running below 30 KIAS it acts as F5 (a sim guard: in the hover the hand-speed drop puts the aircraft on the ground at about 2,700 fpm); Shift+F6 stops at 80 %, the landing cushion (with the engine stopped it takes the whole travel). The panel and HUD show the collective as the cockpit indicator does: the AMCS reads 7° more than the ICS (13° AMCS = 6° ICS in cruise)'],
    ['Condition grip', 'F1 / F2 / F3 / F4 move the engine condition grip (OFF, IDLE, RUN); Shift+F1 reaches OFF through the idle release. The prop grip is the one in front of it'],
    ['Landing', 'To land: come to a hover over the spot and hold F5; the STAB ASSIST slows the descent near the ground. Tail wheel LOCKED for take-off and landing; gear down by 130 KCAS (lowered at about 120 on the deceleration). Run-on landings (60 – 70 KCAS or less, reverse prop and main-gear brakes only) are not yet beginner-safe on keys: a fast touchdown can collapse a main leg, and the brakes above 20 kt can tip the aircraft onto its nose. If you fly one: feet off the pedal keys (the STAB ASSIST holds the heading on the wheels, tail wheel locked), F5 on the wheels, the brakes only below 20 kt'],
    ['Autorotation', 'Collective down (Shift+F5), prop to +8°, 85 – 95 KCAS; recover above 500 ft AGL. Autorotation landings are prohibited'],
    ['Hold (A)', 'A when airborne (2 m or more) holds what the aircraft is doing. In the hover: the position, the height and the heading; engaged drifting, it stops gently (about 1 kt a second) and holds where it stopped. Moving: the speed (the ASI\'s from 40 KIAS up, the speed over the ground below), the height and the heading. Engaged in a bank it rolls the wings level first and holds the heading it rolls out on; in a climb or descent it levels off smoothly a few metres on. G turns the heading bug: from 20 KIAS a standard-rate turn (3° a second) with the bank for it and the ball centred, slower on the pedals. T / Shift+T move the height 100 ft (at most 2 m/s, about 400 fpm). While A is on it also flies the prop grip on the PROP SCHEDULE table at the held speed (the hover detent in the hover), so the prop keys do nothing until A is off. A off leaves the stick where the hold had it; any cyclic, pedal or collective key also takes it back. A sim aid: these laws are not a modelled AH-56A system'],
    ['Engine failure in the hover', 'Survivable only low (wheels within about 3 m, 10 ft on the HUD AGL): level the wings, hold the collective, then hold Shift+F6 when the HUD AGL first reads 8 ft (you arrive at about 2 m of wheel height; earlier or later a main leg collapses, and waiting for 6 – 7 ft is too late at a normal pace). From a 15 m hover the rotor runs down before the ground (this model\'s H-V corner)'],
    ['Limits', 'Torque 114 % (3925 shp), TIT 740 °C continuous, Ng 100 %, Nr 95 – 105 % power on, 85 – 110 % off'],
    ['Rear panel', 'The pilot panel is reconstructed from report text: no photograph of it is known, so its layout is UNVERIFIED. The APU, Nf ALTERNATE, ABORT STOP, ROTOR BRAKE, DIR TRIM and HYDRAULIC 1 / 1A / 2 controls are drawn in their normal positions but not modelled (they do not operate)'],
  ],
};
