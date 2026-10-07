// Piper PA-38-112 Tomahawk II: the Flight School's type data (V-speeds, settings, flap detents, limits, checklists,
// safety envelope). Data only (contract 3.9): the school does not teach in this type (decision D5), but the
// instructor's wording, the checklists of the free-flight cards and the logbook read it.
//
// Speeds come from ./reference (the same table the HUD, the scenarios and the autoflight use). Checklist wording
// follows the POH normal procedures (VB-2126 section 4) as the type's engineering data sheet gives them
// (aircraft-data/pa38.md in the design work folder, s.10; CLUB marks the flying-school expansion quoted there).
// Items over a control the telemetry has no signal for (carburettor heat, the circuit breakers, the primer) have
// `state: null` and are confirmed with Enter. There is no avionics master: the avionics key stands for the radios.
// The fuel selector has LEFT, RIGHT and OFF and no BOTH: "proper tank" is either tank.

import { all, any, eq, ge, gt, le, lt } from '../../training/engine/dsl';
import type {
  AircraftSettingId, AircraftTypeDef, ChecklistDef, ChecklistId, ChecklistItem, ChecklistKeyPair, CueRef, PointTarget, Pred, SafetyEnvelope, VSpeedId,
} from '../../training/types';
import { PA38_REFERENCE } from './reference';

const R = PA38_REFERENCE;

/** Flap detents (degrees) and the ControlInputs.flaps lever value of each: the hand lever's notches at 21 and 34 (s.9). */
const FLAP_MAX_DEG = 34;
const FLAP_DETENTS_DEG = [0, 21, 34];
const FLAP_LEVER: Record<number, number> = Object.fromEntries(FLAP_DETENTS_DEG.map((d) => [d, d / FLAP_MAX_DEG]));

/** POH airspeeds, KIAS (s.7, s.8, s.10). The shared ones are the reference table's. */
const VSPEEDS: Record<VSpeedId, number> = {
  Vs0: R.vs0,
  Vs1: R.vs1,
  Vr: R.vr,
  Vx: R.vx,
  Vy: R.vy,
  Vcc: 85, // cruise climb (CLUB)
  Vglide: R.vglide,
  Va: R.va,
  Vfe10: R.vfe[0],
  VfeFull: R.vfe[R.vfe.length - 1],
  Vno: R.vno,
  Vne: R.vne,
  Vapp: R.vapp,
  VappFlapsUp: 75, // flapless approach (SCHOOL practice: Vref + 8)
  Vref: R.vref,
  VshortField: 63, // short-field approach, full flap: the 50 ft speed of the landing chart less a little
  Vcruise: R.vcruise,
  Vslow: 58, // slow flight, flaps as required (SCHOOL: Vs1 + 5 or so)
  VsteepTurn: 95, // entry below Va (103)
  Vdescent: 95, // cruise descent
  Vdownwind: R.vdownwind,
  Vtaxi: 15, // ground speed, kt
};

const SETTINGS: Record<AircraftSettingId, number> = {
  patternAglFt: 1000,
  cruiseRpm: 2400, // 75 % at sea level, +20 rpm per 1000 ft (s.11)
  descentRpm: 2000,
  circuitRpm: 2050, // downwind 2000-2100 (s.11)
  runupRpm: 1800,
  magDropMaxRpm: 175,
  magDiffMaxRpm: 50,
  approachFlapLever: FLAP_LEVER[34],
  takeoffFlapLever: FLAP_LEVER[0],
  shortFieldFlapLever: FLAP_LEVER[21],
  maxDemoCrosswindKt: 15,
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
/** A tank selected: LEFT or RIGHT (there is no BOTH). */
const ON_A_TANK = any(eq('fuelSel', 'left'), eq('fuelSel', 'right'));

// Item building blocks shared by several lists (same id and predicate wherever they appear).
const fuelTank = item('fuelSelector', 'Fuel selector', 'Proper tank', {
  control: 'fuelSelector', state: ON_A_TANK, key: 'fuelSelector', critical: true, stateLabel: 'LEFT OR RIGHT',
  why: why('One tank at a time, the fuller one: there is no BOTH position.') });
const fuelPumpOn = item('fuelPump', 'Electric fuel pump', 'On', {
  control: 'fuelPump', state: eq('fuelPump', true), key: 'fuelPump',
  why: why('Electric pump on: fuel keeps coming if the engine-driven pump fails now.') });
const mixtureRich = item('mixture', 'Mixture', 'Rich', {
  control: 'mixture', state: ge('mixture', 0.95), key: 'mixtureRich', critical: true,
  why: why('Mixture fully rich at low level: full power and a cool engine.') });
const carbHeatOff = item('carbHeat', 'Carburettor heat', 'Off', {
  control: null, state: null, key: 'carbHeat', stateLabel: 'OFF',
  why: why('Carburettor heat off: hot air is unfiltered and costs power.') });
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
  why: why('Flaps up for taxiing: they are a step for getting in and out.') });
