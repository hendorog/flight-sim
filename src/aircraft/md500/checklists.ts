// MD 500E (369E) checklists, PARAPHRASED (not copied) from the FAA-approved RFM CSP-E-1 Rev 13/14/16, Section III
// (emergency, pp 3-3..3-15) and Section IV (normal, pp 4-12..4-27). Condensed simulator reference: inspections, timed
// sequences and judgements stay manual (no `live`). Live checks read the checklist frame (ui/checklistModel.ts):
// turbine.ng (N1 %), turbine.itt (TOT C), checklist.rotorPercent / enginePercent (Nr / N2 % of 477.7 rpm / 6016 rpm).
import { all, eq, ge, le } from '../../training/engine/dsl';
import { checklist, checkItem as i, type FlightChecklist } from '../../training/checklistData';

const normal = (id: string, title: string, page: string, items: FlightChecklist['items'], note?: string) =>
  checklist(id, title, items, { category: 'normal', source: `MD 500E RFM CSP-E-1 ${page}`, note });
const emergency = (id: string, title: string, page: string, items: FlightChecklist['items'], note?: string) =>
  checklist(id, title, items, { category: 'emergency', source: `MD 500E RFM CSP-E-1 ${page}`, note });

const down = i('collective', 'Collective', 'Full down, friction on', le('checklist.collective', 0.01));
const fuelOpen = i('fuelValve', 'Fuel shutoff valve', 'Open (pushed in)', eq('fuelSel', 'on'));
const genOn = i('genOn', 'Generator', 'ON; GEN OUT light out', eq('alternator', true));
const genOff = i('genOff', 'Generator', 'OFF', eq('alternator', false));
const flightRpm = i('flightRpm', 'N2 and Nr', '102–103 %, needles lying on each other',
  all(ge('checklist.enginePercent', 101.5), le('checklist.enginePercent', 103.5), ge('checklist.rotorPercent', 101.5), le('checklist.rotorPercent', 103.5)));
const noLights = i('lights', 'Caution and warning lights', 'All out; press PRESS TO TEST to check the lenses');

