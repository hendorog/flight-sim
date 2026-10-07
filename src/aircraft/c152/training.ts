// Cessna 152 (1978 model): the Flight School's type data (V-speeds, settings, flap detents, limits, checklists,
// safety envelope). Data only (contract 3.9): the school does not teach in this type (decision D5), but the
// instructor's wording, the checklists of the free-flight cards and the logbook read it.
//
// Speeds come from ./reference (the same table the HUD, the scenarios and the autoflight use). Checklist wording
// follows the 1978 POH normal procedures as the type's engineering data sheet gives them (aircraft-data/c152.md
// in the design work folder, s.10; SCHOOL marks common flying-school practice there). Items over a control the
// telemetry has no signal for (carburettor heat, the circuit breakers) have `state: null` and are confirmed with
// Enter. There is no electric fuel pump and no avionics master: the avionics key stands for the radios.

import { all, eq, ge, gt, le, lt } from '../../training/engine/dsl';
import type {
  AircraftSettingId, AircraftTypeDef, ChecklistDef, ChecklistId, ChecklistItem, ChecklistKeyPair, CueRef, PointTarget, Pred, SafetyEnvelope, VSpeedId,
} from '../../training/types';
import { C152_REFERENCE } from './reference';

const R = C152_REFERENCE;

/** Flap detents (degrees) and the ControlInputs.flaps lever value of each: stops at 10 and 20, full travel 30 (s.2.1). */
const FLAP_MAX_DEG = 30;
const FLAP_DETENTS_DEG = [0, 10, 20, 30];
const FLAP_LEVER: Record<number, number> = Object.fromEntries(FLAP_DETENTS_DEG.map((d) => [d, d / FLAP_MAX_DEG]));

/** POH airspeeds, KIAS (s.7, s.8, s.10). The shared ones are the reference table's. */
const VSPEEDS: Record<VSpeedId, number> = {
  Vs0: R.vs0,
  Vs1: R.vs1,
  Vr: R.vr,
  Vx: R.vx,
  Vy: R.vy,
  Vcc: 75, // en-route climb 70-80
  Vglide: R.vglide,
  Va: R.va,
  Vfe10: R.vfe[0],
  VfeFull: R.vfe[R.vfe.length - 1],
  Vno: R.vno,
  Vne: R.vne,
  Vapp: R.vapp,
  VappFlapsUp: 70, // POH normal approach flaps up 60-70
  Vref: R.vref,
  VshortField: 54, // short-field approach, flaps 30
  Vcruise: R.vcruise,
  Vslow: 50, // slow flight, flaps as required (SCHOOL 50-55)
  VsteepTurn: 95, // POH recommended entry speed for steep turns
  Vdescent: 90, // cruise descent at 2000-2100 rpm (SCHOOL)
  Vdownwind: R.vdownwind,
  Vtaxi: 15, // ground speed, kt
};

const SETTINGS: Record<AircraftSettingId, number> = {
  patternAglFt: 1000,
  cruiseRpm: 2350, // 2300-2400, leaned (s.11)
  descentRpm: 2000, // cruise descent 2000-2100 (s.11)
  circuitRpm: 2150, // downwind 2100-2200 (s.11)
  runupRpm: 1700,
  magDropMaxRpm: 125,
  magDiffMaxRpm: 50,
  approachFlapLever: FLAP_LEVER[30],
  takeoffFlapLever: FLAP_LEVER[0],
  shortFieldFlapLever: FLAP_LEVER[10],
  maxDemoCrosswindKt: 12,
};

/** Defaults of the safety monitor (section 3.8 of the school's design), as the C172S's. */
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

const THROTTLE_KEYS: ChecklistKeyPair = { raise: 'throttleUp', lower: 'throttleDown' };
const TRIM_KEYS: ChecklistKeyPair = { raise: 'trimNoseUp', lower: 'trimNoseDown' };

