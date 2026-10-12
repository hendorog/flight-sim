// Cessna 208 Caravan 675 (PT6A-114A, 8000 lb): the Flight School's type data (V-speeds, settings, flap detents,
// limits, checklists, safety envelope). Data only (contract 3.9): the school does not teach in this type (decision
// D5), but the instructor's wording, the checklists of the free-flight cards and the logbook read it.
//
// Speeds come from ./reference (the same table the HUD, the scenarios and the autoflight use). Checklist wording is
// the 208 POH normal procedures, condensed (sections 2 and 4; SCHOOL marks common operating practice that is not
// in the POH). Engine limits (POH sect. 2): torque 1865 ft lbf, ITT 805 C (1090 C for 2 s starting; 765 C maximum
// climb, 740 C maximum cruise), Ng 101.6 %, Np 1900 rpm, oil 85-105 psi (40 psi minimum at idle), 10-99 C.
//
// The turboprop's levers sit on the existing controls (docs/turbine-model.md): power lever = throttle (0 IDLE),
// propeller lever = propeller (1 MAX 1900 rpm, below 0.08 FEATHER), condition lever = mixture (below 0.1 CUT-OFF,
// 0.1 LOW IDLE, 1 HIGH IDLE), ignition switch = the magneto keys (0 OFF: the starter then motors dry), starter,
// fuel boost = fuel pump, generator = alternator, battery = master. Ng, ITT, torque, Np and the propeller lever
// are the 'powerplant' telemetry provider's signals (turbine.*, prop.*). Items over a control or an indication the
// simulator does not have (the overspeed governor test, the inertial separator, fuel boost NORM, the ignition
// switch's NORM position) have `state: null` and are confirmed with Enter. There is no piston engine here: no
// carburettor heat, no mixture leaning, no magneto check.

import { citeChecklists } from '../../training/checklistData';
import { C208_EXTRA_CHECKLISTS, C208_CHECKLIST_SOURCE } from './checklists';
import { all, eq, ge, gt, le, lt } from '../../training/engine/dsl';
import type {
  AircraftSettingId, AircraftTypeDef, ChecklistDef, ChecklistId, ChecklistItem, ChecklistKeyPair, CueRef, PointTarget, Pred, SafetyEnvelope, VSpeedId,
} from '../../training/types';
import { C208_REFERENCE } from './reference';

const R = C208_REFERENCE;

/** Flap detents (degrees) and the ControlInputs.flaps lever value of each: UP, 10, 20, FULL (30) (POH sect. 7). */
const FLAP_MAX_DEG = 30;
const FLAP_DETENTS_DEG = [0, 10, 20, 30];
const FLAP_LEVER: Record<number, number> = Object.fromEntries(FLAP_DETENTS_DEG.map((d) => [d, d / FLAP_MAX_DEG]));

/** POH airspeeds, KIAS (sect. 2, 4, 5 at 8000 lb). The shared ones are the reference table's. */
const VSPEEDS: Record<VSpeedId, number> = {
  Vs0: R.vs0,
  Vs1: R.vs1,
  Vr: R.vr,
  Vx: R.vx, // flaps 20
  Vy: R.vy, // flaps UP, sea level
  Vcc: 115, // cruise climb 110-120 (SCHOOL)
  Vglide: R.vglide, // propeller feathered, flaps UP
  Va: R.va,
  Vfe10: R.vfe[0],
  VfeFull: R.vfe[R.vfe.length - 1],
  // Vmo 175 is the red line; a turboprop has no Vno / yellow arc, so Vno is Vmo (as reference.ts takes it).
  Vno: R.vno,
  // No Vne is published: Vmo is the red line, so Vne = Vno = 175 (reference.ts; the generic type test admits
  // Vno = Vne for a turbine, which has no yellow arc).
  Vne: R.vne,
  Vapp: R.vapp, // flaps 20
  VappFlapsUp: 105, // flaps UP approach (SCHOOL 100-110)
  Vref: R.vref, // flaps FULL
  VshortField: R.vref, // POH short-field landing, flaps FULL: 78
  Vcruise: R.vcruise,
  Vslow: 85, // slow flight, flaps UP (SCHOOL 80-90)
  VsteepTurn: 130, // SCHOOL: below Va 148
  Vdescent: 160, // cruise descent (SCHOOL 150-170)
  Vdownwind: R.vdownwind,
  Vtaxi: 15, // ground speed, kt
};