const lookout = item('lookout', 'Lookout', 'Clear', {
  control: null, state: null, key: null, lookout: true,
  why: why('A clearing turn: look all round, above and below, before we manoeuvre.') });
const doorsLatched = item('doors', 'Doors', 'Closed, both latches made', {
  control: null, state: null, key: null,
  why: why('Side and overhead latches: a door that opens in flight is a distraction.') });

const list = (id: ChecklistId, title: string, items: ChecklistItem[]): ChecklistDef => ({ id, title, items });

const CHECKLISTS: Record<ChecklistId, ChecklistDef> = {
  beforeStart: list('beforeStart', 'Before starting engine', [
    doorsLatched,
    item('breakers', 'Circuit breakers', 'In', {
      control: null, state: null, key: null,
      why: why('A tripped breaker now means a fault before we even start.') }),
    parkingBrakeSet,
    item('radiosOff', 'Radios', 'Off', {
      control: 'avionics', state: eq('avionics', false), key: 'avionics',
      why: why("Radios off for the start: the starter's voltage dip can damage them.") }),
    carbHeatOff,
    fuelTank,
  ]),
  engineStart: list('engineStart', 'Starting engine', [
    item('throttleOpen', 'Throttle', 'Open half an inch', {
      control: 'throttle', state: all(gt('throttle', 0.02), lt('throttle', 0.12)), key: THROTTLE_KEYS, stateLabel: 'OPEN 1/2 INCH',
      why: why('Throttle open half an inch: enough air to start without racing the engine.') }),
    item('master', 'Master switch', 'On', {
      control: 'master', state: eq('master', true), key: 'masterSwitch',
      why: why('Master on: it powers the starter, the fuel pump and the gauges.') }),
    fuelPumpOn,
    mixtureRich,
    item('propArea', 'Propeller area', 'Clear', {
      control: null, state: null, key: null,
      why: why('Nobody near the propeller: look both sides and call "clear prop".') }),
    item('start', 'Starter', 'Engage, release when the engine fires', {
      control: 'magnetos', state: eq('engineRunning', true), key: 'starter', stateLabel: 'START',
      why: why('Hold the key at start until it fires, then let go at once.') }),
    item('oilPressure', 'Oil pressure', 'Rising within 30 seconds', {
      control: 'oil', state: gt('oilPsi', 15), key: null,
      why: why('No oil pressure within 30 seconds: shut down before the engine is damaged.') }),
  ]),
  afterStart: list('afterStart', 'After starting engine', [
    item('rpm', 'Throttle', '800 to 1,200 rpm', {
      control: 'throttle', state: all(ge('rpm', 800), le('rpm', 1200)), key: THROTTLE_KEYS,
      why: why('800 to 1,200 rpm to warm up, while the oil reaches everything.') }),
    item('fuelPumpOff', 'Electric fuel pump', 'Off, fuel pressure checked', {
      control: 'fuelPump', state: eq('fuelPump', false), key: 'fuelPump',
      why: why('Pump off: the engine-driven pump alone must hold fuel pressure in the green.') }),
    item('ammeter', 'Alternator', 'On, ALT light out', {
      control: 'alternator', state: eq('alternator', true), key: 'alternator',
      why: why('ALT light out: the alternator, not the battery, now carries the electrics.') }),
    item('radiosOn', 'Radios', 'On, set', {
      control: 'avionics', state: eq('avionics', true), key: 'avionics',
      why: why('Radios on now: the start is over, so they are safe.') }),
    item('navLights', 'Navigation lights', 'As required', {
      control: 'navLights', state: null, key: 'navLights',
      why: why('Navigation lights on at night or in poor light: other traffic can see us.') }),
    flapsUpTaxi,
  ]),
  runup: list('runup', 'Engine run-up', [
    item('parkingBrake', 'Parking brake', 'Set', {
      control: 'parkingBrake', state: eq('parkingBrake', true), key: 'parkingBrake',
      why: why('Parking brake set: at 1,800 rpm the aircraft would creep forward.') }),
    fuelTank,
    mixtureRich,
    item('runupRpm', 'Throttle', '1,800 rpm', {
      control: 'throttle', state: all(ge('rpm', 1700), le('rpm', 1900)), key: THROTTLE_KEYS,
      why: why('1,800 rpm is where the magneto and carburettor heat checks are made.') }),
    item('magCheck', 'Magnetos', 'Check: drop 175 max, 50 difference', {
      control: 'magnetos', state: null, key: '2 / 3 / 4',
      why: why('Each magneto alone: a big drop or rough running means a fault.') }),
    item('suction', 'Vacuum', '4.8 to 5.2 inches', {
      control: null, state: all(ge('suctionInHg', 4.8), le('suctionInHg', 5.2)), key: null,
      why: why('Vacuum in the green: the pump drives the attitude and heading gyros.') }),
    item('engineInstruments', 'Oil temperature and pressure', 'Green', {
      control: 'oil', state: null, key: null,
      why: why('Oil pressure and temperature in the green before we ask for full power.') }),
    item('carbHeatCheck', 'Carburettor heat', 'Check: rpm drops, then off', {
      control: null, state: null, key: 'carbHeat', stateLabel: 'CHECK, THEN OFF',
      why: why('A drop proves the heat works; a rise after it means ice was there.') }),
    item('idle', 'Throttle', 'Idle check, then 1,000 rpm', {
      control: 'throttle', state: lt('rpm', 1200), key: 'throttleDown', stateLabel: 'IDLE, THEN 1,000 RPM',
      why: why('An idle check at 550 to 650 rpm proves the engine keeps running.') }),
  ]),
  beforeTakeoff: list('beforeTakeoff', 'Before take-off', [
    item('master', 'Master switch', 'On', {
      control: 'master', state: eq('master', true), key: 'masterSwitch',
      why: why('Master on: the fuel pump, the stall warning and the radios need it.') }),
    item('instruments', 'Flight instruments', 'Check', {
      control: 'ai', state: null, key: null,
      why: why('Altimeter set, heading aligned with the compass, attitude erect.') }),
    fuelTank,
    mixtureRich,
    fuelPumpOn,
    carbHeatOff,
    item('engineGauges', 'Engine gauges', 'Green', {
      control: 'oil', state: null, key: null,
      why: why('Oil, fuel pressure and ammeter all green before we commit to take-off.') }),
    item('flaps', 'Flaps', 'Set: up, or 21 degrees for a short field', {
      control: 'flapLever', state: lt('flapsDeg', 22), key: 'flapsUp', critical: true, stateLabel: '0-21°',
      why: why('Up for a normal take-off; the first notch only for a short field.') }),
    item('trim', 'Trim', 'Set, slightly aft of neutral', {
      control: 'trimWheel', state: all(ge('trim', -0.2), le('trim', 0.5)), key: TRIM_KEYS, stateLabel: 'TAKE-OFF',
      why: why('Trim set for take-off, or the nose rises too early or too late.') }),
    item('controls', 'Controls', 'Free', {
      control: 'yoke', state: null, key: null,
      why: why('Full and free, the right way: a jammed or crossed control is found now.') }),
    doorsLatched,
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
    item('flapsUp', 'Flaps', 'Up, slowly, above 61 knots', {
      control: 'flapLever', state: lt('flapsDeg', 1), key: 'flapsUp',
      why: why('Flaps up slowly once safely climbing: less drag, a better climb.') }),
    item('climbPower', 'Power', 'Full', {
      control: 'throttle', state: ge('throttle', 0.95), key: 'throttleFull',
      why: why('Full throttle for the climb, at 70 knots for the best rate.') }),
    item('fuelPumpOff', 'Electric fuel pump', 'Off at a safe height, fuel pressure checked', {
      control: 'fuelPump', state: eq('fuelPump', false), key: 'fuelPump',
      why: why('Pump off once climbing safely: watch the fuel pressure stay green.') }),
    item('engineInstruments', 'Engine instruments', 'Green', {
      control: 'oil', state: null, key: null,
      why: why('Oil temperature rises in the climb: check it stays in the green.') }),
  ]),
  // Pre-manoeuvre check (EASA): Height, Airframe, Security, Engine, Location, Lookout.
  hasell: list('hasell', 'HASELL', [
    item('height', 'Height', 'Enough to recover by 4,000 ft above ground', {
      control: 'alt', state: ge('aglFt', 4000), key: null,
      why: why('Height: the handbook wants stalls recovered by 4,000 feet above the ground.') }),
    item('airframe', 'Airframe', 'Flaps as required, clean', {
      control: 'flapLever', state: null, key: null,
      why: why('Airframe: flaps set for the exercise, nothing extended we did not mean.') }),
    item('security', 'Security', 'Harnesses tight, doors latched, nothing loose', {
      control: null, state: null, key: null,
      why: why('Security: anything loose flies around the cabin when we manoeuvre.') }),
    item('engine', 'Engine', 'Temperatures and pressures green, fuller tank, pump on, mixture rich', {
      control: 'mixture', state: ge('mixture', 0.95), key: 'mixtureRich',
      why: why('Engine: green gauges, the fuller tank, pump on, mixture rich.') }),
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
    fuelTank,
    fuelPumpOn,
    item('flapsAsRequired', 'Flaps', 'As required, below 89 knots', {
      control: 'flapLever', state: null, key: 'flapsDown',
      why: why('Flaps as required: below 89 knots only.') }),
    item('carbHeatCheck', 'Carburettor heat', 'Check for ice, then as required', {
      control: null, state: null, key: 'carbHeat',
      why: why('Low power is coming: the carburettor ices most easily now.') }),
    item('harnesses', 'Hatches and harnesses', 'Both latches made, harnesses tight', {
      control: null, state: null, key: null,
      why: why('Harnesses tight, side and overhead latches made before the landing.') }),
    landingLightOn,
  ]),
  final: list('final', 'Final', [
    item('flapsLanding', 'Flaps', 'Full, 34 degrees', {
      control: 'flapLever', state: null, key: 'flapsDown',
      why: why('Full flap on final, 67 knots: a lower, slower approach.') }),
    fuelPumpOn,
    mixtureRich,
    item('runwayClear', 'Runway', 'Clear', {
      control: null, state: null, key: null,
      why: why('Nobody on the runway: if it is not clear, we go around.') }),
  ]),
  afterLanding: list('afterLanding', 'After landing', [
    item('flapsUp', 'Flaps', 'Up', {
      control: 'flapLever', state: lt('flapsDeg', 1), key: 'flapsUp',
      why: why('Flaps up once clear of the runway: they are not needed to taxi.') }),
    item('fuelPumpOff', 'Electric fuel pump', 'Off', {
      control: 'fuelPump', state: eq('fuelPump', false), key: 'fuelPump',
      why: why('Pump off on the ground: the engine-driven pump is enough.') }),
    carbHeatOff,
    item('strobesOff', 'Strobes', 'Off', {
      control: 'strobes', state: eq('lightStrobe', false), key: 'strobes',
      why: why('Strobes off on the ground: they dazzle other pilots.') }),
    item('landingLightOff', 'Landing light', 'As required', {
      control: 'landingLight', state: null, key: 'landingLight',
      why: why('Landing light off off the runway unless we need it to taxi.') }),
    item('mixtureLean', 'Mixture', 'Lean for taxi', {
      control: 'mixture', state: null, key: 'mixtureLean',
      why: why('Leaned for taxiing: this engine fouls its plugs when idled rich.') }),
  ]),
  // Shutdown: its own reasons (the before-start ones are about the start).
  shutdown: list('shutdown', 'Shutdown', [
    item('parkingBrake', 'Parking brake', 'Set', {
      control: 'parkingBrake', state: eq('parkingBrake', true), key: 'parkingBrake',
      why: why('Parking brake set: the aircraft stays put once we leave it.') }),
    item('fuelPumpOff', 'Electric fuel pump', 'Off', {
      control: 'fuelPump', state: eq('fuelPump', false), key: 'fuelPump',
      why: why('Pump off: it would keep the battery and the carburettor busy.') }),
    item('radiosOff', 'Radios and electrical equipment', 'Off', {
      control: 'avionics', state: eq('avionics', false), key: 'avionics',
      why: why('Radios off before the engine stops: no voltage spike reaches them.') }),
    item('throttleIdle', 'Throttle', 'Full aft', {
      control: 'throttle', state: lt('throttle', 0.05), key: THROTTLE_KEYS, stateLabel: 'IDLE',
      why: why('Throttle closed: the engine stops cleanly at idle.') }),
    item('mixtureCutoff', 'Mixture', 'Idle cut-off', {
      control: 'mixture', state: lt('mixture', 0.05), key: 'mixtureLean', stateLabel: 'IDLE CUT-OFF',
      why: why('Mixture to cut-off stops the engine by starving it of fuel.') }),
    item('magsOff', 'Magnetos', 'Off', {
      control: 'magnetos', state: eq('mags', 0), key: 'magnetoOff',
      why: why('Ignition off and the key out: a live magneto can fire the engine.') }),
    item('masterOff', 'Master switch', 'Off', {
      control: 'master', state: eq('master', false), key: 'masterSwitch',
      why: why('Master off, or the battery is flat by tomorrow.') }),
  ]),
  // Engine failure in flight (POH 3.3): trim 70, the other tank, pump, mixture, carb heat, gauges, magnetos.
  engineFailure: list('engineFailure', 'Engine failure: touch drills', [
    item('fuelSelector', 'Fuel selector', 'Switch to the other tank', {
      control: 'fuelSelector', state: ON_A_TANK, key: 'fuelSelector', critical: true, stateLabel: 'OTHER TANK',
      why: why('An empty or blocked tank is the likeliest cause: feed from the other.') }),
    fuelPumpOn,
    item('mixture', 'Mixture', 'Rich', {
      control: 'mixture', state: ge('mixture', 0.95), key: 'mixtureRich', critical: true,
      why: why('Mixture rich: a mixture pulled back by mistake starves the engine.') }),
    item('carbHeat', 'Carburettor heat', 'On', {
      control: null, state: null, key: 'carbHeat', stateLabel: 'ON',
      why: why('Carburettor ice is a likely cause: full heat, and give it time.') }),
    item('gauges', 'Engine gauges', 'Check for the cause', {
      control: 'oil', state: null, key: null,
      why: why('Fuel pressure, oil pressure, temperature: they tell us what failed.') }),
    item('mags', 'Magnetos', 'Left, right, then both', {
      control: 'magnetos', state: eq('mags', 3), key: 'magnetoBoth',
      why: why('A failed magneto or a key knocked to one: try each, then both.') }),
  ]),
  forcedLandingSecurity: list('forcedLandingSecurity', 'Forced landing: security', [
    item('magsOff', 'Ignition', 'Off', {
      control: 'magnetos', state: eq('mags', 0), key: 'magnetoOff',
      why: why('Ignition off: no sparks near spilled fuel.') }),
    item('masterOff', 'Master switch', 'Off', {
      control: 'master', state: eq('master', false), key: 'masterSwitch',
      why: why('Master off: no electrical sparks; the flaps are by hand and need none.') }),
    item('fuelOff', 'Fuel selector', 'Off', {
      control: 'fuelSelector', state: eq('fuelSel', 'off'), key: 'fuelSelector',
      why: why('Fuel off at the selector: nothing flows to a damaged engine.') }),
    item('mixtureCutoff', 'Mixture', 'Idle cut-off', {
      control: 'mixture', state: lt('mixture', 0.05), key: 'mixtureLean', stateLabel: 'IDLE CUT-OFF',
      why: why('No fuel to the engine: less to burn if the landing goes wrong.') }),
    item('flapsAsRequired', 'Flaps', 'Full when the field is made, 67 knots', {
      control: 'flapLever', state: null, key: 'flapsDown',
      why: why('Full flap once the field is assured: the slowest touchdown.') }),
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
    item('panelLights', 'Panel lights', 'Set', {
      control: 'panelLights', state: null, key: 'panelLights',
      why: why('Panel lights dim: bright enough to read, dark enough to see out.') }),
    item('landingLight', 'Landing light', 'On', {
      control: 'landingLight', state: eq('lightLanding', true), key: 'landingLight',
      why: why('Landing light on for the runway, so we see and are seen.') }),
  ]),
};

