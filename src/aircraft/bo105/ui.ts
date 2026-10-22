// MBB Bo 105 CB-4: HUD levers, readouts and hints. Simulator control reference, not a checklist (those are on F). Facts: FM
// Sections 2-4 and 7 (BO 105 CB-5/CBS-5 FM used for the CB-4, P5): start 4-9..4-14, limits 2-8..2-10, ENGINE TRIM 7-12,
// warnings 3-16. Keys: 8 / 9 / 0 select engine 1 / engine 2 / both; F1 / F2 / F3 / F4 move the selected power lever(s)
// (IDLE gate, down, up, FLIGHT); F5 / F6 collective; Shift+; is ENGINE TRIM fore (N2 INCR) and ; is aft (N2 DECR) (n2Beep, both engines);
// ENGINE TRIM left / right is the n2BeepSplit pair listed under Controls. The state blocks of the twin (twinTurboshaft,
// mastMoment) are read defensively: absent, a readout shows a dash.
import { engineControl, type AircraftState, type ControlInputs, type EngineControlKey } from '../../core/types';
import type { UiProfile } from '../types';
import { BO105_N2_BEEP, BO105_POWER_LEVER, BO105_TORQUE_PCT, BO105_WARNINGS } from './facts';
import { BO105_INPUT } from './input';
import { bo105MastMomentPct, bo105TorquePct } from './panelMarkings';
import { BO105_TWIN } from './twin';

const SIDES = ['1', '2'] as const;
const onOff = (v: boolean | undefined): string => v ? 'ON' : 'OFF';
const leverWord = (t: number): string => t < BO105_POWER_LEVER.cutoffBelow ? 'OFF' : t < (BO105_POWER_LEVER.groundIdle + 1) / 2 ? 'IDLE' : 'FLIGHT';
const torque = (s: AircraftState, e: number): number | null => { const x = s.engines[e]; return x?.running ? bo105TorquePct(x.torque) : x ? 0 : null; };
const pct = (v: number | null): string => v === null ? '—' : v.toFixed(0);

function perEngine(id: EngineControlKey, label: string, read: (c: ControlInputs, engine: number) => string): UiProfile['switches'] {
  return SIDES.map((side, i) => ({ id: `${id}${side}`, label: `${label} ${side}`, read: (c: ControlInputs) => read(c, i) }));
}
const leverPair = (): UiProfile['hud']['levers'] => SIDES.map((side, i) => ({
  label: `PWR ${side}`, read: (c: ControlInputs) => engineControl(c, i, 'throttle'), text: (c: ControlInputs) => leverWord(engineControl(c, i, 'throttle')) }));

/** The ENGINE TRIM left / right set-point split as a bar centred on zero, +/- the trim authority (TW's splitTrim.range). */
const splitFraction = (s: AircraftState): number => {
  const split = s.rotorcraft?.twinTurboshaft?.splitPct ?? 0, range = 100 * BO105_TWIN.splitTrim.range;
  return Math.min(1, Math.max(0, 0.5 + 0.5 * split / range));
};

