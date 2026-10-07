// Diamond DA20-C1: the Flight School's type data (V-speeds, settings, flap detents, limits, checklists, safety
// envelope). Data only (contract 3.9): the school does not teach in this type (decision D5), but the instructor's
// wording, the checklists of the free-flight cards and the logbook read it.
//
// Speeds come from ./reference (the same table the HUD, the scenarios and the autoflight use). Checklist wording
// follows the AFM Rev 29 normal procedures as the type's engineering data sheet gives them (aircraft-data/da20.md
// in the design work folder, s.10; TRG marks the school procedures guide it quotes, s.11). Items over something
// the telemetry has no signal for (the canopy, alternate air, the idle-mixture rise, the circuit breakers) have
// `state: null` and are confirmed with Enter. There is no carburettor heat; the FUEL PRIME switch is not modelled
// (the electric fuel pump primes).

import { all, eq, ge, gt, le, lt } from '../../training/engine/dsl';
import type {
  AircraftSettingId, AircraftTypeDef, ChecklistDef, ChecklistId, ChecklistItem, ChecklistKeyPair, CueRef, PointTarget, Pred, SafetyEnvelope, VSpeedId,
} from '../../training/types';
import { DA20_REFERENCE } from './reference';

const R = DA20_REFERENCE;

/** Flap positions CRUISE / T/O / LDG (degrees) and the ControlInputs.flaps lever value of each (AFM 7.3.3, s.2.3). */
const FLAP_MAX_DEG = 45;
const FLAP_DETENTS_DEG = [0, 15, 45];
const FLAP_LEVER: Record<number, number> = Object.fromEntries(FLAP_DETENTS_DEG.map((d) => [d, d / FLAP_MAX_DEG]));

/** AFM airspeeds, KIAS (s.7, s.8, s.10, s.11). The shared ones are the reference table's. */
const VSPEEDS: Record<VSpeedId, number> = {
  Vs0: R.vs0,
  Vs1: R.vs1,
  Vr: R.vr,
  Vx: R.vx,
  Vy: R.vy,
  Vcc: 80, // cruise climb 80-85 for cooling and view (s.11)
  Vglide: R.vglide,
  Va: R.va,
  Vfe10: R.vfe[0], // flaps T/O
  VfeFull: R.vfe[R.vfe.length - 1], // flaps LDG
  Vno: R.vno,
  Vne: R.vne,
  Vapp: R.vapp,
  VappFlapsUp: 65, // forced landing flaps CRUISE 64 (AFM 3.2); schools fly 65 on final (TRG)
  Vref: R.vref,
  VshortField: 55, // the AFM approach speed with flaps LDG is the short-field one (landing distances at 55)
  Vcruise: R.vcruise,
  Vslow: 55, // slow flight at 1500 rpm, then idle (TRG 7.2)
  VsteepTurn: 95, // steep turns at 90-95 (TRG 7.1)
  Vdescent: 100, // cruise descent below Vno with the fuel pump on (AFM 4.4.10)
  Vdownwind: R.vdownwind,
  Vtaxi: 15, // ground speed, kt
};

