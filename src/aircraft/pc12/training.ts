// Pilatus PC-12/47 (PT6A-67B, 4740 kg): the Flight School's type data (V-speeds, settings, flap detents, limits, checklists,
// safety envelope). Data only (contract 3.9): the school does not teach in this type, but the instructor's wording, the
// checklists of the free-flight cards and the logbook read it. Speeds come from ./reference (the same table the HUD, the
// scenarios and the autoflight use). Checklist wording is PARAPHRASED from the 47E POH section 4 (47E-PROXY, see
// checklists.ts); SCHOOL marks common practice that is not POH.
//
// The quadrant is the real one (docs/pc12-panel.md): power control lever = throttle (0 IDLE; beta and reverse aft of the gate
// are ControlInputs.reverse), condition lever = mixture (below 0.1 CUT-OFF / FEATHER, GROUND IDLE, 0.95+ FLIGHT IDLE), NO
// propeller lever (the propeller is governed at 1700 rpm), no fuel selector, one STARTER press latches the start. Items over a
// control or an indication the simulator does not have (MOR, the pusher test, rudder trim marks) have `state: null`.

import { citeChecklists } from '../../training/checklistData';
import { all, ge, le, lt, eq } from '../../training/engine/dsl';
import type {
  AircraftSettingId, AircraftTypeDef, ChecklistDef, ChecklistId, ChecklistItem, ChecklistKeyPair, CueRef, PointTarget, Pred, SafetyEnvelope, VSpeedId,
} from '../../training/types';
import { C208 } from '../c208/training';
import { PC12_CHECKLIST_SOURCE, PC12_EXTRA_CHECKLISTS } from './checklists';
import { PC12_FLAP_DETENTS_DEG, PC12_NP_GOVERNED } from './facts';
import { PC12_APPROACH_KIAS, PC12_DEMO_CROSSWIND_KT, PC12_REFERENCE } from './reference';

const R = PC12_REFERENCE;

/** Flap detents (degrees) and the ControlInputs.flaps lever value of each: UP, 15, 30, 40 (47E-PROXY 7-3). */
const FLAP_DETENTS_DEG = [...PC12_FLAP_DETENTS_DEG];
const FLAP_LEVER: Record<number, number> = Object.fromEntries(FLAP_DETENTS_DEG.map((d) => [d, d / 40]));

/**
 * Speeds, KIAS. The shared ones are the reference table's. `Vs1` is the flaps-UP stall (stick-pusher) speed, 95 (47E-PROXY
 * 5.2, PC12_PUSHER_KIAS[0]); Vr (82) is quoted at the flaps-15 take-off setting, whose pusher speed is 78. The airplane
 * stall is defined by pusher activation. There is no Vno: Vno = Vne = Vmo (no yellow arc).
 */
const VSPEEDS: Record<VSpeedId, number> = {
  Vs0: R.vs0,
  Vs1: R.vs1,
  Vr: R.vr,
  Vx: R.vx,
  Vy: R.vy,
  Vcc: 140, // cruise climb (SCHOOL)
  Vglide: R.vglide,
  Va: R.va,
  Vfe10: R.vfe[0], // the 15-degree detent
  VfeFull: R.vfe[R.vfe.length - 1],
  Vno: R.vno,
  Vne: R.vne,
  Vapp: R.vapp, // flaps 15
  VappFlapsUp: PC12_APPROACH_KIAS[0], // flaps UP approach
  Vref: R.vref, // flaps 40
  VshortField: R.vref,
  Vcruise: R.vcruise,
  Vslow: 100, // slow flight, flaps UP: above the 95 pusher speed (SCHOOL)
  VsteepTurn: 140, // SCHOOL, below Va
  Vdescent: 180, // cruise descent (SCHOOL)
  Vdownwind: R.vdownwind,
  Vtaxi: 12, // ground speed, kt (beta taxi)
};

/** The school's eleven settings. The rpm ones are propeller rpm: governed at 1700 throughout (no propeller lever). No magnetos. */
const SETTINGS: Record<AircraftSettingId, number> = {
  patternAglFt: 1500,
  cruiseRpm: PC12_NP_GOVERNED,
  descentRpm: PC12_NP_GOVERNED,
  circuitRpm: PC12_NP_GOVERNED,
  runupRpm: PC12_NP_GOVERNED,
  magDropMaxRpm: 0,
  magDiffMaxRpm: 0,
  approachFlapLever: FLAP_LEVER[40],
  takeoffFlapLever: FLAP_LEVER[15],
  shortFieldFlapLever: FLAP_LEVER[15],
  maxDemoCrosswindKt: PC12_DEMO_CROSSWIND_KT[15],
};

