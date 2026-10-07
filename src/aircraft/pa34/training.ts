// Piper PA-34-200 Seneca I: the Flight School's type data (V-speeds, settings, flap detents, limits, checklists,
// safety envelope). Data only (contract 3.9): the school does not teach in this type (decision D5), but the
// instructor's wording, the checklists of the free-flight cards and the logbook read it.
//
// Speeds come from ./reference (the same table the HUD, the scenarios and the autoflight use); the manuals give
// them in mph CAS and the reference table in knots. Checklist wording follows the handbook and flight manual
// procedures as the type's engineering data sheet gives them (aircraft-data/pa34.md in the design work folder,
// s.10; s.11 the power settings taught). The telemetry's control signals are the all-engine scalars (training/
// telemetry core provider): an item that must hold on BOTH engines is checked on them where the two move
// together (both mixtures, both fuel pumps), and items over a control the telemetry has no signal for (the gear,
// the propellers, the cowl flaps, alternate air, one engine's switches) have `state: null` and are confirmed
// with Enter. There is no avionics master: the avionics key stands for the radios.

import { all, eq, ge, gt, le, lt } from '../../training/engine/dsl';
import type {
  AircraftSettingId, AircraftTypeDef, ChecklistDef, ChecklistId, ChecklistItem, ChecklistKeyPair, CueRef, PointTarget, Pred, SafetyEnvelope, VSpeedId,
} from '../../training/types';
import { PA34_REFERENCE } from './reference';

const R = PA34_REFERENCE;

/** Flap detents (degrees) and the ControlInputs.flaps lever value of each: the floor lever's notches (s.2.1). */
const FLAP_MAX_DEG = 40;
const FLAP_DETENTS_DEG = [0, 10, 25, 40];
const FLAP_LEVER: Record<number, number> = Object.fromEntries(FLAP_DETENTS_DEG.map((d) => [d, d / FLAP_MAX_DEG]));

/** Handbook airspeeds, KIAS (s.7, s.8, s.10, s.11). The shared ones are the reference table's. */
const VSPEEDS: Record<VSpeedId, number> = {
  Vs0: R.vs0,
  Vs1: R.vs1,
  Vr: R.vr,
  Vx: R.vx,
  Vy: R.vy,
  Vcc: 104, // cruise climb, 120 mph at 25 inHg and 2,500 rpm (s.11)
  Vglide: R.vglide,
  Va: R.va,
  Vfe10: R.vfe[0],
  VfeFull: R.vfe[R.vfe.length - 1],
  Vno: R.vno,
  Vne: R.vne,
  Vapp: R.vapp,
  VappFlapsUp: 96, // flapless approach: the base speed with flaps up, 110 mph (s.10)
  Vref: R.vref,
  VshortField: 76, // short-field final, 87 mph (s.10)
  Vcruise: R.vcruise,
  Vslow: 72, // slow flight, gear down at 13-15 inHg (s.11): Vs1 + 8
  VsteepTurn: 120, // entry below Va (127)
  Vdescent: 130, // cruise descent
  Vdownwind: R.vdownwind,
  Vtaxi: 15, // ground speed, kt
};