// Item building blocks shared by several lists (same id and predicate wherever they appear).
const fuelOn = item('fuelSelector', 'Fuel shut-off valve', 'On', {
  control: 'fuelSelector', state: eq('fuelSel', 'on'), key: 'fuelSelector', critical: true,
  why: why('Fuel valve on: both wing tanks feed the engine together, by gravity.') });
const mixtureRich = item('mixture', 'Mixture', 'Rich', {
  control: 'mixture', state: ge('mixture', 0.95), key: 'mixtureRich', critical: true,
  why: why('Mixture fully rich below 3,000 feet: full power and a cool engine.') });
const carbHeatCold = item('carbHeat', 'Carburettor heat', 'Cold', {
  control: null, state: null, key: 'carbHeat', stateLabel: 'COLD',
  why: why('Carburettor heat cold: hot air is unfiltered and costs power.') });
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
    item('breakers', 'Circuit breakers', 'Check in', {
      control: null, state: null, key: null,
      why: why('A tripped breaker now means a fault before we even start.') }),
    item('radiosOff', 'Radios', 'Off', {
      control: 'avionics', state: eq('avionics', false), key: 'avionics',
      why: why("Radios off for the start: the starter's voltage dip can damage them.") }),
    fuelOn,
    mixtureRich,
    carbHeatCold,
    // About half an inch: two or three taps of F3.
    item('throttleOpen', 'Throttle', 'Open half an inch', {
      control: 'throttle', state: all(gt('throttle', 0.02), lt('throttle', 0.12)), key: THROTTLE_KEYS, stateLabel: 'OPEN 1/2 INCH',
      why: why('Throttle open half an inch: enough air to start without racing the engine.') }),
    item('master', 'Master switch', 'On', {
      control: 'master', state: eq('master', true), key: 'masterSwitch',
      why: why('Master on: it powers the starter, the beacon and the gauges.') }),
    item('beacon', 'Beacon', 'On', {
      control: 'beacon', state: eq('lightBeacon', true), key: 'beacon',
      why: why('Beacon on: it warns anyone outside that the engine is about to start.') }),
  ]),
  engineStart: list('engineStart', 'Starting engine', [
    item('propArea', 'Propeller area', 'Clear', {
      control: null, state: null, key: null,
      why: why('Nobody near the propeller: look both sides and call "clear prop".') }),
    item('start', 'Ignition switch', 'Start, release when the engine starts', {
      control: 'magnetos', state: eq('engineRunning', true), key: 'starter', stateLabel: 'START',
      why: why('Hold the key at start until it fires, then let go at once.') }),
    item('oilPressure', 'Oil pressure', 'Rising', {
      control: 'oil', state: gt('oilPsi', 25), key: null,
      why: why('No oil pressure within 30 seconds: shut down before the engine is damaged.') }),
  ]),
  afterStart: list('afterStart', 'After starting engine', [
    item('rpm', 'Throttle', '1,000 rpm or less', {
      control: 'throttle', state: all(ge('rpm', 800), le('rpm', 1100)), key: THROTTLE_KEYS,
      why: why('1,000 rpm or less after the start, while the oil reaches everything.') }),
    item('ammeter', 'Ammeter', 'Charging, low-voltage light out', {
      control: 'alternator', state: eq('alternator', true), key: 'alternator',
      why: why('Charging: the alternator, not the battery, now carries the electrics.') }),
    item('radiosOn', 'Radios', 'On, set', {
      control: 'avionics', state: eq('avionics', true), key: 'avionics',
      why: why('Radios on now: the start is over, so they are safe.') }),
    item('navLights', 'Navigation lights', 'On', {
      control: 'navLights', state: eq('lightNav', true), key: 'navLights',
      why: why('Navigation lights on: other traffic can see us.') }),
    flapsUpTaxi,
  ]),
  runup: list('runup', 'Engine run-up', [
    item('parkingBrake', 'Parking brake', 'Set', {
      control: 'parkingBrake', state: eq('parkingBrake', true), key: 'parkingBrake',
      why: why('Parking brake set: at 1,700 rpm the aircraft would creep forward.') }),
    fuelOn,
    mixtureRich,
    item('runupRpm', 'Throttle', '1,700 rpm', {
      control: 'throttle', state: all(ge('rpm', 1600), le('rpm', 1800)), key: THROTTLE_KEYS,
      why: why('1,700 rpm is where the magneto and carburettor heat checks are made.') }),
    item('magCheck', 'Magnetos', 'Check: drop 125 max, 50 difference', {
      control: 'magnetos', state: null, key: '2 / 3 / 4',
      why: why('Each magneto alone: a big drop or rough running means a fault.') }),
    item('carbHeatCheck', 'Carburettor heat', 'Check: rpm drops, then cold', {
      control: null, state: null, key: 'carbHeat', stateLabel: 'CHECK, THEN COLD',
      why: why('A drop proves the heat works; a rise after it means ice was there.') }),
    item('suction', 'Suction', 'Green', {
      control: null, state: all(ge('suctionInHg', 4.6), le('suctionInHg', 5.4)), key: null,
      why: why('Suction in the green: the vacuum pump drives the attitude and heading gyros.') }),
    item('engineInstruments', 'Engine instruments and ammeter', 'Green, charging', {
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
    fuelOn,
    mixtureRich,
    carbHeatCold,
    item('trim', 'Elevator trim', 'Take-off', {
      control: 'trimWheel', state: all(ge('trim', -0.3), le('trim', 0.4)), key: TRIM_KEYS, stateLabel: 'TAKE-OFF',
      why: why('Trim set for take-off, or the nose rises too early or too late.') }),
    item('flaps', 'Flaps', '0 to 10 degrees', {
      control: 'flapLever', state: lt('flapsDeg', 11), key: 'flapsUp', critical: true, stateLabel: '0-10°',
      why: why('More than 10 degrees of flap is not approved for take-off.') }),
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
    item('flapsUp', 'Flaps', 'Up, slowly, above 60 knots', {
      control: 'flapLever', state: lt('flapsDeg', 1), key: 'flapsUp',
      why: why('Flaps up slowly once safely climbing: less drag, a better climb.') }),
    item('climbPower', 'Power', 'Full', {
      control: 'throttle', state: ge('throttle', 0.95), key: 'throttleFull',
      why: why('Full throttle for the climb, at 67 knots for the best rate.') }),
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
    item('engine', 'Engine', 'Temperatures and pressures green, mixture rich, carb heat as required', {
      control: 'mixture', state: ge('mixture', 0.95), key: 'mixtureRich',
      why: why('Engine: green gauges, mixture rich, carburettor heat checked for ice.') }),
    item('location', 'Location', 'Clear of towns, airfields and cloud', {
      control: null, state: null, key: null,
      why: why('Location: away from towns, airfields and cloud, in case it goes wrong.') }),
    lookout,
  ]),
  // Downwind checks (SCHOOL, "BUMFFCH"): brakes, undercarriage, mixture, fuel, flaps, carb heat, hatches and harnesses.
  downwind: list('downwind', 'Downwind checks', [
    item('brakes', 'Brakes', 'Off, pressure checked', {
      control: 'parkingBrake', state: eq('parkingBrake', false), key: 'parkingBrake', stateLabel: 'OFF',
      why: why('Brakes off and firm: landing with the parking brake on bursts tyres.') }),
    item('undercarriage', 'Undercarriage', 'Down and welded', {
      control: null, state: null, key: null,
      why: why('Fixed gear: down and welded, but say it, so it is a habit.') }),
    mixtureRich,
    fuelOn,
    item('flapsAsRequired', 'Flaps', 'As required', {
      control: 'flapLever', state: null, key: 'flapsDown',
      why: why('Flaps as required: below 85 knots only.') }),
    item('carbHeatCheck', 'Carburettor heat', 'Check for ice, then as required', {
      control: null, state: null, key: 'carbHeat',
      why: why('Low power is coming: the carburettor ices most easily now.') }),
    item('harnesses', 'Hatches and harnesses', 'Secure', {
      control: null, state: null, key: null,
      why: why('Harnesses tight and doors shut before the landing.') }),
    landingLightOn,
  ]),
  final: list('final', 'Final', [
    item('carbHeatHot', 'Carburettor heat', 'Hot', {
      control: null, state: null, key: 'carbHeat', stateLabel: 'HOT',
      why: why('Full heat before the throttle closes: ice forms at low power.') }),
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
    carbHeatCold,
    item('strobesOff', 'Strobes', 'Off', {
      control: 'strobes', state: eq('lightStrobe', false), key: 'strobes',
      why: why('Strobes off on the ground: they dazzle other pilots.') }),
    item('landingLightOff', 'Landing light', 'Off', {
      control: 'landingLight', state: eq('lightLanding', false), key: 'landingLight',
      why: why('Landing light off off the runway: it dazzles and shortens the bulb.') }),
    item('mixtureLean', 'Mixture', 'Lean for taxi', {
      control: 'mixture', state: null, key: 'mixtureLean',
      why: why('Leaned for taxiing: this engine fouls its plugs when idled rich.') }),
  ]),
  // Shutdown: its own reasons (the before-start ones are about the start).
  shutdown: list('shutdown', 'Shutdown', [
    item('parkingBrake', 'Parking brake', 'Set', {
      control: 'parkingBrake', state: eq('parkingBrake', true), key: 'parkingBrake',
      why: why('Parking brake set: the aircraft stays put once we leave it.') }),
    item('throttleIdle', 'Throttle', '1,000 rpm', {
      control: 'throttle', state: lt('rpm', 1200), key: THROTTLE_KEYS,
      why: why('A little above idle: the engine stops cleanly without fouling a plug.') }),
    item('radiosOff', 'Radios and electrical equipment', 'Off', {
      control: 'avionics', state: eq('avionics', false), key: 'avionics',
      why: why('Radios off before the engine stops: no voltage spike reaches them.') }),
    item('mixtureCutoff', 'Mixture', 'Idle cut-off', {
      control: 'mixture', state: lt('mixture', 0.05), key: 'mixtureLean', stateLabel: 'IDLE CUT-OFF',
      why: why('Mixture to cut-off stops the engine by starving it of fuel.') }),
    item('magsOff', 'Ignition switch', 'Off, key out', {
      control: 'magnetos', state: eq('mags', 0), key: 'magnetoOff',
      why: why('Ignition off and the key out: a live magneto can fire the engine.') }),
    item('masterOff', 'Master switch', 'Off', {
      control: 'master', state: eq('master', false), key: 'masterSwitch',
      why: why('Master off, or the battery is flat by tomorrow.') }),
  ]),
  // Engine failure touch drills (POH section 3, engine failure in flight): fuel, mixture, carb heat, magnetos.
  engineFailure: list('engineFailure', 'Engine failure: touch drills', [
    item('carbHeat', 'Carburettor heat', 'On', {
      control: null, state: null, key: 'carbHeat', stateLabel: 'HOT',
      why: why('Carburettor ice is a likely cause: full heat, and give it time.') }),
    item('fuelSelector', 'Fuel shut-off valve', 'On', {
      control: 'fuelSelector', state: eq('fuelSel', 'on'), key: 'fuelSelector', critical: true,
      why: why('Fuel valve on: a valve knocked off starves the engine.') }),
    item('mixture', 'Mixture', 'Rich', {
      control: 'mixture', state: ge('mixture', 0.95), key: 'mixtureRich', critical: true,
      why: why('Mixture rich: a mixture pulled back by mistake starves the engine.') }),
    item('mags', 'Ignition switch', 'Both', {
      control: 'magnetos', state: eq('mags', 3), key: 'magnetoBoth',
      why: why('Magnetos on both: a key knocked to one magneto, or off.') }),
  ]),
  forcedLandingSecurity: list('forcedLandingSecurity', 'Forced landing: security', [
    item('mixtureCutoff', 'Mixture', 'Idle cut-off', {
      control: 'mixture', state: lt('mixture', 0.05), key: 'mixtureLean', stateLabel: 'IDLE CUT-OFF',
      why: why('No fuel to the engine: less to burn if the landing goes wrong.') }),
    item('fuelOff', 'Fuel shut-off valve', 'Off', {
      control: 'fuelSelector', state: eq('fuelSel', 'off'), key: 'fuelSelector',
      why: why('Fuel off at the valve: nothing flows to a damaged engine.') }),
    item('magsOff', 'Ignition switch', 'Off', {
      control: 'magnetos', state: eq('mags', 0), key: 'magnetoOff',
      why: why('Ignition off: no sparks near spilled fuel.') }),
    item('flapsAsRequired', 'Flaps', 'As required', {
      control: 'flapLever', state: null, key: 'flapsDown',
      why: why('Flaps as the field needs: full once the field is made.') }),
    item('masterOff', 'Master switch', 'Off', {
      control: 'master', state: eq('master', false), key: 'masterSwitch',
      why: why('Master off once the flaps are set: they are electric.') }),
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
    item('taxiLight', 'Taxi light', 'As required', {
      control: 'taxiLight', state: null, key: 'taxiLight',
      why: why('Taxi light on the ground to see the taxiway edges.') }),
    item('panelLights', 'Panel and radio lights', 'Set', {
      control: 'panelLights', state: null, key: 'panelLights',
      why: why('Panel lights dim: bright enough to read, dark enough to see out.') }),
    item('landingLight', 'Landing light', 'On', {
      control: 'landingLight', state: eq('lightLanding', true), key: 'landingLight',
      why: why('Landing light on for the runway, so we see and are seen.') }),
  ]),
};

export const C152: AircraftTypeDef = {
  id: 'c152',
  name: 'Cessna 152',
  icaoType: 'C152',
  // Fictitious; 'G-FSCB' under EASA.
  registration: 'N152FS',
  registrations: { faa: 'N152FS', easa: 'G-FSCB' },
  classRating: 'SEP',
  vspeeds: VSPEEDS,
  settings: SETTINGS,
  flapDetentsDeg: FLAP_DETENTS_DEG,
  flapLeverForDeg: FLAP_LEVER,
  // Utility category at all weights (s.7): +4.4 / -1.76 g flaps up.
  limits: { gPos: 4.4, gNeg: -1.76, maxDemoCrosswindKt: SETTINGS.maxDemoCrosswindKt },
  checklists: CHECKLISTS,
  envelope: ENVELOPE,
  demoTuning: { maxBankDeg: 30, rollRateDps: 12 },
  systems: {
    engines: 1,
    induction: 'carburettor',
    carbHeat: true,
    primer: 'manual',
    electricFuelPump: false,
    fuelSelector: ['off', 'on'],
    prop: 'fixed',
    mixture: true,
    magnetos: true,
    cowlFlaps: false,
    gear: 'fixed',
    steering: 'nosewheel',
    flapControl: 'electric',
    flapStageNames: ['up', '10', '20', '30'],
    inceptor: 'yoke',
    wing: 'high',
  },
  school: { syllabus: false, reason: 'Lessons are flown in the Cessna 172S.' },
  controls: {
    fuelSelector: { label: 'Fuel shut-off valve', where: 'the valve on the floor between the seats' },
    avionics: { label: 'Radios', where: 'each radio has its own switch; there is no avionics master' },
  },
};