const ENVELOPE: SafetyEnvelope = {
  maxBankDeg: 60,
  maxPitchUpDeg: 25,
  maxPitchDownDeg: -25,
  maxKias: VSPEEDS.Vno + 5,
  maxG: 3.0,
  minG: 0,
  minAglFt: 1000,
  // Vs0 + 10 = 77 KIAS (AGENT choice): the PC-12's normal approach speeds sit BELOW the flaps-up stall speed (Vref 85 at
  // flaps 40, Vapp 99 at flaps 15, Vs1 95), so the other types' Vs1 + 5 (100) would call "low and slow" on every normal
  // final. 77 is 8 kt under Vref and 1 kt under the flaps-15 pusher speed (78, 47E-PROXY 5.2).
  lowAndSlow: { aglFt: 300, belowKias: { vspeed: 'Vs0', add: 10 } },
  maxSinkFpmBelow200: 1000,
  stallAllowed: false,
  runwayExcursionM: 15,
};

// ---- checklists ------------------------------------------------------------------------------------------------

interface ItemSpec extends Omit<ChecklistItem, 'id' | 'challenge' | 'response' | 'control' | 'state' | 'key' | 'why' | 'check'> {
  control: PointTarget | null;
  state: Pred | null;
  key: string | null | ChecklistKeyPair;
  why: CueRef;
}
const item = (id: string, challenge: string, response: string, spec: ItemSpec): ChecklistItem => {
  const out: ChecklistItem = { id, challenge, response, ...spec };
  if (spec.state) out.check = spec.state;
  return out;
};
const why = (text: string): CueRef => ({ text });
const POWER_KEYS: ChecklistKeyPair = { raise: 'throttleUp', lower: 'throttleDown' };
const CONDITION_KEYS: ChecklistKeyPair = { raise: 'mixtureRich', lower: 'mixtureLean' };
const TRIM_KEYS: ChecklistKeyPair = { raise: 'trimNoseUp', lower: 'trimNoseDown' };

/** Condition lever (ui.ts PC12_CONDITION): CUT-OFF below 0.05 (a lever at the GND IDLE detent, 0.1, clears it), GND IDLE 0.1-0.5, FLT IDLE 0.95+. */
const conditionCutoff: Pred = lt('mixture', 0.05);
const conditionGndIdle: Pred = all(ge('mixture', 0.1), lt('mixture', 0.5));
const conditionFltIdle: Pred = ge('mixture', 0.95);

const parkingBrakeSet = item('parkingBrake', 'Parking brake', 'Set', {
  control: 'parkingBrake', state: eq('parkingBrake', true), key: 'parkingBrake',
  why: why('Parking brake set: even at idle a turboprop pulls hard.') });
const powerIdle = item('powerIdle', 'Power lever', 'IDLE', {
  control: 'throttle', state: lt('throttle', 0.02), key: 'throttleIdle',
  why: why('Power lever on the idle gate: the engine must not surge when the fuel lights.') });
const conditionCutoffItem = item('conditionCutoff', 'Condition lever', 'CUT-OFF / FEATHER', {
  control: 'mixture', state: conditionCutoff, key: 'mixtureLean', critical: true,
  why: why('Condition lever at cut-off: no fuel reaches the engine and the propeller is feathered.') });
const conditionGndIdleItem = item('conditionGndIdle', 'Condition lever', 'GROUND IDLE', {
  control: 'mixture', state: conditionGndIdle, key: CONDITION_KEYS, stateLabel: 'GND IDLE',
  why: why('Ground idle: low Ng, the propeller in beta, easy to taxi.') });
const conditionFltIdleItem = item('conditionFltIdle', 'Condition lever', 'FLIGHT IDLE', {
  control: 'mixture', state: conditionFltIdle, key: 'mixtureRich', critical: true, stateLabel: 'FLT IDLE',
  why: why('Flight idle: higher Ng and the governed propeller, ready for full power.') });
