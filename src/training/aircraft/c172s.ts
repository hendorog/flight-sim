// The Cessna 172S training profile (section 2.1): POH V-speeds (KIAS), settings, flap detents, limits,
// checklists and the default safety envelope. Values shared with src/core/c172.ts are imported from there
// (c172s.test.ts asserts equality) so the flight model and the lessons cannot disagree.
//
// The checklist items carry their control, `state` predicate (over the core telemetry signals, section 2.3), key
// and reason, so the ChecklistRunner verifies them from the aircraft state and the guided checklists point at
// them; items whose state is null are confirmed with Enter.
// Wording follows the C172S POH normal and emergency procedures, shortened to what is spoken in the cockpit.

import { C172 } from '../../core/c172';
import { all, eq, ever, ge, gt, held, le, lt, not } from '../engine/dsl';
import type {
  AircraftSettingId, AircraftTypeDef, ChecklistDef, ChecklistId, ChecklistItem, ChecklistKeyPair, CueRef, PointTarget, Pred, SafetyEnvelope, VSpeedId,
} from '../types';

/** Flap detents (degrees) and the ControlInputs.flaps lever value of each (detents at thirds of travel). */
const FLAP_MAX_DEG = Math.round((C172.wing.flap.maxDeflection * 180) / Math.PI);
const FLAP_DETENTS_DEG = [0, 10, 20, 30];
const FLAP_LEVER: Record<number, number> = Object.fromEntries(FLAP_DETENTS_DEG.map((d) => [d, d / FLAP_MAX_DEG]));

/** POH airspeeds, KIAS. Shared values come from core/c172.ts; the rest are C172S POH (2004 revision) KIAS. */
const VSPEEDS: Record<VSpeedId, number> = {
  Vs0: 40, // stall, flaps 30, KIAS (core/c172.ts holds the KCAS figures: 48 / 53)
  Vs1: 48, // stall, clean, KIAS
  Vr: 55,
  Vx: C172.poh.vxKias,
  Vy: C172.poh.vyKias,
  Vcc: 85, // cruise climb
  Vglide: C172.poh.bestGlideKias,
  Va: 105, // manoeuvring speed at 2,550 lb
  Vfe10: 110,
  VfeFull: C172.poh.vfeKias,
  Vno: C172.poh.vnoKias,
  Vne: C172.poh.vneKias,
  Vapp: 70, // approach, flap 20
  VappFlapsUp: 75, // flapless approach
  Vref: 65, // final, flap 30
  VshortField: 61,
  Vcruise: 105, // training cruise
  Vslow: 55, // slow flight
  VsteepTurn: 95,
  Vdescent: 90,
  Vdownwind: 90,
  Vtaxi: 15, // ground speed, kt
};

const SETTINGS: Record<AircraftSettingId, number> = {
  patternAglFt: 1000,
  cruiseRpm: 2300,
  descentRpm: 1900,
  circuitRpm: 2200,
  runupRpm: 1800,
  magDropMaxRpm: 150,
  magDiffMaxRpm: 50,
  approachFlapLever: FLAP_LEVER[30],
  takeoffFlapLever: FLAP_LEVER[0],
  shortFieldFlapLever: FLAP_LEVER[10],
  maxDemoCrosswindKt: 15,
};

/** Section 3.8 defaults; lessons override fields through LessonRules.envelope. */
const ENVELOPE: SafetyEnvelope = {
  maxBankDeg: 60,
  maxPitchUpDeg: 25,
  maxPitchDownDeg: -25,
  maxKias: VSPEEDS.Vno + 11,
  maxG: 3.3,
  minG: 0,
  minAglFt: 1000,
  lowAndSlow: { aglFt: 300, belowKias: { vspeed: 'Vs1', add: 5 } },
  maxSinkFpmBelow200: 1000,
  stallAllowed: false,
  runwayExcursionM: 13,
};