export const BO105_UI: UiProfile = {
  controlName: 'stick',
  // The control box (flyability pass F4): in the cockpit view it is the keyboard pilot's only readout (the HUD is for the
  // external views). The collective, NR against the warning unit's 95 / 103 % (P5 FM 3-16), the engine keys' selection
  // as 1 / 2 / BOTH, the two power levers with the IDLE stop and OFF / IDLE / FLT, the keyboard centre (the spring-trim
  // anchor) and the STAB ASSIST chip.
  controlBox: {
    engineNames: SIDES,
    lever: { label: 'PWR', idle: BO105_POWER_LEVER.groundIdle, word: (v) => { const w = leverWord(v); return w === 'FLIGHT' ? 'FLT' : w; } },
    nr: { low: BO105_WARNINGS.nrLowPct, high: BO105_WARNINGS.nrHighPct, read: (s) => s.rotorcraft?.turboshaft?.nrPct ?? null },
    stabilityAssist: { title: 'STAB ASSIST (Shift+A): a sim aid that holds the attitude below 30 KIAS, and the heading below 20 KIAS while the pedal keys rest; on the keys it also walks the stick and pedals to the trim. The CB-4 has no SAS; the optional IFR-kit SAS (FMS 11-2) is not modelled',
      fadeKias: BO105_INPUT.stabilityAssist!.fadeKias },
  },
  startupSteps: [
    ['Before start', 'Collective full down (F5), cyclic centred (5), both power levers OFF, BAT ON (24 V minimum). Press LAMP TEST: every lens lights except the two F lights, MM LIMIT and LOW FUEL, which have their own test'],
    ['Checks', 'Press each F lens (fire test) and hold MM TEST (needle to LIMIT, lamp on). Fuel PUMP 1 / PUMP 2 ON, EMERG FUEL VALVE 1 / 2 open, ANTI-COLL ON'],
    ['Start engine 1', 'Select engine 1 (8). IGNITION 1 ON, hold the STARTER 1 half (S). At 12 – 15 % N1 bring the lever to just short of IDLE (F1), then lock it at IDLE. Watch TOT'],
    ['Abort start if', 'no TOT rise, the rotor is not turning by 25 % N1, no oil pressure, or TOT nears 927 °C (more than 10 s above 810). Lever OFF, pumps OFF, keep cranking until TOT is under 150 °C'],
    ['Release the starter', 'At 58 % N1; ignition OFF. Idle is 59 – 65 % N1 with the rotor about 60 %. Above 40 % N2 / NR switch GEN 1 ON'],
    ['Start engine 2', 'Same, with engine 2 selected (9). Ammeter under 100 A first. Both generators ON'],
    ['Before take-off', 'Both levers to FLIGHT (0, then F4), N2 trimmed to 98 % with ENGINE TRIM (; / Shift+;), torques synchronised with ENGINE TRIM left / right. RPM, T OIL, GEN lenses out'],
    ['Shutdown', 'Levers IDLE for 2 minutes, then OFF. BAT stays ON until the rotor stops (OIL COOL lights below 20 % NR)'],
  ],
  starterAdvice(c, engine) {
    const n = engine + 1;
    if (!c.masterBattery) return 'BAT is OFF. Switch BAT on (console).';
    if (engineControl(c, engine, 'fuelSelector') === 'off') return `EMERG FUEL VALVE ${n} is closed. Open it, or select engine ${n} and press Shift+J.`;
    if ((c.collective ?? 0) > 0.02) return 'Lower the collective (F5) before starting.';
    return 'STARTER/GEN to START; at 12–15 % N1 lever to IDLE; rotor turning by 25 %; starter off at 58 %';
  },
  switches: [
    { id: 'masterBattery', label: 'Battery', read: c => onOff(c.masterBattery) },
    ...perEngine('alternator', 'Generator', (c, i) => onOff(engineControl(c, i, 'alternator'))),
    ...perEngine('magnetos', 'Ignition', (c, i) => onOff(engineControl(c, i, 'magnetos') !== 0)),
    ...perEngine('fuelPump', 'Fuel pump', (c, i) => onOff(engineControl(c, i, 'fuelPump'))),
    ...perEngine('fuelSelector', 'Emergency fuel valve', (c, i) => engineControl(c, i, 'fuelSelector') === 'off' ? 'CLOSED' : 'OPEN'),
    { id: 'nav', label: 'Position lights', read: c => onOff(c.lights.nav) },
    { id: 'beacon', label: 'Anti-collision', read: c => onOff(c.lights.beacon) },
    { id: 'landing', label: 'Landing light', read: c => onOff(c.lights.landing) },
  ],
  hud: { levers: [
    { label: 'COLL', read: c => c.collective ?? 0 },
    ...leverPair(),
    { label: 'N2 SET', read: (_c, s) => Math.min(1, Math.max(0, ((s.rotorcraft?.turboshaft?.n2SetPct ?? 100) - BO105_N2_BEEP.range[0] * 100) / ((BO105_N2_BEEP.range[1] - BO105_N2_BEEP.range[0]) * 100))), style: 'marker',
      text: (_c, s) => s.rotorcraft?.turboshaft ? `${s.rotorcraft.turboshaft.n2SetPct.toFixed(1)}%` : '—' },
    { label: 'SPLIT', read: (_c, s) => splitFraction(s), style: 'marker',
      text: (_c, s) => { const v = s.rotorcraft?.twinTurboshaft?.splitPct; return v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`; } },
  ], readouts: [
    { label: 'TQ 1/2', text: s => { const a = torque(s, 0), b = torque(s, 1);
      const hi = Math.max(a ?? 0, b ?? 0);
      return `${pct(a)} / ${pct(b)}%${hi > BO105_TORQUE_PCT.oei ? ' LIMIT' : hi > BO105_TORQUE_PCT.aeo ? ' OEI RANGE' : ''}`; } },
    { label: 'TOT 1/2', text: s => `${(s.engines[0]?.itt ?? 0).toFixed(0)} / ${(s.engines[1]?.itt ?? 0).toFixed(0)} °C` },
    { label: 'N1 1/2', text: s => `${(s.engines[0]?.ng ?? 0).toFixed(0)} / ${(s.engines[1]?.ng ?? 0).toFixed(0)}%` },
    { label: 'N2/NR', text: s => {
      const t = s.rotorcraft?.turboshaft, w = s.rotorcraft?.twinTurboshaft;
      if (!t) return '—';
      const flags = [w?.n1SplitLight ? 'N1 SPLIT' : '', w?.nrLowLight ? 'NR LOW' : '', w?.nrHighLight ? 'NR HIGH' : '', w?.oei ? 'OEI' : ''].filter(Boolean).join(' ');
      return `${t.n2Pct.toFixed(0)} / ${t.nrPct.toFixed(0)}%${flags ? ` ${flags}` : ''}`;
    } },
    { label: 'MAST MOM', text: s => { const m = bo105MastMomentPct(s); return m === null ? '—' : `${m.toFixed(0)}%${m >= 100 ? ' LIMIT' : ''}`; } },
    { label: 'VNE', text: s => s.rotorcraft ? (s.rotorcraft.vneKias === 0 ? 'NO FLIGHT' :
      `${s.rotorcraft.vneKias.toFixed(0)} KIAS${s.rotorcraft.airspeedLimitExceeded ? ' EXCEEDED' : ''}`) : '—' },
  ] },
  hints: [
    ['Cyclic / pedals', 'Arrow keys / Z, X; 5 glides the stick back to the trim and leaves the pedals where they are (at low speed STAB ASSIST trims them while the pedal keys rest). The keyboard cyclic holds its position (no spring centring). Trim: Home / End and 6 / 7 (spring trim); Shift+5 sets the keyboard trim where the stick is (sim convenience: the CB-4 has beep trim only)'],
    ['Collective', 'F5 / F6 down / up, fine (the hover keys). Below 30 KIAS STAB ASSIST holds the height whenever F5 / F6 rest: a tap climbs or sinks a little and levels off, a held key keeps climbing or descending (F6 held 2 s: about 2.5 m/s, 6 m higher), and it adds power by itself as you slow down. To land, tap F5 about 0.3 s a second (touchdown about 0.5 m/s) and hold it down once the skids are on. Shift+F5 / Shift+F6 at hand speed (engine failure, cushion); Shift+F5 stops at the autorotation entry position (8 %), bare F5 goes on down. ENGINE TRIM is the 4-way switch on the collective head'],
    ['Hover', 'The real Bo 105 is unstable in the hover. STAB ASSIST (on; Shift+A for the raw aircraft) is a sim aid that holds the attitude you set below 30 KIAS, the heading when the pedal keys rest and the height when the collective keys rest: a tap banks or pitches and holds it while the drift starts; the drift\'s own airflow then rolls it back toward level, so tap back to stop a drift. It holds attitude, not position: let go and it drifts slowly (A holds the position). On the keys it also walks the stick and pedals slowly to where the helicopter trims (the control box shows them move), so after a lift-off or a slowdown the keys end up at the hover trim. The hover start (hover=1) faces into the wind, still over the ground. The mouse yoke (Y) is finer than the arrow keys'],
    ['Hover hold', 'A when airborne at 2 m or more holds the heading and height. Nearly stopped (under about 5 kt) it holds the position; pressed below about 30 kt it slows to a hover (about 1.5 kt a second, 10 – 20 s) and holds the position there; faster than 30 kt it holds that speed. Any cyclic, pedal or collective key takes it back; G heading bug, T / Shift+T height. With the mouse yoke (Y) take over slowly'],
    ['Pedals in the hover', 'With STAB ASSIST on, a pedal tap turns the nose a few degrees and stops; hold the key to turn further, and the new heading is held when you let go. While the pedal keys rest it pedals with the collective for you and moves the pedals to the trim, so collective taps need no pedal (a 1 s F6 tap swings the nose about 4°). Holding the collective key for seconds still builds torque and needs some pedal: climb in steps. Without it the yaw keeps building after a tap: tap, wait, then tap the other pedal before the heading arrives, and raise the collective with left pedal (a lift-off from the runway needs about 20 % of the travel). The hover hold (A) holds heading too'],
    ['Stick and flares', 'The Bo 105 hovers with the stick well aft and uses the forward travel for speed: flare moderately (15 – 20°). A big flare below 30 kt can run out of aft stick; the control box shows the stick and its trim'],
    ['Slowing to the hover', 'Below about 20 kt the helicopter needs more power, not less: below 30 KIAS STAB ASSIST adds it while F5 / F6 rest, so slow down with the nose up a little and let it hold the height (the hover takes about 40 % collective). Near the stop bring the nose back to the hover attitude and keep tapping the cyclic against the drift. Easier still: A below about 30 kt hands it to the hold, which slows to a hover and holds the position'],
    ['Power levers', '8 / 9 / 0 select engine 1 / 2 / both. F1 IDLE, F2 / F3 lever down / up, F4 FLIGHT. In flight both levers sit at FLIGHT; the N2 governors do the rest'],
    ['ENGINE TRIM', 'Shift+; fore (N2 INCR) / ; aft (N2 DECR): both engines (N2 / NR 98 – 102 %, 100 % recommended). Left / right (see Controls) trades torque between the engines'],
    ['Torque sharing', 'Synchronise the two torque needles before take-off (FM 4-16). The engines may sit a few percent apart until you do'],
    ['Warnings', 'RPM flashes (FM 3-16; the 2 Hz rate is an estimate) for N1 split 12 % or more, NR 95 % or less, NR 103 % or more (with a tone; 108 % steady). T OIL: transmission oil over 105 °C or under 0.5 kp/cm²'],
    ['Mast moment', 'The indicator reads the rotor hub moment against its LIMIT: use the controls smoothly, and keep slope landings gentle. MM LIMIT is not a failure but a call to reduce the control input'],
    ['Engine failure', 'Both engines: the NR LOW beeping starts within 0.4 s. Shift+F5 at once (the collective down at hand speed to the entry position, 8 %: about 100 % NR at 75 KIAS; bare F5 for more, watching NR), ease the nose up a few degrees, settle at 75 KIAS (FM 3-34). Every second of hesitation costs about 10 % NR. A big flare from high speed runs NR past 110 %: raise the collective a little (F6). At 6 – 10 ft flare to about 5° and Shift+F6 to cushion'],
    ['One engine out', 'OEI power is 95 % torque. An OEI cushion overtorques the surviving engine as NR droops: cushion late and only as much as needed'],
    ['Limits', 'Torque 86 % each (95 % one engine inoperative), TOT 779 / 810 °C (843 for 6 s), N1 105 %, N2 102 %, Vne 145 KIAS to 2400 kg, 130 above'],
  ],
};