const SETTINGS: Record<AircraftSettingId, number> = {
  patternAglFt: 1000,
  cruiseRpm: 2400, // normal cruise, 22-24 inHg (s.11)
  descentRpm: 2400,
  circuitRpm: 2500, // abeam the threshold: 15 inHg, 2,500 rpm (s.11)
  runupRpm: 2000, // magnetos and propellers checked at 2,000 rpm (s.10)
  magDropMaxRpm: 175,
  magDiffMaxRpm: 50,
  approachFlapLever: FLAP_LEVER[40],
  takeoffFlapLever: FLAP_LEVER[0],
  shortFieldFlapLever: FLAP_LEVER[25],
  maxDemoCrosswindKt: 13, // 15 mph (s.7)
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
const PROP_KEYS: ChecklistKeyPair = { raise: 'propIncrease', lower: 'propDecrease' };

// Item building blocks shared by several lists (same id and predicate wherever they appear).
const fuelOn = item('fuelSelectors', 'Fuel selectors', 'Both ON', {
  control: 'fuelSelector', state: eq('fuelSel', 'on'), key: 'fuelSelector', critical: true, stateLabel: 'ON',
  why: why('Each engine on its own tank: never crossfeed for take-off or landing.') });
const fuelPumpsOn = item('fuelPumps', 'Electric fuel pumps', 'Both on', {
  control: 'fuelPump', state: eq('fuelPump', true), key: 'fuelPump',
  why: why('Pumps on: fuel keeps coming if an engine-driven pump fails now.') });
const fuelPumpsOff = item('fuelPumpsOff', 'Electric fuel pumps', 'Off, fuel pressure checked', {
  control: 'fuelPump', state: eq('fuelPump', false), key: 'fuelPump',
  why: why('Pumps off: each engine-driven pump alone must hold pressure in the green.') });
const mixturesRich = item('mixtures', 'Mixtures', 'Rich', {
  control: 'mixture', state: ge('mixture', 0.95), key: 'mixtureRich', critical: true,
  why: why('Both mixtures rich at low level: full power and cool engines.') });
const propsForward = item('propellers', 'Propellers', 'Full forward', {
  control: null, state: null, key: PROP_KEYS, stateLabel: 'HIGH RPM',
  why: why('Propellers forward: full rpm, ready for full power or a go-around.') });
const alternateAirOff = item('alternateAir', 'Alternate air', 'Off', {
  control: null, state: null, key: 'carbHeat', stateLabel: 'OFF',
  why: why('Alternate air off: it is unfiltered and costs a little power.') });
const cowlFlapsOpen = item('cowlFlaps', 'Cowl flaps', 'Open', {
  control: null, state: null, key: 'cowlFlapsOpen', stateLabel: 'OPEN',
  why: why('Cowl flaps open: the engines run hot on the ground and in the climb.') });
const magsOn = item('mags', 'Magnetos', 'All four on', {
  control: 'magnetos', state: eq('mags', 3), key: 'magnetoBoth',
  why: why('Two magnetos per engine, all four on: both ignition systems working.') });
const parkingBrakeSet = item('parkingBrake', 'Parking brake', 'Set', {
  control: 'parkingBrake', state: eq('parkingBrake', true), key: 'parkingBrake',
  why: why('Parking brake set: the aircraft must not roll when the engines fire.') });
const landingLightOn = item('landingLight', 'Landing light', 'On', {
  control: 'landingLight', state: eq('lightLanding', true), key: 'landingLight',
  why: why('Landing light on: we are much easier to see.') });
const gearDown = item('gear', 'Gear', 'Down, three greens', {
  control: null, state: null, key: 'gearDown', critical: true, stateLabel: 'DOWN, 3 GREEN',
  why: why('Three greens and no red: and the nose wheel seen in the nacelle mirror.') });
const lookout = item('lookout', 'Lookout', 'Clear', {
  control: null, state: null, key: null, lookout: true,
  why: why('A clearing turn: look all round, above and below, before we manoeuvre.') });
const doorsLatched = item('doors', 'Doors', 'Closed, upper latches made', {
  control: null, state: null, key: null,
  why: why('The upper latch too: a door that opens in flight is a distraction.') });

const list = (id: ChecklistId, title: string, items: ChecklistItem[]): ChecklistDef => ({ id, title, items });

const CHECKLISTS: Record<ChecklistId, ChecklistDef> = {
  beforeStart: list('beforeStart', 'Before starting engines', [
    doorsLatched,
    parkingBrakeSet,
    fuelOn,
    item('breakers', 'Circuit breakers', 'In', {
      control: null, state: null, key: null,
      why: why('A tripped breaker now means a fault before we even start.') }),
    item('radiosOff', 'Radios', 'Off', {
      control: 'avionics', state: eq('avionics', false), key: 'avionics',
      why: why("Radios off for the start: the starter's voltage dip can damage them.") }),
    cowlFlapsOpen,
    alternateAirOff,
    gearDown,
  ]),
  engineStart: list('engineStart', 'Starting engines (each in turn)', [
    item('throttleOpen', 'Throttles', 'Open half an inch', {
      control: 'throttle', state: all(gt('throttle', 0.02), lt('throttle', 0.15)), key: THROTTLE_KEYS, stateLabel: 'OPEN 1/2 INCH',
      why: why('Throttle open half an inch: enough air to start without racing the engine.') }),
    propsForward,
    item('master', 'Master and alternators', 'On', {
      control: 'master', state: eq('master', true), key: 'masterSwitch',
      why: why('Master on: it powers the starter, the pumps and the gauges.') }),
    magsOn,
    fuelPumpsOn,
    mixturesRich,
    item('primed', 'Electric fuel pumps', 'Off once fuel flow shows', {
      control: 'fuelPump', state: eq('fuelPump', false), key: 'fuelPump',
      why: why('Three to five seconds of fuel flow primes a cold engine; left running, the pump floods it.') }),
    item('propArea', 'Propeller area', 'Clear', {
      control: null, state: null, key: null,
      why: why('Nobody near either propeller: look both sides and call "clear prop".') }),
    item('start', 'Starter', 'Engage, release when the engine fires; then the other engine', {
      control: 'magnetos', state: eq('engineRunning', true), key: 'starter', stateLabel: 'START',
      why: why('Thirty seconds of cranking at most, then let the starter cool.') }),
    item('oilPressure', 'Oil pressure', 'Rising within 30 seconds, each engine', {
      control: 'oil', state: gt('oilPsi', 25), key: null,
      why: why('No oil pressure within 30 seconds: shut that engine down.') }),
  ]),
  afterStart: list('afterStart', 'After starting engines', [
    item('rpm', 'Throttles', '1,000 rpm', {
      control: 'throttle', state: all(ge('rpm', 800), le('rpm', 1200)), key: THROTTLE_KEYS,
      why: why('About 1,000 rpm to warm up, while the oil reaches everything.') }),
    fuelPumpsOff,
    item('alternators', 'Alternators', 'On, both charging', {
      control: 'alternator', state: eq('alternator', true), key: 'alternator',
      why: why('Both load meters showing: each alternator carries half of the load.') }),
    item('radiosOn', 'Radios', 'On, set', {
      control: 'avionics', state: eq('avionics', true), key: 'avionics',
      why: why('Radios on now: the starts are over, so they are safe.') }),
    item('navLights', 'Navigation lights', 'As required', {
      control: 'navLights', state: null, key: 'navLights',
      why: why('Navigation lights on at night or in poor light: other traffic can see us.') }),
    item('flapsUp', 'Flaps', 'Up', {
      control: 'flapLever', state: lt('flapsDeg', 1), key: 'flapsUp',
      why: why('Flaps up for taxiing: the right flap is the step for getting in.') }),
  ]),
  runup: list('runup', 'Engine run-up', [
    item('parkingBrake', 'Parking brake', 'Set', {
      control: 'parkingBrake', state: eq('parkingBrake', true), key: 'parkingBrake',
      why: why('Parking brake set: at 2,000 rpm the aircraft would creep forward.') }),
    fuelOn,
    mixturesRich,
    propsForward,
    item('featherCheck', 'Propellers', 'Feather check at 1,500 rpm', {
      control: null, state: null, key: 'propFeather', stateLabel: 'FEATHER, THEN FORWARD',
      why: why('Lever to feather and straight back: rpm should start to fall.') }),
    item('runupRpm', 'Throttles', '2,000 rpm', {
      control: 'throttle', state: all(ge('rpm', 1900), le('rpm', 2100)), key: THROTTLE_KEYS,
      why: why('2,000 rpm is where the propellers and magnetos are checked.') }),
    item('propExercise', 'Propellers', 'Exercise: 200 to 300 rpm drop', {
      control: null, state: null, key: PROP_KEYS, stateLabel: 'EXERCISE',
      why: why('Cycling the levers puts warm oil in the hubs and proves the governors.') }),
    item('alternateAirCheck', 'Alternate air', 'On, small drop, then off', {
      control: null, state: null, key: 'carbHeat', stateLabel: 'CHECK, THEN OFF',
      why: why('A small drop proves the alternate air door opens.') }),
    item('magCheck', 'Magnetos', 'Check: drop 175 max, 50 difference', {
      control: 'magnetos', state: null, key: '2 / 3 / 4',
      why: why('Each magneto alone: a big drop or rough running means a fault.') }),
    item('alternatorCheck', 'Alternators', 'Outputs about equal', {
      control: 'alternator', state: null, key: null,
      why: why('Both load meters about equal: both alternators share the load.') }),
    item('suction', 'Vacuum', '4.5 to 5.2 inches, no red buttons', {
      control: null, state: all(ge('suctionInHg', 4.5), le('suctionInHg', 5.2)), key: null,
      why: why('Vacuum in the green: the pumps drive the attitude and heading gyros.') }),
    item('idle', 'Throttles', '800 to 1,000 rpm', {
      control: 'throttle', state: lt('rpm', 1100), key: 'throttleDown', stateLabel: '800-1,000 RPM',
      why: why('Back to a fast idle: the plugs stay clean while we wait.') }),
  ]),
  beforeTakeoff: list('beforeTakeoff', 'Before take-off', [
    fuelOn,
    item('alternatorsOn', 'Alternators', 'On', {
      control: 'alternator', state: eq('alternator', true), key: 'alternator',
      why: why('Both alternators on line before we leave the ground.') }),
    item('engineGauges', 'Engine gauges', 'Green', {
      control: 'oil', state: null, key: null,
      why: why('Oil, temperatures and fuel pressure green on both engines.') }),
    item('instruments', 'Flight instruments', 'Set', {
      control: 'ai', state: null, key: null,
      why: why('Altimeter set, heading aligned with the compass, attitude erect.') }),
    mixturesRich,
    propsForward,
    alternateAirOff,
    cowlFlapsOpen,
    item('flaps', 'Flaps', 'Set: up, or 25 degrees for a short field', {
      control: 'flapLever', state: lt('flapsDeg', 26), key: 'flapsUp', critical: true, stateLabel: '0-25°',
      why: why('Up for a normal take-off; 25 degrees only for a short field.') }),
    item('trim', 'Trim', 'Stabilator and rudder in the take-off range', {
      control: 'trimWheel', state: all(ge('trim', -0.3), le('trim', 0.5)), key: TRIM_KEYS, stateLabel: 'TAKE-OFF',
      why: why('Trim set for take-off, or the nose rises too early or too late.') }),
    item('controls', 'Controls', 'Free', {
      control: 'yoke', state: null, key: null,
      why: why('Full and free, the right way: a jammed or crossed control is found now.') }),
    doorsLatched,
    fuelPumpsOn,
    item('strobes', 'Strobes', 'On', {
      control: 'strobes', state: eq('lightStrobe', true), key: 'strobes',
      why: why('Strobes on as we enter the runway, so we are seen.') }),
    landingLightOn,
    item('parkingBrakeOff', 'Parking brake', 'Off', {
      control: 'parkingBrake', state: eq('parkingBrake', false), key: 'parkingBrake',
      why: why('Parking brake off, or we will not roll on the take-off.') }),
  ]),
  afterTakeoff: list('afterTakeoff', 'After take-off', [
    item('gearUp', 'Gear', 'Up, positive rate, no usable runway left', {
      control: null, state: null, key: 'gearUp', stateLabel: 'UP',
      why: why('Gear up once climbing with no runway left: less drag for one engine.') }),
    item('climbSpeed', 'Speed', 'Blue line, 91 knots', {
      control: 'asi', state: null, key: null,
      why: why('At the blue line an engine failure leaves the best one-engine climb.') }),
    item('climbPower', 'Power', '25 inches, 2,500 rpm from 500 feet', {
      control: 'throttle', state: null, key: THROTTLE_KEYS, stateLabel: '25 IN / 2,500 RPM',
      why: why('Throttles first, then propellers: a gentler climb for the engines.') }),
    fuelPumpsOff,
    item('cowlFlapsClimb', 'Cowl flaps', 'As required, heads below 475', {
      control: null, state: null, key: 'cowlFlapsOpen',
      why: why('Cowl flaps as needed: cylinder heads in the green through the climb.') }),
    item('engineInstruments', 'Engine instruments', 'Green', {
      control: 'oil', state: null, key: null,
      why: why('Temperatures rise in the climb: check both engines stay in the green.') }),
  ]),
  // Pre-manoeuvre check (EASA): Height, Airframe, Security, Engine, Location, Lookout.
  hasell: list('hasell', 'HASELL', [
    item('height', 'Height', 'Enough to recover by 4,000 ft above ground', {
      control: 'alt', state: ge('aglFt', 4000), key: null,
      why: why('Height: a stall with asymmetric power can cost 500 feet or more.') }),
    item('airframe', 'Airframe', 'Gear and flaps as required', {
      control: 'flapLever', state: null, key: null,
      why: why('Airframe: gear and flaps set for the exercise, nothing we did not mean.') }),
    item('security', 'Security', 'Harnesses tight, doors latched, nothing loose', {
      control: null, state: null, key: null,
      why: why('Security: anything loose flies around the cabin when we manoeuvre.') }),
    item('engine', 'Engines', 'Temperatures and pressures green, selectors ON, mixtures rich', {
      control: 'mixture', state: ge('mixture', 0.95), key: 'mixtureRich',
      why: why('Engines: green gauges, each on its own tank, mixtures rich.') }),
    item('location', 'Location', 'Clear of towns, airfields and cloud', {
      control: null, state: null, key: null,
      why: why('Location: away from towns, airfields and cloud, in case it goes wrong.') }),
    lookout,
  ]),
  // Before landing (s.10), as the downwind checks: brakes, gear, mixtures, fuel, propellers, cowl flaps, harnesses.
  downwind: list('downwind', 'Downwind checks', [
    item('brakes', 'Brakes', 'Off, pressure checked', {
      control: 'parkingBrake', state: eq('parkingBrake', false), key: 'parkingBrake', stateLabel: 'OFF',
      why: why('Brakes off and firm: landing with the parking brake on bursts tyres.') }),
    item('gearDownwind', 'Gear', 'Down below 130 knots, three greens', {
      control: null, state: null, key: 'gearDown', critical: true, stateLabel: 'DOWN, 3 GREEN',
      why: why('Gear down mid-field: three greens, no red, the nose wheel in the mirror.') }),
    fuelOn,
    fuelPumpsOn,
    mixturesRich,
    item('propsCircuit', 'Propellers', '2,500 rpm', {
      control: null, state: null, key: PROP_KEYS, stateLabel: '2,500 RPM',
      why: why('Propellers up to 2,500 rpm, ready for a go-around.') }),
    item('cowlFlapsDownwind', 'Cowl flaps', 'As required', {
      control: null, state: null, key: 'cowlFlapsClose',
      why: why('Cowl flaps closed or partly: the engines cool fast at low power.') }),
    item('flapsDownwind', 'Flaps', '10 degrees, below 139 knots', {
      control: 'flapLever', state: null, key: 'flapsDown',
      why: why('First notch on downwind; 25 on base, 40 on final.') }),
    item('harnesses', 'Seat backs and harnesses', 'Upright, tight', {
      control: null, state: null, key: null,
      why: why('Harnesses tight before the landing.') }),
    landingLightOn,
  ]),
  final: list('final', 'Final', [
    item('gearFinal', 'Gear', 'Rechecked: three greens', {
      control: null, state: null, key: 'gearDown', critical: true, stateLabel: '3 GREEN',
      why: why('A last look at the three greens: the gear has no up-locks.') }),
    item('flapsLanding', 'Flaps', '40 degrees, landing assured, 83 knots', {
      control: 'flapLever', state: null, key: 'flapsDown',
      why: why('Full flap only once the landing is assured: it costs a lot of climb.') }),
    propsForward,
    mixturesRich,
    item('runwayClear', 'Runway', 'Clear', {
      control: null, state: null, key: null,
      why: why('Nobody on the runway: if it is not clear, we go around.') }),
  ]),
  afterLanding: list('afterLanding', 'After landing', [
    item('flapsUp', 'Flaps', 'Up: the flap lever, not the gear', {
      control: 'flapLever', state: lt('flapsDeg', 1), key: 'flapsUp',
      why: why('Clear of the runway, and identify the flap lever before moving it.') }),
    cowlFlapsOpen,
    fuelPumpsOff,
    item('strobesOff', 'Strobes', 'Off', {
      control: 'strobes', state: eq('lightStrobe', false), key: 'strobes',
      why: why('Strobes off on the ground: they dazzle other pilots.') }),
    item('landingLightOff', 'Landing light', 'As required', {
      control: 'landingLight', state: null, key: 'landingLight',
      why: why('Landing light off clear of the runway unless we need it to taxi.') }),
    item('mixtureLean', 'Mixtures', 'Leaned for taxi', {
      control: 'mixture', state: null, key: 'mixtureLean',
      why: why('Leaned for taxiing: the engines foul their plugs when idled rich.') }),
  ]),
  // Shutdown: its own reasons (the before-start ones are about the start).
  shutdown: list('shutdown', 'Shutdown', [
    item('parkingBrake', 'Parking brake', 'Set', {
      control: 'parkingBrake', state: eq('parkingBrake', true), key: 'parkingBrake',
      why: why('Parking brake set: the aircraft stays put once we leave it.') }),
    item('radiosOff', 'Radios and electrical equipment', 'Off', {
      control: 'avionics', state: eq('avionics', false), key: 'avionics',
      why: why('Radios off before the engines stop: no voltage spike reaches them.') }),
    item('throttlesIdle', 'Throttles', '1,000 rpm', {
      control: 'throttle', state: lt('throttle', 0.15), key: THROTTLE_KEYS, stateLabel: '1,000 RPM',
      why: why('A fast idle for the cut-off: the engines stop cleanly.') }),
    item('mixtureCutoff', 'Mixtures', 'Idle cut-off', {
      control: 'mixture', state: lt('mixture', 0.05), key: 'mixtureLean', stateLabel: 'IDLE CUT-OFF',
      why: why('Mixtures to cut-off stop the engines by starving them of fuel.') }),
    item('magsOff', 'Magnetos', 'All four off', {
      control: 'magnetos', state: eq('mags', 0), key: 'magnetoOff',
      why: why('Magnetos off: a live magneto can fire an engine when the propeller is moved.') }),
    item('masterOff', 'Master and alternators', 'Off', {
      control: 'master', state: eq('master', false), key: 'masterSwitch',
      why: why('Master off, or the battery is flat by tomorrow.') }),
  ]),
  // Engine failure after take-off or in the climb (s.10, the memory drill): control, blue line, mixtures, props,
  // throttles forward, flaps up, gear up, identify, verify, feather, secure, trim, bank toward the live engine.
  engineFailure: list('engineFailure', 'Engine failure: memory drill', [
    item('control', 'Control', 'Heading held with rudder; nose down to the blue line', {
      control: 'rudderPedals', state: null, key: null,
      why: why('Hold the heading with rudder: below 69 knots it cannot be held.') }),
    item('mixturesForward', 'Mixtures', 'Forward', {
      control: 'mixture', state: ge('mixture', 0.95), key: 'mixtureRich', critical: true,
      why: why('Mixtures, propellers, throttles forward: everything the live engine has.') }),
    item('propsForward', 'Propellers', 'Forward', {
      control: null, state: null, key: 'propIncrease', stateLabel: 'FORWARD',
      why: why('Propellers forward, or the dead one cannot be feathered later.') }),
    item('throttlesForward', 'Throttles', 'Forward', {
      control: 'throttle', state: ge('throttle', 0.95), key: 'throttleFull', critical: true,
      why: why('Full power on the live engine.') }),
    item('cleanUp', 'Flaps and gear', 'Up', {
      control: 'flapLever', state: lt('flapsDeg', 1), key: 'flapsUp',
      why: why('Flaps and gear up: on one engine the drag is the difference.') }),
    item('identify', 'Identify', 'Dead foot, dead engine', {
      control: 'rudderPedals', state: null, key: null,
      why: why('The foot doing no work is on the side of the dead engine.') }),
    item('verify', 'Verify', 'Close the suspected throttle: no change', {
      control: 'throttle', state: null, key: '8 / 9, then F2',
      why: why('Close it first: feathering the good engine leaves no engine.') }),
    item('feather', 'Feather', 'Propeller of the dead engine, before 800 rpm', {
      control: null, state: null, key: 'propFeather', critical: true, stateLabel: 'DEAD ENGINE',
      why: why('A windmilling propeller costs up to 350 feet a minute of climb.') }),
    item('trimBank', 'Trim and bank', 'Rudder and stabilator trimmed, 5 degrees toward the live engine', {
      control: 'trimWheel', state: null, key: null,
      why: why('Five degrees toward the live engine: less sideslip, less rudder.') }),
  ]),
  // A forced landing with both engines failed: the Seneca's secure-the-aircraft items.
  forcedLandingSecurity: list('forcedLandingSecurity', 'Forced landing: security', [
    item('fuelOff', 'Fuel selectors', 'Off', {
      control: 'fuelSelector', state: eq('fuelSel', 'off'), key: 'fuelSelector',
      why: why('Fuel off at the selectors: nothing flows to damaged engines.') }),
    item('mixtureCutoff', 'Mixtures', 'Idle cut-off', {
      control: 'mixture', state: lt('mixture', 0.05), key: 'mixtureLean', stateLabel: 'IDLE CUT-OFF',
      why: why('No fuel to the engines: less to burn if the landing goes wrong.') }),
    item('magsOff', 'Magnetos', 'All four off', {
      control: 'magnetos', state: eq('mags', 0), key: 'magnetoOff',
      why: why('Ignition off: no sparks near spilled fuel.') }),
    item('gearAsRequired', 'Gear', 'Down on a hard field, up on soft ground or water', {
      control: null, state: null, key: 'gearDown',
      why: why('The gear absorbs the impact on a field; it digs in on soft ground.') }),
    item('flapsAsRequired', 'Flaps', 'As required when the field is made', {
      control: 'flapLever', state: null, key: 'flapsDown',
      why: why('Flaps once the field is assured: the slowest touchdown.') }),
    item('masterOff', 'Master', 'Off after the flaps and gear are set', {
      control: 'master', state: eq('master', false), key: 'masterSwitch',
      why: why('Master off last: the gear pump needs it; then no electrical sparks.') }),
    item('harnesses', 'Doors and harnesses', 'Doors unlatched, harnesses tight', {
      control: null, state: null, key: null,
      why: why('Harnesses tight, doors unlatched: we can get out after the landing.') }),
  ]),
  nightLights: list('nightLights', 'Night: lights', [
    item('navLights', 'Navigation lights', 'On', {
      control: 'navLights', state: eq('lightNav', true), key: 'navLights',
      why: why('Navigation lights on; they also dim the gear lights, so check them twice.') }),
    item('beacon', 'Beacon', 'On', {
      control: 'beacon', state: eq('lightBeacon', true), key: 'beacon',
      why: why('Beacon on whenever an engine runs.') }),
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
      why: why('Landing light on the nose leg: it works only with the gear down.') }),
  ]),
};