// ---- checklists -----------------------------------------------------------------------------------------------
//
// Every item says, as data on this aircraft type (round 7: the engine's inferred where/key/why is only a fallback
// for other types):
//   control  the cockpit control or instrument to point at; null when there is none (the propeller area)
//   state    the predicate that shows it is done; null when the aircraft state cannot show it (Enter confirms it)
//   key      the key that works it (an InputAction id, a literal label, or a raise/lower pair for a band); null: none
//   why      the reason, said the first time the item is read in a run (15 words or fewer)
// `check` is the same predicate as `state` (the silent and flow modes, the grader and the tests read it).

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

const THROTTLE_KEYS: ChecklistKeyPair = { raise: 'throttleUp', lower: 'throttleDown' };
const TRIM_KEYS: ChecklistKeyPair = { raise: 'trimNoseUp', lower: 'trimNoseDown' };

// Item building blocks shared by several lists (same id and predicate wherever they appear).
const fuelBoth = item('fuelSelector', 'Fuel selector', 'Both', {
  control: 'fuelSelector', state: eq('fuelSel', 'both'), key: 'fuelSelector', critical: true,
  why: why('Fuel selector on both: the engine feeds from both tanks.') });
const mixtureRich = item('mixture', 'Mixture', 'Rich', {
  control: 'mixture', state: ge('mixture', 0.95), key: 'mixtureRich', critical: true,
  why: why('Mixture fully rich: the engine needs it rich to start and run on the ground.') });
const magsBoth = item('mags', 'Magnetos', 'Both', {
  control: 'magnetos', state: eq('mags', 3), key: 'magnetoBoth',
  why: why('Both magnetos: two independent ignition systems, both working.') });
const parkingBrakeSet = item('parkingBrake', 'Parking brake', 'Set', {
  control: 'parkingBrake', state: eq('parkingBrake', true), key: 'parkingBrake',
  why: why('Parking brake set: the aircraft must not roll when the engine fires.') });
const landingLightOn = item('landingLight', 'Landing light', 'On', {
  control: 'landingLight', state: eq('lightLanding', true), key: 'landingLight',
  why: why('Landing light on: we are much easier to see.') });
const flapsUpTaxi = item('flapsUp', 'Flaps', 'Up', {
  control: 'flapLever', state: lt('flapsDeg', 1), key: 'flapsUp',
  why: why('Flaps up for taxiing: down, they pick up stones from the propeller.') });
const lookout = item('lookout', 'Lookout', 'Clear', {
  control: null, state: null, key: null, lookout: true,
  why: why('A clearing turn: look all round, above and below, before we manoeuvre.') });

const list = (id: ChecklistId, title: string, items: ChecklistItem[]): ChecklistDef => ({ id, title, items });