const fuelPumpsOn = item('fuelPump', 'Fuel pumps', 'ON', {
  control: 'fuelPump', state: eq('fuelPump', true), key: 'fuelPump',
  why: why('Fuel pumps on: pressure to the engine pump for the start.') });
const landingLightOn = item('landingLight', 'Landing lights', 'On', {
  control: 'landingLight', state: eq('lightLanding', true), key: 'landingLight',
  why: why('Landing lights on: we are much easier to see.') });
const gearDown = item('gear', 'Landing gear', 'Down: three greens', {
  control: null, state: null, key: 'gearDown', critical: true, stateLabel: 'DOWN, 3 GREEN',
  why: why('Gear down and locked: three greens and the red unsafe light out.') });
const lookout = item('lookout', 'Lookout', 'Clear', {
  control: null, state: null, key: null, lookout: true,
  why: why('A clearing turn: look all round, above and below, before we manoeuvre.') });
const ittMonitor = item('itt', 'ITT', 'Monitor: 1000 °C for 5 s at most', {
  control: null, state: null, key: null, stateLabel: '1000 °C MAX',
  why: why('Watch ITT through the light-off: a hot start ruins the turbine in seconds.') });

const list = (id: ChecklistId, title: string, items: ChecklistItem[]): ChecklistDef => ({ id, title, items });