export const PA34: AircraftTypeDef = {
  id: 'pa34',
  name: 'Piper PA-34-200 Seneca I',
  icaoType: 'PA34',
  // Fictitious; 'G-FSSN' under EASA.
  registration: 'N34FS',
  registrations: { faa: 'N34FS', easa: 'G-FSSN' },
  classRating: 'MEP',
  vspeeds: VSPEEDS,
  settings: SETTINGS,
  flapDetentsDeg: FLAP_DETENTS_DEG,
  flapLeverForDeg: FLAP_LEVER,
  // Normal category (s.7): +3.8 g flaps up; no negative figure published, the Part 23 normal minimum -1.52.
  limits: { gPos: 3.8, gNeg: -1.52, maxDemoCrosswindKt: SETTINGS.maxDemoCrosswindKt },
  checklists: CHECKLISTS,
  envelope: ENVELOPE,
  demoTuning: { maxBankDeg: 30, rollRateDps: 10 },
  // The multi-engine speeds (s.7): Vmc 80 mph (red radial), Vsse the 90 mph one-engine training floor, Vyse 105
  // mph (blue radial), Vxse 90 mph as taught; the gear limits; flaps 25 limit; the short-field rotate, 70 mph.
  vspeedsExt: {
    Vmca: R.vmca,
    Vsse: R.vsse,
    Vyse: R.vyse,
    Vxse: 78,
    Vle: R.vle,
    Vlo: R.vloExtend,
    Vlr: R.vloRetract,
    VfeApp: R.vfe[1],
    VrShort: 61,
  },
  settingsExt: {
    redlineRpm: 2700,
    idleRpm: 650,
    approachRpm: 2500,
    cruiseMapInHg: 23,
    climbMapInHg: 25,
  },
  systems: {
    engines: 2,
    induction: 'injected',
    carbHeat: false,
    primer: 'pump',
    electricFuelPump: true,
    fuelSelector: ['on', 'off', 'crossfeed'],
    prop: 'constantSpeedFeathering',
    mixture: true,
    magnetos: true,
    cowlFlaps: true,
    gear: 'retractable',
    steering: 'nosewheel',
    flapControl: 'manualLever',
    flapStageNames: ['up', '10', '25', '40'],
    inceptor: 'yoke',
    wing: 'low',
  },
  school: { syllabus: false, reason: 'Lessons are flown in the Cessna 172S.' },
  controls: {
    fuelSelector: { label: 'Fuel selectors', where: 'two levers on the floor tunnel between the front seats: ON, OFF, CROSSFEED' },
    fuelPump: { label: 'Electric fuel pumps', where: 'the L and R rockers on the switch panel by the pilot' },
    master: { label: 'Master switch', where: 'the red rocker on the switch panel by the pilot' },
    alternator: { label: 'Alternators', where: 'the L and R ALT rockers next to the master' },
    magnetos: { label: 'Magnetos', where: 'four toggles, two per engine, either side of the starter rocker' },
    avionics: { label: 'Radios', where: 'each radio has its own switch; there is no avionics master' },
    throttle: { label: 'Throttles', where: 'the two black levers on the left of the quadrant' },
    mixture: { label: 'Mixtures', where: 'the two red levers on the right of the quadrant' },
    flapLever: { label: 'Flap lever', where: 'the hand lever on the floor tunnel between the front seats' },
    trimWheel: { label: 'Trim wheel', where: 'on the floor tunnel, the rudder trim crank beside it' },
    parkingBrake: { label: 'Parking brake', where: 'the handle under the left-centre panel' },
  },
};
