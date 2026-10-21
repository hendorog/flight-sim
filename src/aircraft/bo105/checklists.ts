// MBB Bo 105 CB-4 checklists, PARAPHRASED (not copied) from the BO 105 CB-5/CBS-5 Flight Manual used for the CB-4 (P5):
// Section 3 (emergency and malfunction, printed pp 3-1..3-45) and Section 4 (normal, pp 4-8..4-18). Condensed simulator
// reference: inspections, timed sequences and judgements stay manual (no `live`). Live checks read the checklist frame
// (ui/checklistModel.ts), which is evaluated PER ENGINE for a twin (checklistFrame(ctx, engine)): `throttle` is that
// engine's power lever (OFF below 0.05, IDLE 0.25, FLIGHT 1; facts.ts), turbine.ng its N1 %, turbine.itt its TOT C,
// checklist.enginePercent its N2 % and checklist.rotorPercent the rotor's NR %. Comparing the two torques ("synchronise")
// needs both engines at once, so it stays manual.
import { all, eq, ge, le, not } from '../../training/engine/dsl';
import { checklist, checkItem as i, type FlightChecklist } from '../../training/checklistData';
import { BO105_NR_PCT, BO105_POWER_LEVER, BO105_TOT_C } from './facts';

const normal = (id: string, title: string, page: string, items: FlightChecklist['items'], note?: string) =>
  checklist(id, title, items, { category: 'normal', source: `BO 105 CB-5/CBS-5 FM ${page} (used for the CB-4)`, note });
const emergency = (id: string, title: string, page: string, items: FlightChecklist['items'], note?: string) =>
  checklist(id, title, items, { category: 'emergency', source: `BO 105 CB-5/CBS-5 FM ${page} (used for the CB-4)`, note });

const down = i('collective', 'Collective', 'Full down (lock engaged when parked)', le('checklist.collective', 0.01));
const leverOff = i('leversOff', 'Power levers', 'OFF', le('throttle', BO105_POWER_LEVER.cutoffBelow));
const leverIdle = i('leversIdle', 'Power levers', 'IDLE (locked in the gate)', all(ge('throttle', 0.2), le('throttle', 0.3)));
const leverFlight = i('leversFlight', 'Power levers', 'FLIGHT, moved smoothly', ge('throttle', 0.95));
const pumps = i('fuelPump', 'Fuel pumps', 'SUPPLY TANK pump of each engine ON (and the main-tank pumps)', eq('fuelPump', true));
const valves = i('fuelSelector', 'Emergency fuel valves', 'Guarded switches closed over the OPEN position', not(eq('fuelSel', 'off')));
const nrNormal = all(ge('checklist.rotorPercent', BO105_NR_PCT.powerOn[0] - 0.5), le('checklist.rotorPercent', BO105_NR_PCT.powerOn[1] + 0.5));
const n2Normal = all(ge('checklist.enginePercent', BO105_NR_PCT.powerOn[0] - 0.5), le('checklist.enginePercent', BO105_NR_PCT.powerOn[1] + 0.5));
const nrPowerOff = all(ge('checklist.rotorPercent', BO105_NR_PCT.powerOff[0]), le('checklist.rotorPercent', BO105_NR_PCT.powerOff[1]));
const noLights = i('lights', 'Warning and caution lenses', 'All out (OIL COOL may stay lit until the levers are at FLIGHT); LAMP TEST checks the lenses');