const CHECKLISTS: Record<ChecklistId, ChecklistDef> = {
  beforeStart: list('beforeStart', 'Before starting engine', [
    parkingBrakeSet,
    item('breakers', 'Circuit breakers', 'Check in', { control: null, state: null, key: null, why: why('A tripped breaker now means a fault before we even start.') }),
    item('avionicsOff', 'Avionics', 'Off', { control: 'avionics', state: eq('avionics', false), key: 'avionics', why: why('Avionics off for the start: the starter draws the battery down.') }),
    item('master', 'Battery switch', 'On', { control: 'master', state: eq('master', true), key: 'masterSwitch', why: why('Battery on: it powers the starter, the pumps and the engine display.') }),
    fuelPumpsOn,
    item('beacon', 'Beacon', 'On', { control: 'beacon', state: eq('lightBeacon', true), key: 'beacon', why: why('Beacon on: it warns anyone outside that the engine is about to start.') }),
    powerIdle,
    conditionCutoffItem,
    item('ignition', 'Ignition switch', 'AUTO', { control: 'magnetos', state: null, key: null, stateLabel: 'AUTO', why: why('Ignition AUTO: the igniters spark by themselves while the starter runs.') }),
  ]),
  engineStart: list('engineStart', 'Starting engine', [
    item('propArea', 'Propeller area', 'Clear', { control: null, state: null, key: null, why: why('Nobody near the propeller or the exhausts: look both sides and call "clear".') }),
    item('starterOn', 'Starter', 'Press once: Ng rising', { control: null, state: ge('turbine.ng', 12), key: 'starter', stateLabel: 'START', why: why('One press latches the starter; it spins the gas generator.') }),
    item('oilPressure', 'Oil pressure', 'Rising', { control: 'oil', state: ge('oilPsi', 5), key: null, why: why('No oil pressure as Ng rises: abort the start before the engine is damaged.') }),
    item('conditionStart', 'Condition lever', 'GROUND IDLE at 13 % Ng', { control: 'mixture', state: all(ge('turbine.ng', 12), conditionGndIdle), key: 'mixtureRich', critical: true, stateLabel: 'GND IDLE', why: why('Fuel only with enough airflow: too early, too slow, and the start runs hot.') }),
    ittMonitor,
    item('starterOff', 'Starter', 'Cuts out at 50 % Ng', { control: null, state: all(ge('turbine.ng', 48), eq('starter', false)), key: null, stateLabel: 'OFF', why: why('At 50 percent the engine runs on its own; the starter drops out.') }),
  ]),
  afterStart: list('afterStart', 'After starting engine', [
    item('generators', 'Generators', 'On, check charge', { control: 'alternator', state: eq('alternator', true), key: 'alternator', stateLabel: 'ON', why: why('Generators on: they now recharge the battery the start drained.') }),
    item('engineInstruments', 'Engine instruments and CAWS', 'Ng at idle, ITT and oil in limits, CAWS clear', { control: 'oil', state: null, key: null, why: why('Stable at idle: Ng, ITT, oil pressure and temperature all in their limits.') }),
    item('avionicsOn', 'Avionics', 'On', { control: 'avionics', state: eq('avionics', true), key: 'avionics', why: why('Avionics on now: the start is over, so they are safe.') }),
    item('navLights', 'Navigation lights', 'On', { control: 'navLights', state: eq('lightNav', true), key: 'navLights', why: why('Navigation lights on: other traffic can see us.') }),
    item('flapsUp', 'Flaps', 'Up', { control: 'flapLever', state: lt('flapsDeg', 1), key: 'flapsUp', why: why('Flaps up for taxiing: they are out of the way of propeller spray.') }),
  ]),
  runup: list('runup', 'Engine run-up', [
    parkingBrakeSet,
    item('runupPower', 'Power lever', 'About 25 psi torque', { control: 'throttle', state: all(ge('turbine.torqueFtLb', 1500), le('turbine.torqueFtLb', 2700)), key: POWER_KEYS, stateLabel: '25 PSI', why: why('Enough load to check the engine without the aircraft moving.') }),
    item('engineInstruments', 'Engine instruments', 'In limits; Np about 1700 rpm governed', { control: 'oil', state: null, key: null, why: why('Torque, ITT, Ng and oil in limits before we ask for full power.') }),
    item('pusherTest', 'Stick pusher test', 'As the POH requires', { control: null, state: null, key: null, why: why('The pusher test proves the stall protection works before flight.') }),
    powerIdle,
  ]),
  beforeTakeoff: list('beforeTakeoff', 'Before take-off', [
    item('controls', 'Flight controls', 'Free and correct', { control: 'yoke', state: null, key: null, why: why('Full and free, the right way: a jammed or crossed control is found now.') }),
    item('instruments', 'Flight instruments', 'Set', { control: 'ai', state: null, key: null, why: why('Altimeter set, heading aligned with the compass, attitude erect.') }),
    item('trim', 'Trim', 'Elevator and rudder trim to take-off', { control: 'trimWheel', state: null, key: TRIM_KEYS, stateLabel: 'TAKE-OFF', why: why('Rudder trim set for the torque yaw, or the roll fights us.') }),
    item('flaps', 'Flaps', '15', { control: 'flapLever', state: all(ge('flapsDeg', 14), le('flapsDeg', 16)), key: 'flapsDown', critical: true, stateLabel: '15°', why: why('Flaps 15 is the take-off setting: shorter run, lower rotation speed.') }),
    conditionFltIdleItem,
    fuelPumpsOn,
    item('strobes', 'Strobes', 'On', { control: 'strobes', state: eq('lightStrobe', true), key: 'strobes', why: why('Strobes on as we enter the runway, so we are seen.') }),
    landingLightOn,
    item('parkingBrakeOff', 'Parking brake', 'Off', { control: 'parkingBrake', state: eq('parkingBrake', false), key: 'parkingBrake', why: why('Parking brake off, or we will not roll on the take-off.') }),
  ]),
  afterTakeoff: list('afterTakeoff', 'After take-off', [
    item('gearUp', 'Landing gear', 'Up, positive rate', { control: null, state: null, key: 'gearUp', stateLabel: 'UP', why: why('Gear up once we are climbing: it cuts the drag.') }),
    item('flapsUp', 'Flaps', 'Up above 100 KIAS', { control: 'flapLever', state: lt('flapsDeg', 1), key: 'flapsUp', why: why('Flaps up once above 100 knots and climbing: less drag, a better climb.') }),
    item('climbPower', 'Power lever', 'Climb: 36.95 psi max, ITT 760 °C max', { control: 'throttle', state: null, key: POWER_KEYS, stateLabel: 'CLIMB TORQUE', why: why('Climb power: torque at its limit low down, ITT the limit higher up.') }),
    item('engineInstruments', 'Engine instruments', 'In limits', { control: 'oil', state: null, key: null, why: why('Torque, ITT, Ng and oil: check them as the climb settles.') }),
  ]),
  hasell: list('hasell', 'HASELL', C208.checklists.hasell.items),
  downwind: list('downwind', 'Before landing', [
    item('brakes', 'Brakes', 'Off, pressure checked', { control: 'parkingBrake', state: eq('parkingBrake', false), key: 'parkingBrake', stateLabel: 'OFF', why: why('Brakes off and firm: landing with the parking brake on bursts tyres.') }),
    gearDown,
    conditionFltIdleItem,
    item('flapsApproach', 'Flaps', '15 below 163 KIAS; 99 KIAS on base', { control: 'flapLever', state: null, key: 'flapsDown', stateLabel: '15', why: why('Flaps 15 for the approach: below 163 knots only.') }),
    item('harnesses', 'Doors and harnesses', 'Secure', { control: null, state: null, key: null, why: why('Harnesses tight and doors shut before the landing.') }),
    landingLightOn,
  ]),
  final: list('final', 'Final', [
    gearDown,
    item('flapsLanding', 'Flaps', '40 below 130 KIAS', { control: 'flapLever', state: ge('flapsDeg', 39), key: 'flapsDown', stateLabel: '40', why: why('Full flap below 130 knots: 85 knots over the fence.') }),
    item('runwayClear', 'Runway', 'Clear', { control: null, state: null, key: null, why: why('Nobody on the runway: if it is not clear, we go around.') }),
  ]),
  afterLanding: list('afterLanding', 'After landing', [
    item('flapsUp', 'Flaps', 'Up', { control: 'flapLever', state: lt('flapsDeg', 1), key: 'flapsUp', why: why('Flaps up once clear of the runway: they are not needed to taxi.') }),
    conditionGndIdleItem,
    item('strobesOff', 'Strobes', 'Off', { control: 'strobes', state: eq('lightStrobe', false), key: 'strobes', why: why('Strobes off on the ground: they dazzle other pilots.') }),
    item('landingLightOff', 'Landing lights', 'Off', { control: 'landingLight', state: eq('lightLanding', false), key: 'landingLight', why: why('Landing lights off off the runway: they dazzle.') }),
  ]),
  shutdown: list('shutdown', 'Shutdown', [
    parkingBrakeSet,
    powerIdle,
    item('ittStable', 'ITT', 'Stabilised at idle for the cool-down the POH gives', { control: null, state: null, key: null, why: why('A minute at idle lets the hot section cool evenly before the fuel is cut.') }),
    item('avionicsOff', 'Avionics', 'Off', { control: 'avionics', state: eq('avionics', false), key: 'avionics', why: why('Avionics off before the generators drop off line.') }),
    item('conditionCutoff', 'Condition lever', 'CUT-OFF / FEATHER', { control: 'mixture', state: conditionCutoff, key: 'mixtureLean', stateLabel: 'CUT-OFF', why: why('Condition lever to cut-off stops the engine and feathers the propeller.') }),
    item('fuelPump', 'Fuel pumps', 'Off', { control: 'fuelPump', state: eq('fuelPump', false), key: 'fuelPump', why: why('Pumps off: nothing is drawing the fuel now.') }),
    item('masterOff', 'Generators and battery', 'Off', { control: 'master', state: all(eq('master', false), eq('alternator', false)), key: 'masterSwitch', why: why('Generators and battery off, or the battery is flat by tomorrow.') }),
  ]),
  engineFailure: list('engineFailure', 'Engine failure: air start', [
    powerIdle,
    conditionCutoffItem,
    fuelPumpsOn,
    item('ignitionOn', 'Ignition switch', 'ON', { control: 'magnetos', state: eq('mags', 3), key: 'magnetoBoth', stateLabel: 'ON', why: why('Ignition on: the igniters keep sparking until the engine is running.') }),
    item('starterOn', 'Starter', 'Press once', { control: null, state: ge('turbine.ng', 12), key: 'starter', stateLabel: 'START', why: why('The starter helps the gas generator spool up.') }),
    item('conditionStart', 'Condition lever', 'GROUND IDLE at 13 % Ng', { control: 'mixture', state: all(ge('turbine.ng', 12), conditionGndIdle), key: 'mixtureRich', critical: true, stateLabel: 'GND IDLE', why: why('Fuel only with enough airflow.') }),
    ittMonitor,
  ]),
  forcedLandingSecurity: list('forcedLandingSecurity', 'Forced landing: security', [
    powerIdle,
    conditionCutoffItem,
    item('fuelPump', 'Fuel pumps', 'Off', { control: 'fuelPump', state: eq('fuelPump', false), key: 'fuelPump', why: why('Fuel off: nothing flows to a damaged engine.') }),
    item('flapsAsRequired', 'Flaps', 'As required (40 once the field is made)', { control: 'flapLever', state: null, key: 'flapsDown', why: why('Flaps as the field needs: full once the field is made.') }),
    item('masterOff', 'Generators and battery', 'Off', { control: 'master', state: all(eq('master', false), eq('alternator', false)), key: 'masterSwitch', why: why('Electrics off once the flaps are set: they are electric.') }),
    item('harnesses', 'Doors and harnesses', 'Doors unlatched, harnesses tight', { control: null, state: null, key: null, why: why('Harnesses tight, doors unlatched: we can get out after the landing.') }),
  ]),
  nightLights: list('nightLights', 'Night: lights', C208.checklists.nightLights.items),
};
void lookout;