/**
 * The school's eleven settings. The rpm ones are propeller rpm (Np): the propeller lever stays at 1900 for the
 * circuit and normally in the cruise (SCHOOL; the POH allows 1600-1900). There are no magnetos: their drops are 0.
 */
const SETTINGS: Record<AircraftSettingId, number> = {
  patternAglFt: 1000,
  cruiseRpm: 1900,
  descentRpm: 1900,
  circuitRpm: 1900,
  runupRpm: 1900,
  magDropMaxRpm: 0,
  magDiffMaxRpm: 0,
  approachFlapLever: FLAP_LEVER[30], // landing flap FULL (flaps 20 on base)
  takeoffFlapLever: FLAP_LEVER[20], // POH normal take-off, flaps 20
  shortFieldFlapLever: FLAP_LEVER[20],
  maxDemoCrosswindKt: 20, // POH sect. 4: 20 kt demonstrated
};

/** Safety monitor defaults (section 3.8 of the school's design): the C172S's, with the turboprop's speed and g limits. */
const ENVELOPE: SafetyEnvelope = {
  maxBankDeg: 60,
  maxPitchUpDeg: 25,
  maxPitchDownDeg: -25,
  maxKias: VSPEEDS.Vno + 5, // Vmo + 5: there is no yellow arc to fly in
  maxG: 3.0, // normal category +3.8 flaps up, with a margin
  minG: 0,
  minAglFt: 1000,
  lowAndSlow: { aglFt: 300, belowKias: { vspeed: 'Vs1', add: 5 } },
  maxSinkFpmBelow200: 1000,
  stallAllowed: false,
  runwayExcursionM: 13,
};

// ---- checklists -----------------------------------------------------------------------------------------------
//
// Every item says, as data: the control or instrument to point at (null: none), the predicate that shows it is
// done (null: Enter confirms it), the key that works it, and the reason (15 words or fewer).

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

/** Condition lever (turbineEngine.ts CUTOFF_BELOW 0.1): CUT-OFF below 0.1, LOW IDLE 0.1, HIGH IDLE 1. The cut-off check
 * reads below 0.05 so that a lever moved up to the LOW IDLE detent (exactly 0.1) clears it (comparisons latch at the edge). */
const conditionCutoff: Pred = lt('mixture', 0.05);
const conditionLowIdle: Pred = all(ge('mixture', 0.1), lt('mixture', 0.5));
const conditionHighIdle: Pred = ge('mixture', 0.95);
/** Propeller lever: MAX (1900 rpm) at the forward stop, FEATHER below the gate (core/types.ts PROP_FEATHER_GATE). */
const propMaxPred: Pred = ge('prop.lever', 0.95);
const propFeatherPred: Pred = lt('prop.lever', 0.08);

// Item building blocks shared by several lists (same id and predicate wherever they appear).
const fuelOn = item('fuelSelector', 'Fuel tank selectors', 'Left and right ON', {
  control: 'fuelSelector', state: eq('fuelSel', 'on'), key: 'fuelSelector', critical: true, stateLabel: 'BOTH ON',
  why: why('Both tanks on: one selector off unbalances the wings and halves the fuel.') });
const powerIdle = item('powerIdle', 'Power lever', 'IDLE', {
  control: 'throttle', state: lt('throttle', 0.02), key: 'throttleIdle',
  why: why('Power lever at idle: the engine must not surge when the fuel lights.') });
const conditionCutoffItem = item('conditionCutoff', 'Condition lever', 'CUT-OFF', {
  control: 'mixture', state: conditionCutoff, key: 'mixtureLean', critical: true,
  why: why('Condition lever at cut-off: no fuel reaches the engine.') });
const conditionHighIdleItem = item('conditionHighIdle', 'Condition lever', 'HIGH IDLE', {
  control: 'mixture', state: conditionHighIdle, key: 'mixtureRich', critical: true,
  why: why('High idle: the engine spools up quickly if we need power at once.') });