export const BO105_CHECKLISTS = {
  beforeStart: normal('beforeStart', 'Before start', '4-8–4-11', [
    i('walkround', 'Exterior and interior inspection', 'Done; seats, belts and pedals set; doors closed and locked'),
    i('switchesOff', 'Switch panel, overhead panel and collective head', 'All switches OFF; circuit breakers as needed; guards closed'),
    leverOff,
    down,
    i('locks', 'Cyclic lock and collective lock', 'Cyclic lock stowed; collective lock released; controls free over the full travel'),
    i('battery', 'Battery', 'ON (24 V minimum; with external power 24 – 28 V)', eq('master', true)),
    i('lampTest', 'Warning and caution lights', 'Press LAMP TEST: all come on except both F lights, MM LIMIT and LOW FUEL'),
    i('fireTest', 'Fire warning and mast-moment indicator', 'Press each F lens and hold MM TEST; the needle runs to LIMIT and the lamp lights'),
    i('lowFuelTest', 'LOW FUEL and fuel quantity', 'Test the LOW FUEL lamp; read the supply and main tank quantities'),
    pumps,
    valves,
    i('hydraulics', 'Hydraulics', 'System 2 preselected as the operating system with the collective lock engaged; do not take off on it'),
    i('beacon', 'Anti-collision light', 'ON', eq('lightBeacon', true)),
  ]),
  engineStart: normal('engineStart', 'Engine start (each engine in turn)', '4-12–4-14', [
    i('clear', 'Rotor area and fire guard', 'Clear and posted; operate only the controls of the engine being started'),
    leverOff,
    i('ignition', 'IGNITION', 'ON for the engine', ge('mags', 1)),
    i('starter', 'STARTER/GENERATOR', 'START; start the clock; N1 must rise', ge('turbine.ng', 5)),
    i('lever', 'Power lever', 'At 12 – 15 % N1 move it smoothly to just short of IDLE, then lock it in IDLE', ge('turbine.ng', 12)),
    i('watch', 'During the start', 'TOT peak under 927 °C and not more than 10 s above 810; the rotor turning by 25 % N1; oil pressure positive; idle reached within 60 s'),
    i('release', 'Starter and ignition', 'OFF at 58 % N1', all(ge('turbine.ng', 58), eq('starter', false))),
    i('idle', 'Idle', 'N1 59 – 65 %, NR about 60 %', all(ge('turbine.ng', 58.5), le('turbine.ng', 65.5))),
    i('oil', 'Engine oil pressure', 'Positive, at least 3.5 kp/cm² at idle', ge('oilPsi', 3.5 / 0.070307)),
    i('gen', 'Generator', 'ON above 40 % N2 / NR; if N1 falls under 59 %: GEN OFF, N1 to 70 % with the lever, GEN ON', eq('alternator', true)),
    i('second', 'Second engine', 'Same sequence; the ammeter under 100 A first (battery start)'),
  ], `Abort the start if the rotor is not turning at 25 % N1, TOT runs toward ${BO105_TOT_C.start} °C, there is no oil pressure at idle or the start stagnates: lever OFF, pumps OFF, ignition OFF, starter on until TOT is under 150 °C.`),
  afterStart: normal('afterStart', 'System checks', '4-14–4-15', [
    i('hyd2', 'Hydraulic system 2', 'HYD 2 out at ground idle; cyclic and collective move freely through the cross-over and system-1 checks'),
    i('gens', 'Generators', 'Both GEN lights out; the load meters about equal; leave the selector on BUS BAR'),
    i('anti', 'Engine anti-ice', 'If fitted: ANTI ICING lights on with TOT up about 15 °C, then off'),
    noLights,
  ]),
  runup: normal('runup', 'Pre-take-off check', '4-16', [
    i('passengers', 'Crew and passengers', 'Briefed, belted; doors closed and locked'),
    i('idle1min', 'If shut down for more than 15 min', 'Stabilise at IDLE for one minute first'),
    leverFlight,
    i('oilCool', 'OIL COOL', 'Out once the levers are at FLIGHT'),
    i('n2', 'N2', 'Trim to 98 % (ENGINE TRIM fore / aft); 100 % is recommended for steady flight', n2Normal),
    i('torque', 'Torque', 'Synchronise the two engines (ENGINE TRIM left / right)'),
    i('green', 'Engine and transmission instruments', 'In the green; fuel quantity checked'),
    i('friction', 'Collective lock and friction', 'Lock released; friction as wanted'),
    noLights,
  ]),
  beforeTakeoff: normal('beforeTakeoff', 'Hover check', '4-16', [
    i('hoverTorque', 'In the hover', 'Torque synchronised; hover power within limits'),
    i('hoverNr', 'N2 / NR', 'Adjust to 98 – 102 %; 100 % is recommended', nrNormal),
    i('green', 'Instruments', 'In the green; lights out'),
  ]),
  afterTakeoff: normal('afterTakeoff', 'Take-off and climb', '4-17, 5', [
    i('profile', 'Take-off', 'Hover at 3 ft, power smoothly to take-off; 50 ft and 50 KIAS, then accelerate to Vy 60 KIAS'),
    i('limits', 'Power', 'Each torque 86 %, TOT 810 °C (779 – 810 is limited to 5 min), N1 105 %, N2 102 %'),
    i('nr', 'N2 / NR', 'Re-trim to 98 – 102 % as the power comes on', nrNormal),
  ]),
  cruise: normal('cruise', 'Cruise and landing', '4-17', [
    i('cruise', 'Normal cruise', 'Recommended maxima 82 % torque and 738 °C TOT', le('turbine.itt', BO105_TOT_C.cruiseGuide)),
    i('rpm', 'N2 / NR', '98 – 102 %; 100 % recommended for landing', nrNormal),
    i('slope', 'On a slope', 'Mast-moment indicator working: left-down 15°, right-down 8°, nose-down 8°, tail-down 10°. Watch the pointer and keep it out of LIMIT'),
  ]),
  afterLanding: normal('afterLanding', 'After landing', '4-17', [
    down,
    i('lock', 'Collective lock', 'Engage'),
    leverIdle,
  ]),
  shutdown: normal('shutdown', 'Shutdown', '4-17', [
    down,
    leverIdle,
    i('idle2', 'At IDLE', 'Two minutes (timed: tick it yourself)'),
    i('trim', 'Cyclic trim and lock', 'Trim neutral; cyclic lock engaged; consumers off except anti-collision light and fuel pumps'),
    leverOff,
    i('falling', 'TOT and N1', 'Falling; if TOT does not fall with N1, close the emergency fuel valve and ventilate', le('turbine.ng', 55)),
    i('pumpsOff', 'Fuel pumps', 'OFF', eq('fuelPump', false)),
    i('gensOff', 'Generators', 'OFF', eq('alternator', false)),
    i('oilCool', 'OIL COOL', 'Lights below 20 % NR'),
    i('battery', 'Battery', 'Keep it ON until the rotor has stopped, then switch everything off'),
  ]),
  deceleration: normal('deceleration', 'Deceleration check (first flight of the day)', '4-18', [
    i('prep', 'Preparation', 'Trim neutral, collective lock, consumers and generators off, N2 stable at 100 % for 15 s'),
    i('snap', 'Snap the lever', 'Check engine to IDLE with the clock running: at least 2 s from FLIGHT to 65 % N1'),
    i('floor', 'N1', 'Must stay above 59 % with no flame-out; otherwise maintenance'),
    i('other', 'Other engine', 'Repeat; then both levers to FLIGHT, later IDLE two minutes and OFF'),
  ]),
  engineFailure: emergency('engineFailure', 'Single engine failure', '3-20–3-25 (3.3.1–3.3.6)', [
    i('indications', 'Indications', 'RPM light (N1 SPLIT), GEN light of the failed engine, power-loss cues'),
    i('collective', 'Collective', 'Adjust to the OEI limits (95 % torque) or below; hover: landing attitude and cushion; OGE or flight: gain airspeed'),
    i('speed', 'Flight', 'Transition to OEI flight at Vy 60 KIAS'),
    i('shutdown', 'Single-engine emergency shutdown', 'Affected lever IDLE then OFF; emergency fuel valve closed; supply pump OFF'),
    i('land', 'Landing', 'As soon as practicable: shallow approach at 60 KIAS, on final about 40 KIAS and 300 ft/min, reduce speed as power allows and cushion'),
  ], 'OEI emergency power (95 % torque, TOT 810 °C, 30 min) is for an actual failure only; training is limited to OEI maximum continuous.'),
  powerFailure: emergency('powerFailure', 'Double engine failure and autorotation', '3-33–3-37 (3.3.15–3.3.18)', [
    i('indications', 'Indications', 'Left yaw, N1 and both N2 falling, NR LOW warning, both GEN lights'),
    i('lower', 'Collective', 'Full down at once; keep NR within the limits 85 – 110 %', all(le('checklist.collective', 0.02), nrPowerOff)),
    i('yaw', 'Yaw', 'Right pedal as needed to stop the left yaw'),
    i('speed', 'Airspeed', '75 KIAS recommended; minimum descent 60 KIAS at 100 % NR; maximum range 100 KIAS at 85 % NR', all(ge('kias', 68), le('kias', 82))),
    i('shutdown', 'Double engine emergency shutdown', 'Both levers OFF; both emergency fuel valves closed; both supply pumps OFF'),
    i('flare', 'Flare', 'At about 100 ft AGL: nose up 15 – 25° controlling NR; at 6 – 10 ft reduce to about 5°'),
    i('touch', 'Touch-down', 'Hold heading, raise the collective to cushion; battery OFF when stopped'),
  ], 'Hover: right pedal against the left yaw, landing attitude, lower the collective then raise it to cushion.'),
  lowRpm: emergency('lowRpm', 'RPM warning light', '3-16', [
    i('split', 'N1 SPLIT (12 % or more)', 'Collective to the OEI limits or below; analyse. If residual torque remains leave the engine running, otherwise do the single-engine shutdown. The light can come on during beep trim: match N1'),
    i('low', 'NR LOW (95 % or less, beeping tone)', 'Adjust the collective to bring NR back into the normal range', ge('checklist.rotorPercent', BO105_NR_PCT.transientMin)),
    i('high', 'NR HIGH (103 % or more; steady tone at 108 %)', 'Adjust the collective to keep NR in range', le('checklist.rotorPercent', BO105_NR_PCT.powerOn[1] + 1)),
  ]),
  governorFailure: emergency('governorFailure', 'Governor failure, overspeed or underspeed', '3-27–3-29 (3.3.8–3.3.10)', [
    i('over', 'Overspeed (torque, N1 and TOT rising on one engine)', 'Collective to the OEI limits; identify the engine; its lever toward IDLE until N1 and NR settle in the normal range; land as soon as practicable'),
    i('shaft', 'Driveshaft failure (torque zero, N1 down, N2 up)', 'Collective to the OEI limits; identify; single-engine shutdown'),
    i('under', 'Underspeed (torque, N1 and TOT falling, the other engine compensating)', 'Collective to the OEI limits; identify; ENGINE TRIM to compensate NR; with no residual torque shut it down'),
    i('droop', 'Droop compensation failure (NR falls when the collective rises)', 'Avoid large collective changes, hold NR with the collective, land as soon as practicable'),
  ]),
  restart: emergency('restart', 'In-flight restart', '3-26 (3.3.7)', [
    i('when', 'When', 'Not after a mechanical failure; avoid 1 – 10 min after a flame-out (the gas producer can lock) except in an emergency'),
    i('prep', 'Lever and switches', 'Lever OFF, STARTER/GEN OFF, emergency fuel valve OPEN, supply pump ON, IGNITION ON'),
    i('start', 'Start', 'STARTER/GEN to START and hold; at 12 – 15 % N1 lever to IDLE; watch TOT, N1 and oil pressure'),
    i('release', 'At 58 % N1', 'Starter and ignition OFF, GEN ON, lever to FLIGHT; land as soon as practicable'),
  ]),
  tailRotor: emergency('tailRotor', 'Tail rotor drive failure', '3-39–3-41 (3.5.1–3.5.2)', [
    i('hover', 'Hover', 'Rapid uncontrolled RIGHT yaw: collective full down and landing attitude; OGE: gain airspeed if height allows, shut down, cushion'),
    i('flight', 'Flight', 'Right yaw, then right roll and nose-down; collective full down, 75 KIAS, double engine shutdown, modified side flare, cushion'),
  ]),
  hydraulic: emergency('hydraulic', 'Hydraulic malfunction', '3-9–3-11', [
    i('block', 'HY BLOCK', 'A servo jam crossed over to system 2: more force on one axis; land as soon as practicable; no HYDR TEST in flight'),
    i('hyd1', 'HYD 1', 'System 1 lost, cross-over to system 2: land as soon as practicable'),
    i('hyd2', 'HYD 2', 'System 1 keeps the controls powered: land as soon as practicable, no abrupt manoeuvres, bank 30° or less'),
  ]),
  engineFire: emergency('engineFire', 'Engine fire (F light)', '3-5', [
    i('valve', 'Emergency fuel valve', 'Affected engine: CLOSED'),
    i('pump', 'Supply tank fuel pump', 'Affected engine: OFF'),
    i('lever', 'Power lever', 'Affected engine: OFF'),
    i('land', 'Land', 'As soon as possible'),
  ]),
  electrical: emergency('electrical', 'Generator and battery', '3-3–3-8', [
    i('gen', 'GEN light (one generator, voltmeter normal 27 – 29 V)', 'One generator is enough; the auxiliary bus sheds. Reset with GEN RES'),
    i('both', 'Both GEN lights', 'Battery only: the endurance is limited and the fuel pumps are lost, so only the supply-tank fuel can be used'),
    i('bat60', 'BAT 60 / BAT 70', 'Battery temperature over 60 / 70 °C: battery OFF; land as soon as practicable / as soon as possible'),
  ]),
  lowFuel: emergency('lowFuel', 'LOW FUEL and transmission oil', '3-13, 3-17', [
    i('fuel', 'LOW FUEL (supply tank under 60 kg, main pumps failed or main tank empty)', 'Land within 10 minutes'),
    i('xmsnP', 'T OIL, pressure 0.5 kp/cm² or less', 'Land immediately, descending with minimum power'),
    i('xmsnT', 'T OIL, temperature 105 °C or more', 'Reduce power, fly the highest speed at minimum power, land as soon as possible'),
  ]),
} satisfies Record<string, FlightChecklist>;