export const MD500_CHECKLISTS = {
  beforeStart: normal('beforeStart', 'Before start', '4-12–4-14', [
    i('belts', 'Doors, belts and pedals', 'Doors closed and locked; harness fitted; pedals adjusted and centred'),
    i('cyclic', 'Cyclic', 'About one third forward of full aft, centred, friction on'),
    down,
    i('light', 'Landing light', 'OFF', eq('lightLanding', false)),
    i('bleed', 'Bleed air devices', 'Cabin heat, anti-ice, scavenge air OFF (a hot start otherwise)'),
    i('vne', 'Vne card', 'Select the one for the loaded weight'),
    i('altimeter', 'Altimeter', 'Set', all(ge('qnhErrHpa', -0.5), le('qnhErrHpa', 0.5))),
    i('switches', 'Switches and radios', 'All OFF; circuit breakers in', eq('avionics', false)),
    fuelOpen,
    i('battery', 'Battery', 'ON (or ground power: 20 – 28.5 V)', eq('master', true)),
    i('warning', 'Warning lights before start', 'XMSN OIL PRESS, ENGINE OUT and GEN OUT are lit'),
    i('trim', 'Cyclic trim', 'Motor forward, left, right, aft; listen for the motor'),
    i('grip', 'Twist grip', 'Full open, back to the ground-idle stop, then to CUTOFF (the idle release)'),
  ]),
  engineStart: normal('engineStart', 'Engine start', '4-15–4-17', [
    i('recheck', 'Cyclic, collective, grip', 'Cyclic neutral, collective down, grip at CUTOFF'),
    genOff,
    i('pump', 'Start pump', 'ON for alternate or emergency fuel only'),
    i('clear', 'Rotors', 'Clear'),
    i('startPress', 'START button', 'Press and hold (1 min on, 1 off, 1 on, then 23 off)', ge('turbine.ng', 5)),
    i('idle', 'Grip to GROUND IDLE', 'At 12–15 % N1 (12 % in the cold)', ge('turbine.ng', 12)),
    i('watch', 'During the start', 'TOT must rise at once; oil pressure showing; rotor turning by 25 % N1; ammeter not zero. Otherwise abort'),
    i('tot', 'TOT', 'Peak under 810 °C (up to 10 s over, 927 °C for 1 s allowed)', le('turbine.itt', 927)),
    i('release', 'START button', 'Release at 58–60 % N1', all(ge('turbine.ng', 58), eq('starter', false))),
    i('oil', 'Oil pressure', '50–130 psi', ge('oilPsi', 50)),
    i('xmsn', 'XMSN OIL PRESS light', 'Out within 30 s of light-off; the RE-IGN light may come on then'),
    i('idleN1', 'Idle', '64–65 % N1', all(ge('turbine.ng', 63.5), le('turbine.ng', 65.5))),
    i('needles', 'N2 and Nr needles', 'Lying on each other (within half a needle width); otherwise shut down'),
  ], 'Abort: grip to CUTOFF, then keep motoring for at least 10 s or until TOT is below 150 °C.'),
  afterStart: normal('afterStart', 'After start', '4-17', [
    genOn,
    i('monitor', 'On switching GEN ON', 'If N1 falls below 60 % or TOT nears 810 °C: GEN OFF, raise N1 to 70 % with the grip, then GEN ON'),
    i('load', 'Charge current', 'Under 150 A before take-off (2 min limit after a battery start)'),
    i('avionics', 'Radios', 'ON and checked'),
    i('open', 'Twist grip', 'Full open (after 1 min at idle if the engine was off more than 15 min)', ge('turbine.ng', 80)),
    noLights,
  ]),
  runup: normal('runup', 'Run-up checks', '4-18–4-19', [
    i('reign', 'RE-IGN P RST', 'Press: light out'),
    i('beepHigh', 'N2 beep, high', 'Reaches 104–105 %'),
    i('beepLow', 'N2 beep, low', '98 % or less'),
    i('lowRotor', 'Low rotor warning', 'Comes on at 98 ± 1 %'),
    i('set', 'N2 set', '102 % for the checks, 103 % for take-off'),
    i('rig', 'Throttle rigging check', 'At 102 % snap the grip to idle: no flame-out. If it flames out close to CUTOFF, do not reopen'),
    flightRpm,
  ], 'The beep, warning and rigging checks are first-flight-of-the-day items.'),
  beforeTakeoff: normal('beforeTakeoff', 'Before take-off', '4-20–4-21', [
    noLights,
    i('oilp', 'Oil pressure', '90–130 psi', ge('oilPsi', 90)),
    i('amps', 'Ammeter', 'Reading, under 150 A'),
    i('doors', 'Doors', 'Closed and locked'),
    i('friction', 'Collective friction', 'Release; set as wanted'),
    i('response', 'Cyclic response', 'Collective down, move the cyclic gently and watch the rotor tip'),
    i('green', 'Instruments', 'All in the green'),
    i('positionLights', 'Position and anti-collision lights', 'As required'),
    flightRpm,
  ]),
  afterTakeoff: normal('afterTakeoff', 'Take-off and climb', '4-21–4-23', [
    i('clear', 'Take-off path', 'Clear; N2 103 %; lift to a hover and check torque, TOT and N1'),
    i('climb', 'Climb', 'Accelerate through the height-velocity avoid area; Vy is 62 KIAS'),
    i('power', 'Power', 'Torque 87.2 psi and TOT 810 °C for 5 min, N1 105 %; N2 may rise ½ to 1 % on power application, re-set it'),
    flightRpm,
  ]),
  afterLanding: normal('afterLanding', 'After landing', '4-25', [
    down,
    i('slope', 'On a slope', 'Centre the cyclic before reducing power'),
    i('idle', 'Grip', 'GROUND IDLE; keep the pedals centred (the bungee pulls the left pedal and pulls N2 down)', le('turbine.ng', 66)),
  ]),
  shutdown: normal('shutdown', 'Shutdown', '4-25–4-27', [
    down,
    i('settle', 'Ground idle', 'Two minutes', all(ge('turbine.ng', 63), le('turbine.ng', 66))),
    i('neutral', 'Cyclic', 'Neutral and friction on; pedals centred'),
    i('bleed', 'Bleed air and electrical loads', 'OFF'),
    i('cutoff', 'Twist grip', 'CUTOFF (the idle release): hold it there until N1 is zero', le('turbine.ng', 55)),
    i('split', 'Needles', 'Split at once with Nr lagging N2; if they do not, the freewheel needs maintenance'),
    i('engout', 'ENGINE OUT at 55 % N1', 'Light on (horn too while GEN is ON); RE-IGN P RST lit'),
    i('noBrake', 'Rotor', 'Never slow it with collective; brake at 205 rpm or less if fitted'),
    genOff,
    i('switches', 'Radios and all switches', 'OFF', eq('avionics', false)),
    i('afterfire', 'Afterfire', 'If TOT climbs fast after cutoff: starter on, keep motoring, close the fuel valve'),
  ]),
  engineFailure: emergency('engineFailure', 'Engine failure', '3-3–3-5', [
    i('collective', 'Collective', 'Adjust at once to hold Nr between 410 and 523 rpm (ENGINE OUT light and horn)', ge('checklist.rotorPercent', 85)),
    i('yaw', 'Yaw', 'Left yaw as torque goes: right pedal'),
    i('speed', 'Airspeed', 'Settle at 130 KIAS or less (check the Vne card); minimum descent rate 60 KIAS, maximum glide 80 KIAS'),
    i('confirm', 'Complete power loss confirmed', 'If time and height allow: grip to CUTOFF, fuel valve closed'),
    i('site', 'Landing area', 'Select; if you flew at low Nr to stretch the glide, restore Nr before the flare'),
    i('flare', 'Flare', 'Reduce speed and descent rate as the ground approaches; level the aircraft'),
    i('touch', 'Touch-down', 'Level, collective up to cushion; avoid aft cyclic and rapid collective down while sliding'),
  ], 'Below 500 ft AGL lower the collective first and follow the height-velocity diagram; hovering below 12 ft: do not lower the collective, right pedal, cushion.'),
  lowRotor: emergency('lowRotor', 'Low rotor speed', '3-7', [
    i('adjust', 'Collective', 'Adjust at once to bring Nr back within limits'),
    i('check', 'Other lights and engine instruments', 'Look for an engine problem and follow its procedure'),
    i('rpm', 'Nr', 'Back in the green 410–523 rpm', ge('checklist.rotorPercent', 85.8)),
  ], 'Low rotor lights at Nr below 468 rpm: engine failure, a rapid large power increase, or a governor underspeed.'),
  governorFailure: emergency('governorFailure', 'Fuel control or N2 governor failure', '3-14–3-15', [
    i('over', 'Overspeed (torque, TOT, N1, N2 all rising)', 'Raise collective to load the rotor and roll the grip toward ground idle until you control N2'),
    i('manual', 'Manual control', 'Hold N2 at 102–103 % with the pilot grip', all(ge('checklist.enginePercent', 101.5), le('checklist.enginePercent', 103.5))),
    i('cutoff', 'Cannot hold it', 'Grip to CUTOFF and autorotate; do not lower the collective until Nr is back in range'),
    i('under', 'Underspeed (N2 and Nr falling)', 'Lower collective to keep Nr in the green and fly level at 60 KIAS'),
    i('land', 'Not enough power for level flight', 'Make an autorotative landing'),
  ]),
  generator: emergency('generator', 'Generator malfunction', '3-25', [
    i('check', 'GEN OUT light on, ammeter zero', 'Generator breaker in; switch back ON if it tripped'),
    i('reset', 'Reset', 'GEN OFF then ON'),
    i('stay', 'Light stays on or returns', 'Pull the generator breaker, switch ON for the rest of the flight (the horn needs it)'),
    i('land', 'Still out', 'Cut electrical load; land as soon as practical'),
  ]),
} satisfies Record<string, FlightChecklist>;