const propMax = item('propMax', 'Propeller lever', 'MAX (1,900 rpm)', {
  control: null, state: propMaxPred, key: 'propIncrease', stateLabel: 'MAX',
  why: why('Propeller full forward: 1,900 rpm and full power available for a go-around.') });
const propFeather = item('propFeather', 'Propeller lever', 'FEATHER', {
  control: null, state: propFeatherPred, key: 'propFeather',
  why: why('Feathered, the stopped propeller blades are edge-on: the least drag.') });
const parkingBrakeSet = item('parkingBrake', 'Parking brake', 'Set', {
  control: 'parkingBrake', state: eq('parkingBrake', true), key: 'parkingBrake',
  why: why('Parking brake set: even at idle a turboprop pulls hard.') });
const landingLightOn = item('landingLight', 'Landing lights', 'On', {
  control: 'landingLight', state: eq('lightLanding', true), key: 'landingLight',
  why: why('Landing lights on: we are much easier to see.') });
const flapsUpTaxi = item('flapsUp', 'Flaps', 'Up', {
  control: 'flapLever', state: lt('flapsDeg', 1), key: 'flapsUp',
  why: why('Flaps up for taxiing: they are out of the way of propeller spray.') });
const lookout = item('lookout', 'Lookout', 'Clear', {
  control: null, state: null, key: null, lookout: true,
  why: why('A clearing turn: look all round, above and below, before we manoeuvre.') });
const ittMonitor = item('itt', 'ITT', 'Monitor: 1,090 °C maximum', {
  control: null, state: null, key: null, stateLabel: '1,090 °C MAX',
  why: why('Watch ITT through the light-off: a hot start ruins the turbine in seconds.') });
const starterOn = item('starterOn', 'Starter switch', 'START: Ng rising', {
  control: null, state: ge('turbine.ng', 12), key: 'starter', stateLabel: 'START',
  why: why('The starter spins the gas generator; the igniters spark while it runs.') });
const conditionStart = item('conditionStart', 'Condition lever', 'LOW IDLE at 13 % Ng minimum', {
  control: 'mixture', state: all(ge('turbine.ng', 12), conditionLowIdle), key: 'mixtureRich', critical: true, stateLabel: 'LOW IDLE',
  why: why('Fuel only with enough airflow: too early, too slow, and the start runs hot.') });
const starterOff = item('starterOff', 'Starter switch', 'OFF at 52 % Ng', {
  control: null, state: all(ge('turbine.ng', 50), eq('starter', false)), key: 'starter', stateLabel: 'OFF',
  why: why('At 52 percent the engine runs on its own; the starter becomes the generator.') });

const list = (id: ChecklistId, title: string, items: ChecklistItem[]): ChecklistDef => ({ id, title, items });