export const PC12: AircraftTypeDef = {
  id: 'pc12',
  name: 'Pilatus PC-12/47',
  icaoType: 'PC12',
  // Fictitious; 'HB-FSP' under EASA.
  registration: 'N47PC',
  registrations: { faa: 'N47PC', easa: 'HB-FSP' },
  // Single-engine turbine: an EASA SET class rating / FAA ASEL. The contract has no SET class, so SEP stands for it.
  classRating: 'SEP',
  vspeeds: VSPEEDS,
  settings: SETTINGS,
  flapDetentsDeg: FLAP_DETENTS_DEG,
  flapLeverForDeg: FLAP_LEVER,
  // Normal category (TCDS): +3.2 / -1.28 g flaps up (47E-PROXY 2-4: 3.2 g flaps up, 2.0 g flaps down).
  limits: { gPos: 3.2, gNeg: -1.28, maxDemoCrosswindKt: SETTINGS.maxDemoCrosswindKt },
  checklists: { ...citeChecklists(CHECKLISTS, PC12_CHECKLIST_SOURCE), ...PC12_EXTRA_CHECKLISTS },
  envelope: ENVELOPE,
  demoTuning: { maxBankDeg: 30, rollRateDps: 8 },
  vspeedsExt: {
    VfeApp: R.vfe[0],
    VflapRetract: 100, // flaps UP after take-off above 100 KIAS (PC12_FLAPS_UP_ABOVE_KIAS)
    VrShort: R.vr,
    Vlo: R.vloExtend,
    Vle: R.vle,
  },
  settingsExt: {
    redlineRpm: PC12_NP_GOVERNED, // Np
  },
  systems: {
    engines: 1,
    induction: 'turbine',
    carbHeat: false,
    primer: 'none',
    electricFuelPump: true,
    fuelSelector: [],
    prop: 'constantSpeedFeathering',
    mixture: false,
    magnetos: false,
    cowlFlaps: false,
    gear: 'retractable',
    steering: 'nosewheel',
    flapControl: 'electric',
    flapStageNames: ['up', '15', '30', '40'],
    inceptor: 'yoke',
    wing: 'low',
  },
  school: { syllabus: false, reason: 'Lessons are flown in the Cessna 172S.' },
  controls: {
    master: { label: 'Battery switch', where: 'the BAT switch on the lower left switch panel' },
    alternator: { label: 'Generator switches', where: 'the GEN 1 and GEN 2 switches beside the battery switch' },
    avionics: { label: 'Avionics switch', where: 'the AVIONICS switch on the lower left switch panel' },
    fuelPump: { label: 'Fuel pump switches', where: 'the FUEL PUMPS switch on the lower left switch panel' },
    magnetos: { label: 'Ignition switch', where: 'the IGNITION switch beside the STARTER switch, at the lower left' },
    throttle: { label: 'Power control lever', where: 'the large lever on the pedestal; aft of the idle gate is beta and reverse' },
    mixture: { label: 'Condition lever', where: 'the lever on the pedestal: CUT-OFF / FEATHER, GROUND IDLE, FLIGHT IDLE' },
    flapLever: { label: 'Flap lever', where: 'the lever on the right of the pedestal' },
    trimWheel: { label: 'Elevator trim', where: 'the trim switch on the yoke' },
    parkingBrake: { label: 'Parking brake', where: 'the handle under the left of the panel' },
  },
};