const SETTINGS: Record<AircraftSettingId, number> = {
  patternAglFt: 1000,
  cruiseRpm: 2500, // economy cruise, 2400-2500 (s.11)
  descentRpm: 2000,
  circuitRpm: 2050, // downwind 2000-2100 (s.11)
  runupRpm: 1700,
  magDropMaxRpm: 150, // drop 25-150 (AFM 4.4.6)
  magDiffMaxRpm: 50,
  approachFlapLever: FLAP_LEVER[45],
  takeoffFlapLever: FLAP_LEVER[15],
  shortFieldFlapLever: FLAP_LEVER[15],
  maxDemoCrosswindKt: 20, // AFM 2.16
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
const fuelOpen = item('fuelSelector', 'Fuel shut-off valve', 'Open', {
  control: 'fuelSelector', state: eq('fuelSel', 'on'), key: 'fuelSelector', critical: true,
  why: why('Fuel valve open: the one fuselage tank feeds the engine through it.') });
const mixtureRich = item('mixture', 'Mixture', 'Full rich', {
  control: 'mixture', state: ge('mixture', 0.95), key: 'mixtureRich', critical: true,
  why: why('Full rich for high power: it keeps the cylinders cool.') });
const fuelPumpOn = item('fuelPump', 'Fuel pump', 'On', {
  control: 'fuelPump', state: eq('fuelPump', true), key: 'fuelPump', critical: true,
  why: why('Fuel pump on below 1,400 rpm and near the ground: a backup to the engine pump.') });
const magsBoth = item('mags', 'Ignition', 'Both', {
  control: 'magnetos', state: eq('mags', 3), key: 'magnetoBoth',
  why: why('Both magnetos: two independent ignition systems, both working.') });
const parkingBrakeSet = item('parkingBrake', 'Parking brake', 'Set', {
  control: 'parkingBrake', state: eq('parkingBrake', true), key: 'parkingBrake',
  why: why('Parking brake set: the aircraft must not roll when the engine fires.') });
const canopyClosed = item('canopy', 'Canopy', 'Closed and latched, light out', {
  control: null, state: null, key: null, critical: true,
  why: why('Red handles fully forward: an unlatched canopy opens on the take-off roll.') });
const landingLightOn = item('landingLight', 'Landing light', 'On', {
  control: 'landingLight', state: eq('lightLanding', true), key: 'landingLight',
  why: why('Landing light on: we are much easier to see.') });
const flapsCruiseTaxi = item('flapsUp', 'Flaps', 'Cruise', {
  control: 'flapLever', state: lt('flapsDeg', 1), key: 'flapsUp',
  why: why('Flaps up for taxiing: down, they pick up stones from the propeller.') });
const lookout = item('lookout', 'Lookout', 'Clear', {
  control: null, state: null, key: null, lookout: true,
  why: why('A clearing turn: look all round, above and below, before we manoeuvre.') });

const list = (id: ChecklistId, title: string, items: ChecklistItem[]): ChecklistDef => ({ id, title, items });

const CHECKLISTS: Record<ChecklistId, ChecklistDef> = {
  // AFM 4.4.2.
  beforeStart: list('beforeStart', 'Before starting engine', [
    parkingBrakeSet,
    fuelOpen,
    mixtureRich,
    item('throttleIdle', 'Throttle', 'Idle', {
      control: 'throttle', state: lt('throttle', 0.05), key: 'throttleIdle',
      why: why('Throttle idle: it is opened a little only once the engine is primed.') }),
    item('avionicsOff', 'Avionics master', 'Off', {
      control: 'avionics', state: eq('avionics', false), key: 'avionics',
      why: why("Avionics off for the start: the starter's voltage dip can damage them.") }),
    item('master', 'GEN / BAT master', 'On', {
      control: 'master', state: eq('master', true), key: 'masterSwitch',
      why: why('Master on: the GEN light comes on, the starter and the gauges have power.') }),
    canopyClosed,
  ]),
  // AFM 4.4.3, cold start.
  engineStart: list('engineStart', 'Starting engine', [
    item('propArea', 'Propeller area', 'Clear', {
      control: null, state: null, key: null,
      why: why('Nobody near the propeller: look both sides and call "clear prop".') }),
    fuelPumpOn,
    item('throttleOpen', 'Throttle', 'Open a quarter inch', {
      control: 'throttle', state: all(gt('throttle', 0.02), lt('throttle', 0.12)), key: THROTTLE_KEYS, stateLabel: 'OPEN 1/4 INCH',
      why: why('A quarter inch of throttle: enough air to start without racing the engine.') }),
    item('start', 'Ignition', 'Start, release when the engine fires', {
      control: 'magnetos', state: eq('engineRunning', true), key: 'starter', stateLabel: 'START',
      why: why('Hold the key at start until it fires, 10 seconds at most.') }),
    item('oilPressure', 'Oil pressure', 'Above 10 psi within 30 seconds', {
      control: 'oil', state: gt('oilPsi', 10), key: null,
      why: why('No oil pressure within 30 seconds: shut down before the engine is damaged.') }),
  ]),
  // AFM 4.4.3 after the start, 4.4.4 before taxi.
  afterStart: list('afterStart', 'After starting engine', [
    item('rpm', 'Throttle', '1,000 rpm', {
      control: 'throttle', state: all(ge('rpm', 950), le('rpm', 1100)), key: THROTTLE_KEYS,
      why: why('1,000 rpm: not more until the oil temperature registers.') }),
    item('generator', 'Ammeter and voltmeter', 'Charging, GEN light out', {
      control: 'alternator', state: eq('alternator', true), key: 'alternator',
      why: why('GEN light out: the generator, not the battery, now carries the electrics.') }),
    item('avionicsOn', 'Avionics master', 'On, set', {
      control: 'avionics', state: eq('avionics', true), key: 'avionics',
      why: why('Avionics on now: the start is over, so they are safe.') }),
    item('navLights', 'Position lights', 'On', {
      control: 'navLights', state: eq('lightNav', true), key: 'navLights',
      why: why('Position lights on: other traffic can see us.') }),
    flapsCruiseTaxi,
  ]),
  // AFM 4.4.6.
  runup: list('runup', 'Engine run-up', [
    item('parkingBrake', 'Brakes', 'Set', {
      control: 'parkingBrake', state: eq('parkingBrake', true), key: 'parkingBrake',
      why: why('Brakes set: at 1,700 rpm the aircraft would creep forward.') }),
    canopyClosed,
    fuelOpen,
    fuelPumpOn,
    item('trim', 'Trim', 'Neutral', {
      control: 'trimWheel', state: all(ge('trim', -0.2), le('trim', 0.2)), key: TRIM_KEYS, stateLabel: 'NEUTRAL',
      why: why('Trim neutral, the take-off setting: the green light of the trim bar.') }),
    mixtureRich,
    item('runupRpm', 'Throttle', '1,700 rpm', {
      control: 'throttle', state: all(ge('rpm', 1600), le('rpm', 1800)), key: THROTTLE_KEYS,
      why: why('1,700 rpm is where the magnetos are checked.') }),
    item('magCheck', 'Magnetos', 'Check: drop 25 to 150, 50 difference', {
      control: 'magnetos', state: null, key: '2 / 3 / 4',
      why: why('Each magneto alone: no drop, or a big one, means a fault.') }),
    item('suction', 'Vacuum gauge', 'Green', {
      control: null, state: all(ge('suctionInHg', 4.5), le('suctionInHg', 5.2)), key: null,
      why: why('Suction in the green: the vacuum pump drives the attitude and heading gyros.') }),
    item('engineInstruments', 'Oil pressure, ammeter', 'Green, charging', {
      control: 'oil', state: null, key: null,
      why: why('Oil pressure 30 to 60 psi and charging before we ask for full power.') }),
    item('idle', 'Throttle', 'Idle, 975 rpm minimum', {
      control: 'throttle', state: lt('rpm', 1200), key: 'throttleDown', stateLabel: 'IDLE',
      why: why('A smooth idle above 975 rpm: the engine will not stop on the approach.') }),
    item('idleMixture', 'Mixture', 'Lean slowly: 50 to 75 rpm rise, then full rich', {
      control: 'mixture', state: null, key: 'mixtureLean',
      why: why('The idle-mixture rise proves the injection is set right; then full rich again.') }),
    item('flapsTakeoff', 'Flaps', 'T/O', {
      control: 'flapLever', state: all(gt('flapsDeg', 13), lt('flapsDeg', 17)), key: 'flapsDown', stateLabel: 'T/O',
      why: why('Take-off flap, 15 degrees: a shorter roll and a lower lift-off speed.') }),
  ]),
  // AFM 4.4.7.
  beforeTakeoff: list('beforeTakeoff', 'Before take-off', [
    item('controls', 'Flight controls', 'Free and correct', {
      control: 'yoke', state: null, key: null,
      why: why('Full and free, the right way: a jammed or crossed control is found now.') }),
    canopyClosed,
    fuelPumpOn,
    mixtureRich,
    magsBoth,
    item('flaps', 'Flaps', 'T/O', {
      control: 'flapLever', state: all(gt('flapsDeg', 13), lt('flapsDeg', 17)), key: 'flapsDown', critical: true, stateLabel: 'T/O',
      why: why('Flaps T/O, 15 degrees, for every normal take-off.') }),
    item('trim', 'Trim', 'Neutral', {
      control: 'trimWheel', state: all(ge('trim', -0.2), le('trim', 0.2)), key: TRIM_KEYS, stateLabel: 'NEUTRAL',
      why: why('Trim neutral, or the nose rises too early or too late.') }),
    item('strobes', 'Strobes', 'On', {
      control: 'strobes', state: eq('lightStrobe', true), key: 'strobes',
      why: why('Strobes on as we enter the runway, so we are seen.') }),
    landingLightOn,
    item('parkingBrakeOff', 'Parking brake', 'Off', {
      control: 'parkingBrake', state: eq('parkingBrake', false), key: 'parkingBrake',
      why: why('Parking brake off, or we will not roll on the take-off.') }),
  ]),
  // AFM 4.4.8: flaps CRUISE at 400 ft, 75 KIAS.
  afterTakeoff: list('afterTakeoff', 'After take-off', [
    item('flapsUp', 'Flaps', 'Cruise, at 400 ft above ground', {
      control: 'flapLever', state: lt('flapsDeg', 1), key: 'flapsUp',
      why: why('Flaps up once safely climbing: less drag, a better climb at 75 knots.') }),
    item('climbPower', 'Throttle', 'Full', {
      control: 'throttle', state: ge('throttle', 0.95), key: 'throttleFull',
      why: why('Full throttle for the climb; the fixed propeller turns about 2,300 rpm.') }),
    item('engineInstruments', 'Engine gauges', 'Green', {
      control: 'oil', state: null, key: null,
      why: why('Oil and cylinder temperatures rise in the climb: check they stay green.') }),
  ]),
  // Pre-manoeuvre check (EASA): Height, Airframe, Security, Engine, Location, Lookout.
  hasell: list('hasell', 'HASELL', [
    item('height', 'Height', 'Enough to recover by 3,000 ft above ground', {
      control: 'alt', state: ge('aglFt', 3000), key: null,
      why: why('Height: recovered by 3,000 feet above the ground, with room to spare.') }),
    item('airframe', 'Airframe', 'Flaps as required, clean', {
      control: 'flapLever', state: null, key: null,
      why: why('Airframe: flaps set for the exercise, nothing extended we did not mean.') }),
    item('security', 'Security', 'Harnesses tight, canopy latched, nothing loose', {
      control: null, state: null, key: null,
      why: why('Security: anything loose flies around under the canopy when we manoeuvre.') }),
    item('engine', 'Engine', 'Temperatures and pressures green, fuel pump on, mixture rich', {
      control: 'fuelPump', state: eq('fuelPump', true), key: 'fuelPump',
      why: why('Engine: green gauges; pump on, because the power will come off.') }),
    item('location', 'Location', 'Clear of towns, airfields and cloud', {
      control: null, state: null, key: null,
      why: why('Location: away from towns, airfields and cloud, in case it goes wrong.') }),
    lookout,
  ]),
  // Downwind checks (school practice, after AFM 4.4.11): brakes, gear, fuel, pump, mixture, canopy and harnesses.
  downwind: list('downwind', 'Downwind checks', [
    item('brakes', 'Brakes', 'Off, pressure checked', {
      control: 'parkingBrake', state: eq('parkingBrake', false), key: 'parkingBrake', stateLabel: 'OFF',
      why: why('Brakes off and firm: landing with the parking brake on bursts tyres.') }),
    item('undercarriage', 'Undercarriage', 'Down and welded', {
      control: null, state: null, key: null,
      why: why('Fixed gear: down and welded, but say it, so it is a habit.') }),
    fuelOpen,
    fuelPumpOn,
    mixtureRich,
    item('canopyHarnesses', 'Canopy and harnesses', 'Latched, tight', {
      control: null, state: null, key: null,
      why: why('Canopy latched and harnesses tight before the landing.') }),
    landingLightOn,
  ]),
  // AFM 4.4.11: below 78 KIAS flaps T/O, then LDG, 55 KIAS.
  final: list('final', 'Final', [
    item('flapsLanding', 'Flaps', 'LDG', {
      control: 'flapLever', state: null, key: 'flapsDown',
      why: why('Landing flap below 78 knots: a steeper, slower approach at 55 to 65.') }),
    mixtureRich,
    fuelPumpOn,
    item('runwayClear', 'Runway', 'Clear', {
      control: null, state: null, key: null,
      why: why('Nobody on the runway: if it is not clear, we go around.') }),
  ]),
  // AFM 4.4.13.
  afterLanding: list('afterLanding', 'After landing', [
    item('flapsUp', 'Flaps', 'Cruise', {
      control: 'flapLever', state: lt('flapsDeg', 1), key: 'flapsUp',
      why: why('Flaps up once clear of the runway: they are not needed to taxi.') }),
    item('strobesOff', 'Strobes', 'Off', {
      control: 'strobes', state: eq('lightStrobe', false), key: 'strobes',
      why: why('Strobes off on the ground: they dazzle other pilots.') }),
    item('landingLightOff', 'Landing light', 'Off', {
      control: 'landingLight', state: eq('lightLanding', false), key: 'landingLight',
      why: why('Landing light off the runway: it dazzles and shortens the bulb.') }),
    item('mixtureLean', 'Mixture', 'As required for taxi', {
      control: 'mixture', state: null, key: 'mixtureLean',
      why: why('It may be leaned on the ground: it fouls its plugs when idled rich.') }),
  ]),
  // AFM 4.4.14.
  shutdown: list('shutdown', 'Shutdown', [
    item('parkingBrake', 'Parking brake', 'Set', {
      control: 'parkingBrake', state: eq('parkingBrake', true), key: 'parkingBrake',
      why: why('Parking brake set: the aircraft stays put once we leave it.') }),
    item('throttleIdle', 'Throttle', 'Idle', {
      control: 'throttle', state: lt('rpm', 1200), key: THROTTLE_KEYS,
      why: why('Throttle idle: the engine is cool and stops cleanly.') }),
    item('fuelPumpOff', 'Fuel pump', 'Off', {
      control: 'fuelPump', state: eq('fuelPump', false), key: 'fuelPump',
      why: why('Fuel pump off before the shutdown, or it floods the engine.') }),
    item('avionicsOff', 'Avionics master', 'Off', {
      control: 'avionics', state: eq('avionics', false), key: 'avionics',
      why: why('Avionics off before the engine stops: no voltage spike reaches them.') }),
    item('mixtureCutoff', 'Mixture', 'Idle cut-off', {
      control: 'mixture', state: lt('mixture', 0.05), key: 'mixtureLean', stateLabel: 'IDLE CUT-OFF',
      why: why('Mixture to cut-off stops the engine by starving it of fuel.') }),
    item('magsOff', 'Ignition', 'Off, key out', {
      control: 'magnetos', state: eq('mags', 0), key: 'magnetoOff',
      why: why('Ignition off and the key out: a live magneto can fire the engine.') }),
    item('masterOff', 'GEN / BAT master', 'Off', {
      control: 'master', state: eq('master', false), key: 'masterSwitch',
      why: why('Master off, or the battery is flat by tomorrow.') }),
  ]),
  // Engine failure in flight (AFM 3.5 as the sheet condenses it): fuel, pump, mixture, alternate air, magnetos.
  engineFailure: list('engineFailure', 'Engine failure: touch drills', [
    item('fuelSelector', 'Fuel shut-off valve', 'Open', {
      control: 'fuelSelector', state: eq('fuelSel', 'on'), key: 'fuelSelector', critical: true,
      why: why('Fuel valve open: a valve knocked closed starves the engine.') }),
    fuelPumpOn,
    item('mixture', 'Mixture', 'Full rich', {
      control: 'mixture', state: ge('mixture', 0.95), key: 'mixtureRich', critical: true,
      why: why('Mixture rich: a mixture pulled back by mistake starves the engine.') }),
    item('alternateAir', 'Alternate air', 'Open', {
      control: null, state: null, key: 'carbHeat', stateLabel: 'OPEN',
      why: why('Alternate air: a blocked air filter starves the engine of air.') }),
    item('mags', 'Ignition', 'Both', {
      control: 'magnetos', state: eq('mags', 3), key: 'magnetoBoth',
      why: why('Ignition on both: a key knocked to one magneto, or off.') }),
  ]),
  forcedLandingSecurity: list('forcedLandingSecurity', 'Forced landing: security', [
    item('mixtureCutoff', 'Mixture', 'Idle cut-off', {
      control: 'mixture', state: lt('mixture', 0.05), key: 'mixtureLean', stateLabel: 'IDLE CUT-OFF',
      why: why('No fuel to the engine: less to burn if the landing goes wrong.') }),
    item('fuelOff', 'Fuel shut-off valve', 'Closed', {
      control: 'fuelSelector', state: eq('fuelSel', 'off'), key: 'fuelSelector',
      why: why('Fuel closed at the valve: nothing flows to a damaged engine.') }),
    item('fuelPumpOff', 'Fuel pump', 'Off', {
      control: 'fuelPump', state: eq('fuelPump', false), key: 'fuelPump',
      why: why('Fuel pump off: it would pump fuel into the wreckage.') }),
    item('magsOff', 'Ignition', 'Off', {
      control: 'magnetos', state: eq('mags', 0), key: 'magnetoOff',
      why: why('Ignition off: no sparks near spilled fuel.') }),
    item('flapsAsRequired', 'Flaps', 'As required', {
      control: 'flapLever', state: null, key: 'flapsDown',
      why: why('Flaps as the field needs: LDG once the field is made.') }),
    item('masterOff', 'GEN / BAT master', 'Off', {
      control: 'master', state: eq('master', false), key: 'masterSwitch',
      why: why('Master off once the flaps are set: they are electric.') }),
    item('harnesses', 'Harnesses', 'Tight; canopy unlatched just before touchdown', {
      control: null, state: null, key: null,
      why: why('Harnesses tight; an unlatched canopy lets us out after the landing.') }),
  ]),
  nightLights: list('nightLights', 'Night: lights', [
    item('navLights', 'Position lights', 'On', {
      control: 'navLights', state: eq('lightNav', true), key: 'navLights',
      why: why('Position lights on: at night they show which way we are going.') }),
    item('strobes', 'Strobes', 'On', {
      control: 'strobes', state: eq('lightStrobe', true), key: 'strobes',
      why: why('Strobes on in the air: we are seen from miles away.') }),
    item('taxiLight', 'Taxi light', 'As required', {
      control: 'taxiLight', state: null, key: 'taxiLight',
      why: why('Taxi light on the ground to see the taxiway edges.') }),
    item('panelLights', 'Instrument and flood lights', 'Set', {
      control: 'panelLights', state: null, key: 'panelLights',
      why: why('Panel lights dim: bright enough to read, dark enough to see out.') }),
    item('landingLight', 'Landing light', 'On', {
      control: 'landingLight', state: eq('lightLanding', true), key: 'landingLight',
      why: why('Landing light on for the runway, so we see and are seen.') }),
  ]),
};

export const DA20: AircraftTypeDef = {
  id: 'da20',
  name: 'Diamond DA20-C1',
  icaoType: 'DV20',
  // Fictitious; 'G-FSDA' under EASA.
  registration: 'N220FS',
  registrations: { faa: 'N220FS', easa: 'G-FSDA' },
  classRating: 'SEP',
  vspeeds: VSPEEDS,
  settings: SETTINGS,
  flapDetentsDeg: FLAP_DETENTS_DEG,
  flapLeverForDeg: FLAP_LEVER,
  // Utility category (AFM 2.10, s.7): +4.4 / -2.2 g flaps CRUISE.
  limits: { gPos: 4.4, gNeg: -2.2, maxDemoCrosswindKt: SETTINGS.maxDemoCrosswindKt },
  checklists: CHECKLISTS,
  envelope: ENVELOPE,
  demoTuning: { maxBankDeg: 30, rollRateDps: 15 },
  systems: {
    engines: 1,
    induction: 'injected',
    carbHeat: false,
    primer: 'pump',
    electricFuelPump: true,
    fuelSelector: ['off', 'on'],
    prop: 'fixed',
    mixture: true,
    magnetos: true,
    cowlFlaps: false,
    gear: 'fixed',
    steering: 'castering',
    flapControl: 'electric',
    flapStageNames: ['cruise', 'take-off', 'landing'],
    inceptor: 'stick',
    wing: 'low',
  },
  school: { syllabus: false, reason: 'Lessons are flown in the Cessna 172S.' },
  controls: {
    yoke: { label: 'Stick', where: 'the centre stick in front of the seat' },
    throttle: { where: 'the centre lever of the quadrant on the centre console' },
    mixture: { where: 'the red lever right of the throttle on the centre console' },
    flapLever: { label: 'Flap switch', where: 'the three-position switch at the bottom centre of the panel, beside its lights' },
    trimWheel: { label: 'Trim switch', where: 'the electric trim rocker on the centre console behind the throttle' },
    fuelSelector: { label: 'Fuel shut-off valve', where: 'the lever on the centre console' },
    fuelPump: { where: 'the FUEL PUMP rocker beside the master switch' },
    master: { label: 'GEN / BAT master', where: 'the red split rocker at the bottom of the panel' },
    avionics: { label: 'Avionics master' },
    parkingBrake: { where: 'the knob on the centre console ahead of the quadrant' },
  },
};