const CHECKLISTS: Record<ChecklistId, ChecklistDef> = {
  beforeStart: list('beforeStart', 'Before starting engine', [
    parkingBrakeSet,
    item('breakers', 'Circuit breakers', 'Check in', {
      control: null, state: null, key: null,
      why: why('A tripped breaker now means a fault before we even start.') }),
    item('avionicsOff', 'Avionics', 'Off', {
      control: 'avionics', state: eq('avionics', false), key: 'avionics',
      why: why('Avionics off for the start: the starter draws the battery right down.') }),
    item('master', 'Battery switch', 'On', {
      control: 'master', state: eq('master', true), key: 'masterSwitch',
      why: why('Battery on: it powers the starter, the boost pump and the engine gauges.') }),
    item('fuelPump', 'Fuel boost', 'On', {
      control: 'fuelPump', state: eq('fuelPump', true), key: 'fuelPump',
      why: why('Boost pump on: fuel pressure to the engine pump before the start.') }),
    fuelOn,
    item('beacon', 'Beacon', 'On', {
      control: 'beacon', state: eq('lightBeacon', true), key: 'beacon',
      why: why('Beacon on: it warns anyone outside that the engine is about to start.') }),
    powerIdle,
    item('propLever', 'Propeller lever', 'As required (MAX for the taxi)', {
      control: null, state: null, key: 'propIncrease', stateLabel: 'AS REQUIRED',
      why: why('The propeller starts feathered; it comes out as oil pressure builds.') }),
    conditionCutoffItem,
    item('ignition', 'Ignition switch', 'NORM', {
      control: 'magnetos', state: null, key: null, stateLabel: 'NORM',
      why: why('Ignition NORM: the igniters spark automatically while the starter is on.') }),
  ]),
  engineStart: list('engineStart', 'Starting engine', [
    item('propArea', 'Propeller area', 'Clear', {
      control: null, state: null, key: null,
      why: why('Nobody near the propeller or the exhausts: look both sides and call "clear".') }),
    starterOn,
    item('oilPressure', 'Oil pressure', 'Rising', {
      control: 'oil', state: gt('oilPsi', 5), key: null,
      why: why('No oil pressure as Ng rises: abort the start before the engine is damaged.') }),
    conditionStart,
    ittMonitor,
    starterOff,
  ]),
  afterStart: list('afterStart', 'After starting engine', [
    item('generator', 'Generator', 'On, check charge', {
      control: 'alternator', state: eq('alternator', true), key: 'alternator', stateLabel: 'ON',
      why: why('Generator on: it now recharges the battery the start has drained.') }),
    item('fuelBoostNorm', 'Fuel boost', 'NORM', {
      control: 'fuelPump', state: null, key: 'fuelPump', stateLabel: 'NORM',
      why: why('NORM: the boost pump comes on by itself if fuel pressure falls.') }),
    item('engineInstruments', 'Engine instruments', 'Ng 52 % or more, ITT and oil in limits', {
      control: 'oil', state: null, key: null,
      why: why('Stable at idle: Ng, ITT, oil pressure and temperature all in their limits.') }),
    item('avionicsOn', 'Avionics', 'On', {
      control: 'avionics', state: eq('avionics', true), key: 'avionics',
      why: why('Avionics on now: the start is over, so they are safe.') }),
    item('navLights', 'Navigation lights', 'On', {
      control: 'navLights', state: eq('lightNav', true), key: 'navLights',
      why: why('Navigation lights on: other traffic can see us.') }),
    flapsUpTaxi,
  ]),
  // POH before take-off: the engine checks at the hold. The overspeed governor test needs its test switch, which
  // the simulator does not have.
  runup: list('runup', 'Engine run-up', [
    item('parkingBrake', 'Parking brake', 'Set', {
      control: 'parkingBrake', state: eq('parkingBrake', true), key: 'parkingBrake',
      why: why('Parking brake set: the run-up power would pull the aircraft forward.') }),
    fuelOn,
    item('runupPower', 'Power lever', '400 ft-lb torque', {
      control: 'throttle', state: all(ge('turbine.torqueFtLb', 300), le('turbine.torqueFtLb', 500)), key: POWER_KEYS, stateLabel: '400 FT-LB',
      why: why('400 foot-pounds: enough load to check the engine without moving.') }),
    item('overspeedGovernor', 'Overspeed governor', 'Check, as applicable', {
      control: null, state: null, key: null,
      why: why('The overspeed governor is the backup if the propeller governor fails.') }),
    item('propExercise', 'Propeller lever', 'Exercise: Np drops, then MAX', {
      control: null, state: null, key: 'propDecrease', stateLabel: 'EXERCISE, THEN MAX',
      why: why('Np should fall smoothly and recover: the governor and its oil are working.') }),
    item('engineInstruments', 'Engine instruments and ammeter', 'In limits, charging', {
      control: 'oil', state: null, key: null,
      why: why('Torque, ITT, Ng and oil in limits before we ask for full power.') }),
    item('powerIdle', 'Power lever', 'IDLE', {
      control: 'throttle', state: lt('throttle', 0.02), key: 'throttleIdle',
      why: why('Back to idle before we release the brakes.') }),
  ]),
  beforeTakeoff: list('beforeTakeoff', 'Before take-off', [
    item('controls', 'Flight controls', 'Free and correct', {
      control: 'yoke', state: null, key: null,
      why: why('Full and free, the right way: a jammed or crossed control is found now.') }),
    item('instruments', 'Flight instruments', 'Set', {
      control: 'ai', state: null, key: null,
      why: why('Altimeter set, heading aligned with the compass, attitude erect.') }),
    fuelOn,
    item('trim', 'Trim', 'Take-off', {
      control: 'trimWheel', state: null, key: TRIM_KEYS, stateLabel: 'TAKE-OFF',
      why: why('Elevator, aileron and rudder trim at take-off, or the climb-out fights us.') }),
    item('flaps', 'Flaps', '20', {
      control: 'flapLever', state: all(ge('flapsDeg', 19), le('flapsDeg', 21)), key: 'flapsDown', critical: true, stateLabel: '20°',
      why: why('Flaps 20 is the normal take-off setting: shorter run, slower lift-off.') }),
    conditionHighIdleItem,
    propMax,
    item('ignitionAsRequired', 'Ignition switch', 'As required (ON on a wet or icy runway)', {
      control: 'magnetos', state: null, key: null, stateLabel: 'AS REQUIRED',
      why: why('Ignition ON where water or ice could put the flame out.') }),
    item('strobes', 'Strobes', 'On', {
      control: 'strobes', state: eq('lightStrobe', true), key: 'strobes',
      why: why('Strobes on as we enter the runway, so we are seen.') }),
    landingLightOn,
    item('parkingBrakeOff', 'Parking brake', 'Off', {
      control: 'parkingBrake', state: eq('parkingBrake', false), key: 'parkingBrake',
      why: why('Parking brake off, or we will not roll on the take-off.') }),
  ]),
  afterTakeoff: list('afterTakeoff', 'After take-off', [
    item('flapsUp', 'Flaps', 'Up, above 90 KIAS', {
      control: 'flapLever', state: lt('flapsDeg', 1), key: 'flapsUp',
      why: why('Flaps up once above 90 knots and climbing: less drag, a better climb.') }),
    item('climbPower', 'Power lever', 'Climb: 1,865 ft-lb max, ITT 765 °C max', {
      control: 'throttle', state: null, key: POWER_KEYS, stateLabel: 'CLIMB TORQUE',
      why: why('Climb power: torque at its limit low down, ITT the limit higher up.') }),
    item('propClimb', 'Propeller lever', '1,600 to 1,900 rpm', {
      control: null, state: null, key: { raise: 'propIncrease', lower: 'propDecrease' }, stateLabel: '1,600-1,900',
      why: why('Np in the governed range; 1,900 gives the best climb.') }),
    item('engineInstruments', 'Engine instruments', 'In limits', {
      control: 'oil', state: null, key: null,
      why: why('Torque, ITT, Ng and oil temperature: check them as the climb settles.') }),
  ]),
  // Pre-manoeuvre check (EASA): Height, Airframe, Security, Engine, Location, Lookout.
  hasell: list('hasell', 'HASELL', [
    item('height', 'Height', 'Enough to recover by 3,000 ft above ground', {
      control: 'alt', state: ge('aglFt', 3000), key: null,
      why: why('Height: recovered by 3,000 feet above the ground, with room to spare.') }),
    item('airframe', 'Airframe', 'Flaps as required, clean', {
      control: 'flapLever', state: null, key: null,
      why: why('Airframe: flaps set for the exercise, nothing extended we did not mean.') }),
    item('security', 'Security', 'Harnesses tight, nothing loose', {
      control: null, state: null, key: null,
      why: why('Security: anything loose flies around the cabin when we manoeuvre.') }),
    item('engine', 'Engine', 'Torque, ITT, Ng and oil in limits; fuel balanced', {
      control: 'oil', state: null, key: null,
      why: why('Engine: every gauge in its limits, the tanks balanced.') }),
    item('location', 'Location', 'Clear of towns, airfields and cloud', {
      control: null, state: null, key: null,
      why: why('Location: away from towns, airfields and cloud, in case it goes wrong.') }),
    lookout,
  ]),
  // POH before landing, as the downwind checks: brakes, fuel, condition and propeller levers, flaps, harnesses.
  downwind: list('downwind', 'Before landing', [
    item('brakes', 'Brakes', 'Off, pressure checked', {
      control: 'parkingBrake', state: eq('parkingBrake', false), key: 'parkingBrake', stateLabel: 'OFF',
      why: why('Brakes off and firm: landing with the parking brake on bursts tyres.') }),
    item('undercarriage', 'Undercarriage', 'Down and welded', {
      control: null, state: null, key: null,
      why: why('Fixed gear: down and welded, but say it, so it is a habit.') }),
    fuelOn,
    conditionHighIdleItem,
    propMax,
    item('flapsApproach', 'Flaps', '20 below 150 KIAS; 95 KIAS on base', {
      control: 'flapLever', state: null, key: 'flapsDown', stateLabel: '20',
      why: why('Flaps 20 for the approach: below 150 knots only.') }),
    item('harnesses', 'Doors and harnesses', 'Secure', {
      control: null, state: null, key: null,
      why: why('Harnesses tight and doors shut before the landing.') }),
    landingLightOn,
  ]),
  final: list('final', 'Final', [
    item('flapsLanding', 'Flaps', 'FULL below 125 KIAS', {
      control: 'flapLever', state: ge('flapsDeg', 29), key: 'flapsDown', stateLabel: 'FULL',
      why: why('Full flap below 125 knots: 78 knots over the fence.') }),
    propMax,
    conditionHighIdleItem,
    item('runwayClear', 'Runway', 'Clear', {
      control: null, state: null, key: null,
      why: why('Nobody on the runway: if it is not clear, we go around.') }),
  ]),
  afterLanding: list('afterLanding', 'After landing', [
    item('flapsUp', 'Flaps', 'Up', {
      control: 'flapLever', state: lt('flapsDeg', 1), key: 'flapsUp',
      why: why('Flaps up once clear of the runway: they are not needed to taxi.') }),
    item('conditionLowIdle', 'Condition lever', 'LOW IDLE', {
      control: 'mixture', state: conditionLowIdle, key: CONDITION_KEYS, stateLabel: 'LOW IDLE',
      why: why('Low idle for the taxi: less thrust, so less braking.') }),
    item('ignitionNorm', 'Ignition switch', 'NORM', {
      control: 'magnetos', state: null, key: null, stateLabel: 'NORM',
      why: why('Ignition back to NORM: continuous ignition wears the igniters.') }),
    item('strobesOff', 'Strobes', 'Off', {
      control: 'strobes', state: eq('lightStrobe', false), key: 'strobes',
      why: why('Strobes off on the ground: they dazzle other pilots.') }),
    item('landingLightOff', 'Landing lights', 'Off', {
      control: 'landingLight', state: eq('lightLanding', false), key: 'landingLight',
      why: why('Landing lights off off the runway: they dazzle.') }),
  ]),
  // Shutdown (POH): the engine cools at idle before the fuel is cut, then the propeller is feathered.
  shutdown: list('shutdown', 'Shutdown', [
    item('parkingBrake', 'Parking brake', 'Set', {
      control: 'parkingBrake', state: eq('parkingBrake', true), key: 'parkingBrake',
      why: why('Parking brake set: the aircraft stays put once we leave it.') }),
    item('throttleIdle', 'Power lever', 'IDLE', {
      control: 'throttle', state: lt('throttle', 0.02), key: 'throttleIdle',
      why: why('Power at idle before the shutdown.') }),
    item('ittStable', 'ITT', 'Stabilised at idle for one minute', {
      control: null, state: null, key: null,
      why: why('A minute at idle lets the hot section cool evenly before the fuel is cut.') }),
    item('avionicsOff', 'Avionics', 'Off', {
      control: 'avionics', state: eq('avionics', false), key: 'avionics',
      why: why('Avionics off before the generator drops off line.') }),
    item('mixtureCutoff', 'Condition lever', 'CUT-OFF', {
      control: 'mixture', state: conditionCutoff, key: 'mixtureLean', stateLabel: 'CUT-OFF',
      why: why('Condition lever to cut-off stops the engine by shutting off its fuel.') }),
    propFeather,
    item('fuelPump', 'Fuel boost', 'Off', {
      control: 'fuelPump', state: eq('fuelPump', false), key: 'fuelPump',
      why: why('Boost pump off: nothing is drawing the fuel now.') }),
    item('masterOff', 'Generator and battery', 'Off', {
      control: 'master', state: all(eq('master', false), eq('alternator', false)), key: 'masterSwitch',
      why: why('Generator and battery off, or the battery is flat by tomorrow.') }),
  ]),
  // Engine failure in flight, starter-assisted air start (POH sect. 3), as the touch drill.
  engineFailure: list('engineFailure', 'Engine failure: air start', [
    item('powerIdle', 'Power lever', 'IDLE', {
      control: 'throttle', state: lt('throttle', 0.02), key: 'throttleIdle',
      why: why('Power idle: a relight at high power over-temperatures the engine.') }),
    item('propAirstart', 'Propeller lever', 'FEATHER or MIN rpm', {
      control: null, state: null, key: 'propDecrease', stateLabel: 'FEATHER / MIN',
      why: why('Less windmilling load: the gas generator spins up more easily.') }),
    conditionCutoffItem,
    item('fuelSelector', 'Fuel tank selectors', 'Left and right ON', {
      control: 'fuelSelector', state: eq('fuelSel', 'on'), key: 'fuelSelector', critical: true, stateLabel: 'BOTH ON',
      why: why('Both tanks on: a selector knocked off starves the engine.') }),
    item('fuelPump', 'Fuel boost', 'On', {
      control: 'fuelPump', state: eq('fuelPump', true), key: 'fuelPump',
      why: why('Boost pump on: fuel pressure for the relight.') }),
    item('ignitionOn', 'Ignition switch', 'ON', {
      control: 'magnetos', state: eq('mags', 3), key: 'magnetoBoth', stateLabel: 'ON',
      why: why('Ignition on: the igniters keep sparking until the engine is running.') }),
    starterOn,
    conditionStart,
    ittMonitor,
    starterOff,
  ]),
  // Forced landing without engine power (POH sect. 3): fuel off, propeller feathered, flaps as the field needs.
  forcedLandingSecurity: list('forcedLandingSecurity', 'Forced landing: security', [
    item('powerIdle', 'Power lever', 'IDLE', {
      control: 'throttle', state: lt('throttle', 0.02), key: 'throttleIdle',
      why: why('Power idle: no surprise thrust if the engine catches on short final.') }),
    propFeather,
    item('mixtureCutoff', 'Condition lever', 'CUT-OFF', {
      control: 'mixture', state: conditionCutoff, key: 'mixtureLean', stateLabel: 'CUT-OFF',
      why: why('No fuel to the engine: less to burn if the landing goes wrong.') }),
    item('fuelOff', 'Fuel tank selectors', 'OFF', {
      control: 'fuelSelector', state: eq('fuelSel', 'off'), key: 'fuelSelector',
      why: why('Fuel off at the tanks: nothing flows to a damaged engine.') }),
    item('flapsAsRequired', 'Flaps', 'As required (FULL recommended)', {
      control: 'flapLever', state: null, key: 'flapsDown',
      why: why('Flaps as the field needs: full once the field is made.') }),
    item('masterOff', 'Generator and battery', 'Off', {
      control: 'master', state: all(eq('master', false), eq('alternator', false)), key: 'masterSwitch',
      why: why('Electrics off once the flaps are set: they are electric.') }),
    item('harnesses', 'Doors and harnesses', 'Doors unlatched, harnesses tight', {
      control: null, state: null, key: null,
      why: why('Harnesses tight, doors unlatched: we can get out after the landing.') }),
  ]),
  nightLights: list('nightLights', 'Night: lights', [
    item('navLights', 'Navigation lights', 'On', {
      control: 'navLights', state: eq('lightNav', true), key: 'navLights',
      why: why('Navigation lights on: at night they show which way we are going.') }),
    item('beacon', 'Beacon', 'On', {
      control: 'beacon', state: eq('lightBeacon', true), key: 'beacon',
      why: why('Beacon on whenever the engine runs.') }),
    item('strobes', 'Strobes', 'On', {
      control: 'strobes', state: eq('lightStrobe', true), key: 'strobes',
      why: why('Strobes on in the air: we are seen from miles away.') }),
    item('taxiLight', 'Taxi lights', 'As required', {
      control: 'taxiLight', state: null, key: 'taxiLight',
      why: why('Taxi lights on the ground to see the taxiway edges.') }),
    item('panelLights', 'Panel lights', 'Set', {
      control: 'panelLights', state: null, key: 'panelLights',
      why: why('Panel lights dim: bright enough to read, dark enough to see out.') }),
    item('landingLight', 'Landing lights', 'On', {
      control: 'landingLight', state: eq('lightLanding', true), key: 'landingLight',
      why: why('Landing lights on for the runway, so we see and are seen.') }),
  ]),
};