const CHECKLISTS: Record<ChecklistId, ChecklistDef> = {
  beforeStart: list('beforeStart', 'Before starting engine', [
    parkingBrakeSet,
    item('avionicsOff', 'Avionics switch', 'Off', {
      control: 'avionics', state: eq('avionics', false), key: 'avionics',
      why: why("Avionics off for the start: the starter's voltage dip can damage the radios.") }),
    item('master', 'Master switch', 'On', {
      control: 'master', state: eq('master', true), key: 'masterSwitch',
      why: why('Master on: it powers the starter, the beacon and the instruments.') }),
    item('beacon', 'Beacon', 'On', {
      control: 'beacon', state: eq('lightBeacon', true), key: 'beacon',
      why: why('Beacon on: it warns anyone outside that the engine is about to start.') }),
    fuelBoth,
    mixtureRich,
    // The prime: the pump on for at least 2 s (fuel to the injectors), then off before the starter turns
    // (left on, it floods the engine and the start fails). The predicate is evaluated from when the item is read.
    item('fuelPumpPrime', 'Fuel pump', 'On for a few seconds, then off (prime)', {
      control: 'fuelPump', state: all(ever(held(eq('fuelPump', true), 2)), eq('fuelPump', false), eq('engineRunning', false)),
      key: 'fuelPump', stateLabel: 'ON, THEN OFF',
      why: why('A few seconds of fuel pump primes the cylinders; then off, or it floods.') }),
    // About a quarter inch: two or three taps of F3, 900-1,100 rpm once it fires (0.2 started at 1,840 rpm).
    item('throttleOpen', 'Throttle', 'Open a quarter inch', {
      control: 'throttle', state: all(gt('throttle', 0.02), lt('throttle', 0.08)), key: THROTTLE_KEYS, stateLabel: 'OPEN 1/4 INCH',
      why: why('Throttle open a quarter inch: enough air to start without racing the engine.') }),
  ]),
  engineStart: list('engineStart', 'Starting engine', [
    item('propArea', 'Propeller area', 'Clear', {
      control: null, state: null, key: null,
      why: why('Nobody near the propeller: look both sides and call "clear prop".') }),
    item('start', 'Magnetos', 'Start, release when the engine starts', {
      control: 'magnetos', state: eq('engineRunning', true), key: 'starter', stateLabel: 'START',
      why: why('Hold the key at start until it fires, then let go at once.') }),
    item('oilPressure', 'Oil pressure', 'Rising', {
      control: 'oil', state: gt('oilPsi', 20), key: null,
      why: why('No oil pressure within 30 seconds: shut down before the engine is damaged.') }),
  ]),
  afterStart: list('afterStart', 'After starting engine', [
    item('rpm', 'Throttle', '1,000 rpm', {
      control: 'throttle', state: all(ge('rpm', 800), le('rpm', 1200)), key: THROTTLE_KEYS,
      why: why('1,000 rpm after the start lets the oil reach everything before more power.') }),
    item('ammeter', 'Ammeter', 'Charging', {
      control: 'alternator', state: eq('alternator', true), key: 'alternator',
      why: why('Ammeter charging: the alternator is now carrying the electrics, not the battery.') }),
    item('avionicsOn', 'Avionics switch', 'On', {
      control: 'avionics', state: eq('avionics', true), key: 'avionics',
      why: why('Avionics on now: the start is over, so the radios are safe.') }),
    item('navLights', 'Navigation lights', 'On', {
      control: 'navLights', state: eq('lightNav', true), key: 'navLights',
      why: why('Navigation lights on: other traffic can see us.') }),
    flapsUpTaxi,
  ]),
  runup: list('runup', 'Engine run-up', [
    item('parkingBrake', 'Parking brake', 'Set', {
      control: 'parkingBrake', state: eq('parkingBrake', true), key: 'parkingBrake',
      why: why('Parking brake set: at 1,800 rpm the aircraft would creep forward.') }),
    fuelBoth,
    mixtureRich,
    item('runupRpm', 'Throttle', '1,800 rpm', {
      control: 'throttle', state: all(ge('rpm', 1700), le('rpm', 1900)), key: THROTTLE_KEYS,
      why: why('1,800 rpm is where the magneto and engine checks are made.') }),
    item('magCheck', 'Magnetos', 'Check: drop 150 max, 50 difference', {
      control: 'magnetos', state: null, key: '2 / 3 / 4',
      why: why('Each magneto alone: a big drop or rough running means a fault.') }),
    item('suction', 'Suction', 'Green', {
      control: null, state: all(ge('suctionInHg', 4.5), le('suctionInHg', 5.5)), key: null,
      why: why('Suction in the green: the vacuum pump drives the attitude and heading gyros.') }),
    item('engineInstruments', 'Engine instruments', 'Green', {
      control: 'oil', state: null, key: null,
      why: why('Oil pressure and temperature in the green before we ask for full power.') }),
    item('idle', 'Throttle', 'Idle check, then 1,000 rpm', {
      control: 'throttle', state: lt('rpm', 1200), key: 'throttleDown', stateLabel: 'IDLE, THEN 1,000 RPM',
      why: why('An idle check proves the engine will not stop when we close the throttle.') }),
  ]),
  beforeTakeoff: list('beforeTakeoff', 'Before take-off', [
    item('controls', 'Flight controls', 'Free and correct', {
      control: 'yoke', state: null, key: null,
      why: why('Full and free, the right way: a jammed or crossed control is found now.') }),
    item('instruments', 'Flight instruments', 'Set', {
      control: 'ai', state: null, key: null,
      why: why('Altimeter set, heading aligned with the compass, attitude erect.') }),
    fuelBoth,
    mixtureRich,
    item('trim', 'Elevator trim', 'Take-off', {
      control: 'trimWheel', state: all(ge('trim', -0.3), le('trim', 0.4)), key: TRIM_KEYS, stateLabel: 'TAKE-OFF',
      why: why('Trim set for take-off, or the nose rises too early or too late.') }),
    item('flaps', 'Flaps', 'Up', {
      control: 'flapLever', state: lt('flapsDeg', 1), key: 'flapsUp', critical: true,
      why: why('Flaps up for a normal take-off.') }),
    magsBoth,
    item('strobes', 'Strobes', 'On', {
      control: 'strobes', state: eq('lightStrobe', true), key: 'strobes',
      why: why('Strobes on as we enter the runway, so we are seen.') }),
    landingLightOn,
    item('parkingBrakeOff', 'Parking brake', 'Off', {
      control: 'parkingBrake', state: eq('parkingBrake', false), key: 'parkingBrake',
      why: why('Parking brake off, or we will not roll on the take-off.') }),
  ]),
  afterTakeoff: list('afterTakeoff', 'After take-off', [
    item('flapsUp', 'Flaps', 'Up', {
      control: 'flapLever', state: lt('flapsDeg', 1), key: 'flapsUp',
      why: why('Flaps up in the climb: less drag, a better climb rate.') }),
    item('climbPower', 'Power', 'Full', {
      control: 'throttle', state: ge('throttle', 0.95), key: 'throttleFull',
      why: why('Full power for the climb, at Vy.') }),
    item('engineInstruments', 'Engine instruments', 'Green', {
      control: 'oil', state: null, key: null,
      why: why('Oil temperature rises in the climb: check it stays in the green.') }),
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
    item('engine', 'Engine', 'Temperatures and pressures green, mixture rich', {
      control: 'mixture', state: ge('mixture', 0.95), key: 'mixtureRich',
      why: why('Engine: temperatures and pressures green, mixture rich for full power.') }),
    item('location', 'Location', 'Clear of towns, airfields and cloud', {
      control: null, state: null, key: null,
      why: why('Location: away from towns, airfields and cloud, in case it goes wrong.') }),
    lookout,
  ]),
  // Downwind checks (BUMFH): Brakes, Undercarriage, Mixture, Fuel, Harnesses (and hatches).
  downwind: list('downwind', 'Downwind checks', [
    item('brakes', 'Brakes', 'Off, pressure checked', {
      control: 'parkingBrake', state: eq('parkingBrake', false), key: 'parkingBrake', stateLabel: 'OFF',
      why: why('Brakes off and firm: landing with the parking brake on bursts tyres.') }),
    item('undercarriage', 'Undercarriage', 'Down and welded', {
      control: null, state: null, key: null,
      why: why('Fixed gear: down and welded, but say it, so it is a habit.') }),
    mixtureRich,
    fuelBoth,
    item('harnesses', 'Harnesses and hatches', 'Secure', {
      control: null, state: null, key: null,
      why: why('Harnesses tight and doors shut before the landing.') }),
    landingLightOn,
  ]),
  final: list('final', 'Final', [
    item('flapsLanding', 'Flaps', 'As required', {
      control: 'flapLever', state: null, key: 'flapsDown',
      why: why('Landing flap set on final: a lower, slower approach.') }),
    mixtureRich,
    item('runwayClear', 'Runway', 'Clear', {
      control: null, state: null, key: null,
      why: why('Nobody on the runway: if it is not clear, we go around.') }),
  ]),
  afterLanding: list('afterLanding', 'After landing', [
    item('flapsUp', 'Flaps', 'Up', {
      control: 'flapLever', state: lt('flapsDeg', 1), key: 'flapsUp',
      why: why('Flaps up once clear of the runway: they are not needed to taxi.') }),
    item('strobesOff', 'Strobes', 'Off', {
      control: 'strobes', state: eq('lightStrobe', false), key: 'strobes',
      why: why('Strobes off on the ground: they dazzle other pilots.') }),
    item('landingLightOff', 'Landing light', 'Off', {
      control: 'landingLight', state: eq('lightLanding', false), key: 'landingLight',
      why: why('Landing light off off the runway: it dazzles and shortens the bulb.') }),
    item('fuelPump', 'Fuel pump', 'Off', {
      control: 'fuelPump', state: eq('fuelPump', false), key: 'fuelPump',
      why: why('Fuel pump off: it is only for start, take-off and landing.') }),
  ]),
  // Shutdown: its own reasons (the before-start ones are about the start).
  shutdown: list('shutdown', 'Shutdown', [
    item('parkingBrake', 'Parking brake', 'Set', {
      control: 'parkingBrake', state: eq('parkingBrake', true), key: 'parkingBrake',
      why: why('Parking brake set: the aircraft stays put once we leave it.') }),
    item('throttleIdle', 'Throttle', 'Idle', {
      control: 'throttle', state: lt('throttle', 0.05), key: 'throttleIdle',
      why: why('Throttle closed: the engine stops cleanly from idle.') }),
    item('avionicsOff', 'Avionics switch', 'Off', {
      control: 'avionics', state: eq('avionics', false), key: 'avionics',
      why: why('Avionics off before the engine stops: no voltage spike reaches the radios.') }),
    item('mixtureCutoff', 'Mixture', 'Idle cut-off', {
      control: 'mixture', state: lt('mixture', 0.05), key: 'mixtureLean', stateLabel: 'IDLE CUT-OFF',
      why: why('Mixture to cut-off stops the engine by starving it of fuel.') }),
    item('magsOff', 'Magnetos', 'Off', {
      control: 'magnetos', state: eq('mags', 0), key: 'magnetoOff',
      why: why('Magnetos off and the key out: a live magneto can fire the engine.') }),
    item('masterOff', 'Master switch', 'Off', {
      control: 'master', state: eq('master', false), key: 'masterSwitch',
      why: why('Master off, or the battery is flat by tomorrow.') }),
    item('fuelSelectorTank', 'Fuel selector', 'Left or right', {
      control: 'fuelSelector', state: not(eq('fuelSel', 'both')), key: 'fuelSelector', stateLabel: 'LEFT OR RIGHT',
      why: why('One tank selected stops fuel crossfeeding between the tanks when parked.') }),
  ]),
  // Engine failure touch drills (flow): the four items the L12 criterion names.
  engineFailure: list('engineFailure', 'Engine failure: touch drills', [
    item('fuelSelector', 'Fuel selector', 'Both', {
      control: 'fuelSelector', state: eq('fuelSel', 'both'), key: 'fuelSelector', critical: true,
      why: why('Fuel on both: a dry or blocked tank is the likeliest cause.') }),
    item('mixture', 'Mixture', 'Rich', {
      control: 'mixture', state: ge('mixture', 0.95), key: 'mixtureRich', critical: true,
      why: why('Mixture rich: a mixture pulled back by mistake starves the engine.') }),
    item('mags', 'Magnetos', 'Both', {
      control: 'magnetos', state: eq('mags', 3), key: 'magnetoBoth',
      why: why('Magnetos on both: a key knocked to one magneto, or off.') }),
    item('fuelPump', 'Fuel pump', 'On', {
      control: 'fuelPump', state: eq('fuelPump', true), key: 'fuelPump',
      why: why('Fuel pump on: it takes over if the engine-driven pump has failed.') }),
  ]),
  forcedLandingSecurity: list('forcedLandingSecurity', 'Forced landing: security', [
    item('mixtureCutoff', 'Mixture', 'Idle cut-off', {
      control: 'mixture', state: lt('mixture', 0.05), key: 'mixtureLean', stateLabel: 'IDLE CUT-OFF',
      why: why('No fuel to the engine: less to burn if the landing goes wrong.') }),
    item('fuelOff', 'Fuel selector', 'Off', {
      control: 'fuelSelector', state: eq('fuelSel', 'off'), key: 'fuelSelector',
      why: why('Fuel off at the selector: nothing flows to a damaged engine.') }),
    item('magsOff', 'Magnetos', 'Off', {
      control: 'magnetos', state: eq('mags', 0), key: 'magnetoOff',
      why: why('Ignition off: no sparks near spilled fuel.') }),
    item('flapsAsRequired', 'Flaps', 'As required', {
      control: 'flapLever', state: null, key: 'flapsDown',
      why: why('Flaps as the field needs: full once the field is made.') }),
    item('masterOff', 'Master switch', 'Off', {
      control: 'master', state: eq('master', false), key: 'masterSwitch',
      why: why('Master off once the flaps are set: no electrics to start a fire.') }),
    item('harnesses', 'Harnesses', 'Tight', {
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
    item('taxiLight', 'Taxi light', 'As required', {
      control: 'taxiLight', state: null, key: 'taxiLight',
      why: why('Taxi light on the ground to see the taxiway edges.') }),
    item('panelLights', 'Panel lights', 'Set', {
      control: 'panelLights', state: null, key: 'panelLights',
      why: why('Panel lights dim: bright enough to read, dark enough to see out.') }),
    item('landingLight', 'Landing light', 'On', {
      control: 'landingLight', state: eq('lightLanding', true), key: 'landingLight',
      why: why('Landing light on for the runway, so we see and are seen.') }),
  ]),
};

export const C172S: AircraftTypeDef = {
  id: 'c172s',
  name: 'Cessna 172S Skyhawk SP',
  icaoType: 'C172',
  // Fictitious; TrainingSystem picks 'G-FSCK' under EASA (registrationFor below).
  registration: 'N172FS',
  classRating: 'SEP',
  vspeeds: VSPEEDS,
  settings: SETTINGS,
  flapDetentsDeg: FLAP_DETENTS_DEG,
  flapLeverForDeg: FLAP_LEVER,
  limits: { gPos: 3.8, gNeg: -1.52, maxDemoCrosswindKt: SETTINGS.maxDemoCrosswindKt },
  checklists: CHECKLISTS,
  envelope: ENVELOPE,
  demoTuning: { maxBankDeg: 30, rollRateDps: 12 },
};

/** The fictitious registration shown in the logbook for an authority (section 2.1). */
export function registrationFor(authority: 'easa' | 'faa'): string {
  return authority === 'easa' ? 'G-FSCK' : 'N172FS';
}

/**
 * Flap lever (ControlInputs.flaps) for a flap angle in degrees: exact at the detents, linear between them
 * (a lever moved part-way). Used by the copilot and starts for `flapsDeg` values.
 */
export function flapLeverFor(type: AircraftTypeDef, deg: number): number {
  const d = type.flapDetentsDeg;
  if (deg <= d[0]) return type.flapLeverForDeg[d[0]];
  for (let i = 1; i < d.length; i++) {
    if (deg <= d[i]) {
      const a = type.flapLeverForDeg[d[i - 1]];
      const b = type.flapLeverForDeg[d[i]];
      return a + ((b - a) * (deg - d[i - 1])) / (d[i] - d[i - 1]);
    }
  }
  return type.flapLeverForDeg[d[d.length - 1]];
}

/** Inverse of flapLeverFor: the flap angle (degrees) a lever position selects. */
export function flapDegForLever(type: AircraftTypeDef, lever: number): number {
  const d = type.flapDetentsDeg;
  const lv = (deg: number) => type.flapLeverForDeg[deg];
  if (lever <= lv(d[0])) return d[0];
  for (let i = 1; i < d.length; i++) {
    if (lever <= lv(d[i])) return d[i - 1] + ((d[i] - d[i - 1]) * (lever - lv(d[i - 1]))) / (lv(d[i]) - lv(d[i - 1]));
  }
  return d[d.length - 1];
}
