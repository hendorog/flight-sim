// Lockheed AH-56A Cheyenne checklists, PARAPHRASED (not copied) from the safety-of-flight releases and the test reports: ASTA-72 =
// USAASTA 72-08 (ICS aircraft; App E SoF pp 64-74, paras 66-81), AMCS-73 = USAASTA 72-44 (AMCS aircraft; App E pp 36-39), APE-I =
// USAASTA 70-02 (SoF 1.1). These are not a flight manual: the sources give limits, procedures in outline and the checklist EMPHASIS
// (prop system control failure, stick-centring malfunction, engine control failure) without the steps, so those three lists are
// an AGENT condensation (UNVERIFIED) and say so. Condensed simulator reference: judgements and timed items stay manual. Live checks
// read the checklist frame (ui/checklistModel.ts): turbine.ng / turbine.itt, checklist.rotorPercent / enginePercent (Nr % of 246 rpm, Nf %
// of 13,600), throttle (the engine condition grip), checklist.collective, checklist.tailWheelLock, checklist.gearDown, kias.
import { all, eq, ge, le } from '../../training/engine/dsl';
import { checklist, checkItem as i, type FlightChecklist } from '../../training/checklistData';
import { AH56_GEAR_LIMIT_KCAS, AH56_NG_PCT, AH56_NR_PCT, AH56_PROP_BETA_DEG, AH56_TIT_C } from './facts';

const normal = (id: string, title: string, source: string, items: FlightChecklist['items'], note?: string) =>
  checklist(id, title, items, { category: 'normal', source, note });
const emergency = (id: string, title: string, source: string, items: FlightChecklist['items'], note?: string) =>
  checklist(id, title, items, { category: 'emergency', source, note });

const down = i('collective', 'Collective', 'Full down', le('checklist.collective', 0.01));
const gripOff = i('gripOff', 'Engine condition grip', 'OFF', le('throttle', 0.05));
const locked = i('tailWheel', 'Tail wheel', 'LOCKED for take-off and landing (unlocked only to turn on the ground)', eq('checklist.tailWheelLock', true));
const gearDown = i('gear', `Landing gear`, `DOWN (operating limit ${AH56_GEAR_LIMIT_KCAS} KCAS)`, eq('checklist.gearDown', true));
/** Nr within the power-on band 95-105 % (P ASTA-72 SoF; 100 % = 246 rpm, the AMCS aircraft flies 97.5 %). */
const nrOn = all(ge('checklist.rotorPercent', AH56_NR_PCT.powerOn[0]), le('checklist.rotorPercent', AH56_NR_PCT.powerOn[1] + 0.5));
const nrAny = all(ge('checklist.rotorPercent', AH56_NR_PCT.powerOff[0]), le('checklist.rotorPercent', AH56_NR_PCT.powerOff[1]));
const SOF = 'ASTA-72 App E (SoF) pp 64-74; AMCS-73 App E pp 36-39';