export const PA38: AircraftTypeDef = {
  id: 'pa38',
  name: 'Piper PA-38-112 Tomahawk II',
  icaoType: 'PA38',
  // Fictitious; 'G-FSPT' under EASA.
  registration: 'N2438T',
  registrations: { faa: 'N2438T', easa: 'G-FSPT' },
  classRating: 'SEP',
  vspeeds: VSPEEDS,
  settings: SETTINGS,
  flapDetentsDeg: FLAP_DETENTS_DEG,
  flapLeverForDeg: FLAP_LEVER,
  // Utility category (s.7): +4.4 g flaps up; no negative figure published, the Part 23 utility minimum -1.76.
  limits: { gPos: 4.4, gNeg: -1.76, maxDemoCrosswindKt: SETTINGS.maxDemoCrosswindKt },
  checklists: CHECKLISTS,
  envelope: ENVELOPE,
  demoTuning: { maxBankDeg: 30, rollRateDps: 12 },
  systems: {
    engines: 1,
    induction: 'carburettor',
    carbHeat: true,
    primer: 'manual',
    electricFuelPump: true,
    fuelSelector: ['off', 'left', 'right'],
    prop: 'fixed',
    mixture: true,
    magnetos: true,
    cowlFlaps: false,
    gear: 'fixed',
    steering: 'nosewheel',
    flapControl: 'manualLever',
    flapStageNames: ['up', '21', '34'],
    inceptor: 'yoke',
    wing: 'low',
  },
  school: { syllabus: false, reason: 'Lessons are flown in the Cessna 172S.' },
  controls: {
    fuelSelector: { label: 'Fuel selector', where: 'the handle in the middle of the throttle quadrant: LEFT, RIGHT, OFF' },
    fuelPump: { label: 'Electric fuel pump', where: 'the first white rocker left of the throttle quadrant' },
    avionics: { label: 'Radios', where: 'each radio has its own switch; there is no avionics master' },
    flapLever: { label: 'Flap lever', where: 'the hand lever on the console between the seats' },
    trimWheel: { label: 'Trim wheel', where: 'on the console between the seats, behind the flap lever' },
    parkingBrake: { label: 'Parking brake', where: 'the handle under the throttle quadrant' },
  },
};