export const C208: AircraftTypeDef = {
  id: 'c208',
  name: 'Cessna 208 Caravan 675',
  icaoType: 'C208',
  // Fictitious; 'G-FSCV' under EASA.
  registration: 'N208FS',
  registrations: { faa: 'N208FS', easa: 'G-FSCV' },
  // Single-engine turbine: an EASA SET class rating / FAA ASEL. The contract has no SET class, so SEP stands for it.
  classRating: 'SEP',
  vspeeds: VSPEEDS,
  settings: SETTINGS,
  flapDetentsDeg: FLAP_DETENTS_DEG,
  flapLeverForDeg: FLAP_LEVER,
  // Normal category (POH sect. 2): +3.8 / -1.52 g flaps up.
  limits: { gPos: 3.8, gNeg: -1.52, maxDemoCrosswindKt: SETTINGS.maxDemoCrosswindKt },
  checklists: { ...citeChecklists(CHECKLISTS, C208_CHECKLIST_SOURCE), ...C208_EXTRA_CHECKLISTS },
  envelope: ENVELOPE,
  demoTuning: { maxBankDeg: 30, rollRateDps: 8 },
  vspeedsExt: {
    VfeApp: R.vfe[1], // flaps 20
    VflapRetract: 90, // flaps UP after take-off above 85-90 (SCHOOL 90)
    VrShort: 65, // short-field take-off rotation (the POH's short-field figures)
  },
  settingsExt: {
    redlineRpm: 1900, // Np
  },
  systems: {
    engines: 1,
    induction: 'turbine',
    carbHeat: false,
    primer: 'none',
    electricFuelPump: true,
    fuelSelector: ['on', 'left', 'right', 'off'],
    prop: 'constantSpeedFeathering',
    mixture: false,
    magnetos: false,
    cowlFlaps: false,
    gear: 'fixed',
    steering: 'nosewheel',
    flapControl: 'electric',
    flapStageNames: ['up', '10', '20', 'full'],
    inceptor: 'yoke',
    wing: 'high',
  },
  school: { syllabus: false, reason: 'Lessons are flown in the Cessna 172S.' },
  controls: {
    master: { label: 'Battery switch', where: 'the BATTERY rocker on the left switch panel' },
    alternator: { label: 'Generator switch', where: 'the GENERATOR switch beside the battery switch' },
    avionics: { label: 'Avionics switches', where: 'the AVIONICS bus switches on the left switch panel' },
    fuelPump: { label: 'Fuel boost switch', where: 'the FUEL BOOST switch on the left switch panel' },
    magnetos: { label: 'Ignition switch', where: 'the IGNITION switch beside the starter switch, on the left switch panel' },
    throttle: { label: 'Power lever', where: 'the large lever on the left of the pedestal' },
    mixture: { label: 'Condition lever', where: 'the lever on the right of the pedestal: CUT-OFF, LOW IDLE, HIGH IDLE' },
    fuelSelector: { label: 'Fuel tank selectors', where: 'the LEFT and RIGHT selectors in the overhead panel' },
    flapLever: { label: 'Flap selector', where: 'the selector on the right of the pedestal' },
    trimWheel: { label: 'Elevator trim wheel', where: 'on the left of the pedestal' },
    parkingBrake: { label: 'Parking brake', where: 'the handle under the left of the panel' },
  },
};