export const AH56_CHECKLISTS = {
  beforeStart: normal('beforeStart', 'Before start', `${SOF}; APE-I SoF 1.1`, [
    i('walkround', 'Exterior and cockpit', 'Inspected; the canopy closed and locked; wind 20 kt or less for rotor start and stop'),
    down,
    gripOff,
    i('beep', 'Nf RPM SET switch', 'DECR for at least 5 s before the engine start'),
    i('prop', 'Prop twist grip', 'At the hover detent (−2.2°)'),
    locked,
    i('battery', 'Battery', 'ON', eq('master', true)),
    i('boost', 'Boost pump', 'ON', eq('fuelPump', true)),
    i('lamps', 'Master caution and caution lenses', 'Press LAMP TEST: every lens lights'),
    i('brake', 'Rotor brake', 'May stay on for the start; released above ground idle'),
    i('hyd', 'Hydraulics', 'Systems 1, 1A and 2 normal; do not start the APU with the rotor turning and a No. 1 hydraulic fault suspected'),
  ]),
  engineStart: normal('engineStart', 'Engine start', `${SOF}; ASTA-72 para 78`, [
    i('apu', 'APU', 'Started with its spring-loaded switch; 95 – 100 % normal, 110 % maximum (not modelled: the START control stands for it)'),
    i('start', 'START', 'Press and hold; Ng must rise', ge('turbine.ng', 5)),
    i('grip', 'Engine condition grip', 'To IDLE at 20 % Ng; the rest of the start is automatic (an abort-stop button is fitted)', ge('turbine.ng', 20)),
    i('tit', 'TIT', 'At most 566 °C up to 50 % Ng and 649 °C to idle (1971 limits; the 1972 release keeps the idle figure)'),
  ], 'Abort the start on an Ng stall or TIT over the limits: the abort-stop button, grip OFF.'),
  afterStart: normal('afterStart', 'After start', `${SOF}`, [
    i('idle', 'Idle', `Ng ${AH56_NG_PCT.idle[0]} – ${AH56_NG_PCT.idle[1]} %; TIT normally 400 – 440 °C`, all(ge('turbine.ng', AH56_NG_PCT.idle[0] - 0.5), le('turbine.ng', AH56_NG_PCT.idle[1] + 0.5))),
    i('gen', 'Generator', 'ON', eq('alternator', true)),
    i('oil', 'Oil pressures', 'Engine oil 10 psi or more (50 at 95 % Ng); transmission oil 70 psi or more'),
  ]),
  runup: normal('runup', 'Run-up', `${SOF}`, [
    i('run', 'Engine condition grip', 'RUN (the prop-governing logic and the Nf governor take over)', ge('throttle', 0.95)),
    i('nr', 'Nf and Nr', 'In the 95 – 105 % power-on band: 100 % ICS, 97.5 % AMCS; trim with the Nf RPM SET switch (INCR / DECR)', nrOn),
    i('tit', 'TIT', 'Green: 300 to 740 °C', le('turbine.itt', AH56_TIT_C.continuous)),
    i('systems', 'Hydraulics and oil', 'Three hydraulic systems 2800 – 3400 psi; engine oil 10 – 83 psi; transmission oil 70 – 110 psi'),
    i('brake', 'Rotor brake', 'Released'),
  ]),
  beforeTakeoff: normal('beforeTakeoff', 'Before take-off', `${SOF}`, [
    locked,
    gearDown,
    i('prop', 'Prop twist grip', 'Hover detent −2.2° for a vertical take-off; +8° for a helicopter-mode take-off'),
    i('brakes', 'Parking brake', 'Released', eq('parkingBrake', false)),
    i('lamps', 'Caution lenses', 'All out'),
    i('control', 'Control system', 'AMCS: stick released holds attitude. ICS: no cyclic stirs above 0.5 Hz; roll compensator and pitch desensitizer fitted'),
  ]),
  afterTakeoff: normal('afterTakeoff', 'Take-off and climb', `${SOF}; AMCS-73 paras 16-17`, [
    i('hover', 'Vertical take-off', 'Collective for the hover with the prop at −2.2°; then collective up and the prop to +8° to accelerate, collective back to 13° (AMCS) when through transition, prop up for the climb'),
    i('roll', 'Rolling take-off', 'Prop thrust to about 60 KIAS with the collective at 7°, then collective to 13° to lift off; no abrupt attitude changes'),
    i('gearUp', 'Gear', 'Up at about 95 KCAS (not above 130)'),
    i('power', 'Power', 'Two limits to watch together: torque 114 % and TIT 740 °C (collective and prop both add power)'),
  ]),
  cruise: normal('cruise', 'Cruise', `${SOF}`, [
    i('collective', 'Collective', 'About 13° indicated above 80 KCAS (AMCS); 7° from 80 to 120 KCAS and 5° from 120 to 190 (ICS)'),
    i('nr', 'Nf and Nr', 'Within the band', nrOn),
    i('tit', 'TIT and torque', '740 °C and 114 % are the continuous limits', le('turbine.itt', AH56_TIT_C.continuous)),
    i('limits', 'Limits', 'Dive at most 20° with the prop at least −5° (1972); load factor per the release; keep the pedal inputs within 1 in of trim'),
  ]),
  landing: normal('landing', 'Descent and landing', `${SOF}`, [
    gearDown,
    locked,
    i('decel', 'Deceleration', 'Prop smoothly to −12° (full reverse) from cruise; gear down by 130 KCAS (about 120 in practice); collective back to about 5° ICS'),
    i('hover', 'Hover', 'Prop to −2.2° at the hover'),
    i('runon', 'Run-on landing', 'Touchdown at 60 – 70 KCAS or less; reverse prop and main-gear brakes only (no cyclic aft on the ground)'),
  ]),
  afterLanding: normal('afterLanding', 'After landing', `${SOF}`, [
    down,
    i('prop', 'Prop twist grip', 'Hover detent'),
    i('brakes', 'Wheel brakes', 'As needed; taxi at most 20 kt with the tail wheel unlocked, 70 KCAS locked'),
  ]),
  shutdown: normal('shutdown', 'Shutdown', `${SOF}`, [
    down,
    i('idle', 'Engine condition grip', 'IDLE, then OFF', le('throttle', 0.3)),
    gripOff,
    i('tit', 'TIT', 'Under 320 °C before the rotor brake', le('turbine.itt', 320)),
    i('brake', 'Rotor brake', 'Below 40 % Nr with the engine off; never with the engine running', le('checklist.rotorPercent', 40)),
    i('switches', 'Generator and battery', 'OFF', eq('alternator', false)),
  ]),
  engineFailure: emergency('engineFailure', 'Engine failure', `${SOF}; ASTA-72 paras 66-69`, [
    i('cue', 'Cues', 'Left yaw, a little right roll, Nr falling, the delta-beta cuts the prop to about +18°'),
    i('collective', 'Collective', 'Lower it at once to hold Nr (95 – 105 %; 85 – 110 % power off)', nrAny),
    i('prop', 'Prop', 'Autorotation setting +8° (not below −5° in a dive); from reverse the delta-beta cuts it to −7° ICS / −8.5° AMCS'),
    i('speed', 'Airspeed', 'Autorotate at 85 – 95 KCAS', all(ge('kias', 80), le('kias', 100))),
    i('land', 'Landing', 'Autorotation landings are prohibited: this is a forced-landing procedure; hover and low speed: right pedal and cushion with the collective'),
  ], 'In a climb at high power the rotor can fall to about 68 % unless the collective is lowered at once.'),
  propFailure: emergency('propFailure', 'Prop system control failure', `${SOF} (emphasis only; AGENT condensation, UNVERIFIED)`, [
    i('cue', 'Cue', 'Prop blade angle not following the grip, creeping down above 33° or jammed'),
    i('speed', 'Airspeed', 'Control it with the collective and pitch attitude; thrust rises as speed falls at a fixed blade angle'),
    i('beta', 'Blade angle', `Do not dive with it below ${AH56_PROP_BETA_DEG.flightMin}°; reverse thrust on the ground gives right yaw and roll`),
    i('land', 'Landing', 'Land as soon as practicable'),
  ], 'The releases name this failure in the emergency checklist emphasis; the steps are condensed from the handling text.'),
  stickCentring: emergency('stickCentring', 'Stick-centring malfunction', `${SOF} (emphasis only; AGENT condensation, UNVERIFIED)`, [
    i('cue', 'Cue', 'The stick does not return to the trimmed position'),
    i('hold', 'Control', 'Fly it with the cyclic and the trim switch (coolie hat); keep the inputs small and slow'),
    i('land', 'Landing', 'Land as soon as practicable'),
  ]),
  engineControl: emergency('engineControl', 'Engine control failure', `${SOF} (emphasis only; AGENT condensation, UNVERIFIED)`, [
    i('cue', 'Cue', 'Ng, TIT or Nf not following the collective or the condition grip'),
    i('power', 'Power', 'Hold Nr with the collective and the prop; do not exceed 114 % torque or 740 °C TIT'),
    i('land', 'Landing', 'Land as soon as practicable; the grip to IDLE and OFF if power cannot be held'),
  ]),
  momentStall: emergency('momentStall', 'Blade moment stall (ICS)', 'ASTA-72 App E; paras 63-65', [
    i('cue', 'Cue', 'Right roll and pitch-up at about 1.4 g (122 KCAS) to 1.5 g (154 KCAS), uncommanded'),
    i('recover', 'Recovery', 'Relax the back pressure at once to take the load factor off; reduce speed'),
    i('avoid', 'Avoid', 'The ICS manoeuvre stability turns neutral above about 1.3 g at 120 KCAS and 1.4 g at 150, and the stall follows about 0.1 g later: stay under it. The AMCS has no moment stall in its envelope'),
  ]),
  halfPHop: emergency('halfPHop', 'Half-P hop (ICS)', 'ASTA-72 App E; AMCS-73 (Hoh-74 section 4.6)', [
    i('cue', 'Cue', 'A 0.5P (about 2 Hz) roll and plunge oscillation at high speed with low collective'),
    i('hands', 'Controls', 'Hands still: stop the stirring, because the stick input is what drives it', ),
    i('speed', 'Airspeed', 'Reduce speed with the prop and a small collective increase'),
  ], 'Triggered by repeated two-axis stirs above 0.5 Hz at 150 KCAS or more; the AMCS never triggers it.'),
} satisfies Record<string, FlightChecklist>;
