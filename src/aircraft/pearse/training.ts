// Richard Pearse 1903 Monoplane: Flight School / checklist type definition (data only, plain JSON).

import { citeChecklists } from '../../training/checklistData';
import { all, eq, ge, gt, le, lt } from '../../training/engine/dsl';
import type {
  AircraftSettingId,
  AircraftTypeDef,
  ChecklistDef,
  ChecklistId,
  ChecklistItem,
  ChecklistKeyPair,
  CueRef,
  PointTarget,
  Pred,
  SafetyEnvelope,
  VSpeedId,
} from '../../training/types';
import { PEARSE_CHECKLIST_SOURCE, PEARSE_EXTRA_CHECKLISTS } from './checklists';
import { PEARSE_REFERENCE } from './reference';

const R = PEARSE_REFERENCE;

const FLAP_MAX_DEG = 16;
const FLAP_DETENTS_DEG = [0, 8, 16];
const FLAP_LEVER: Record<number, number> = Object.fromEntries(FLAP_DETENTS_DEG.map((d) => [d, d / FLAP_MAX_DEG]));

const VSPEEDS: Record<VSpeedId, number> = {
  Vs0: R.vs0,
  Vs1: R.vs1,
  Vr: R.vr,
  Vx: R.vx,
  Vy: R.vy,
  Vcc: 41,
  Vglide: R.vglide,
  Va: R.va,
  Vfe10: R.vfe[0],
  VfeFull: R.vfe[R.vfe.length - 1],
  Vno: R.vno,
  Vne: R.vne,
  Vapp: R.vapp,
  VappFlapsUp: 41,
  Vref: R.vref,
  VshortField: 35,
  Vcruise: R.vcruise,
  Vslow: 33,
  VsteepTurn: 44,
  Vdescent: 44,
  Vdownwind: R.vdownwind,
  Vtaxi: 10,
};

const SETTINGS: Record<AircraftSettingId, number> = {
  patternAglFt: 600,
  cruiseRpm: 1000,
  descentRpm: 750,
  circuitRpm: 920,
  runupRpm: 750,
  magDropMaxRpm: 70,
  magDiffMaxRpm: 30,
  approachFlapLever: FLAP_LEVER[16],
  takeoffFlapLever: FLAP_LEVER[0],
  shortFieldFlapLever: FLAP_LEVER[8],
  maxDemoCrosswindKt: 7,
};

const ENVELOPE: SafetyEnvelope = {
  maxBankDeg: 40,
  maxPitchUpDeg: 20,
  maxPitchDownDeg: -20,
  maxKias: VSPEEDS.Vno + 6,
  maxG: 2.5,
  minG: 0.2,
  minAglFt: 600,
  lowAndSlow: { aglFt: 200, belowKias: { vspeed: 'Vs1', add: 4 } },
  maxSinkFpmBelow200: 700,
  stallAllowed: false,
  runwayExcursionM: 13,
};

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
const list = (id: ChecklistId, title: string, items: ChecklistItem[]): ChecklistDef => ({ id, title, items });

const THROTTLE_KEYS: ChecklistKeyPair = { raise: 'throttleUp', lower: 'throttleDown' };
const TRIM_KEYS: ChecklistKeyPair = { raise: 'trimNoseUp', lower: 'trimNoseDown' };

const fuelOn = item('fuelSelector', 'Overhead petrol tap', 'On', {
  control: 'fuelSelector', state: eq('fuelSel', 'on'), key: 'fuelSelector', critical: true,
  why: why('Gravity feed from the overhead brass tank to the float bowl.'),
});
const mixtureRich = item('mixture', 'Mixture lever', 'Full rich', {
  control: 'mixture', state: ge('mixture', 0.95), key: 'mixtureRich', critical: true,
  why: why('Full rich mixture for cool running of the cast-iron cylinders.'),
});
const magsBoth = item('mags', 'Spark coils', 'Both', {
  control: 'magnetos', state: eq('mags', 3), key: 'magnetoBoth',
  why: why('Both trembler coils firing both ends of the double-acting pistons.'),
});
const brakeSet = item('parkingBrake', 'Wheel brake latch', 'Set', {
  control: 'parkingBrake', state: eq('parkingBrake', true), key: 'parkingBrake',
  why: why('Holds the spoked main wheels while starting the engine.'),
});

const CHECKLISTS: Record<ChecklistId, ChecklistDef> = {
  beforeStart: list('beforeStart', 'Before starting engine', [
    item('rigging', 'Bamboo truss & wire rigging', 'Checked', {
      control: null, state: null, key: null,
      why: why('Verify lashed joints, taut landing wires and free control surfaces.'),
    }),
    brakeSet,
    fuelOn,
    mixtureRich,
  ]),
  engineStart: list('engineStart', 'Starting engine', [
    item('throttleCrack', 'Throttle', 'Cracked ~10%', {
      control: 'throttle', state: ge('throttle', 0.05), key: THROTTLE_KEYS,
      why: why('A small opening lets the surface vaporiser draw petrol.'),
    }),
    item('masterOn', 'Accumulator & dynamo', 'On', {
      control: 'master', state: eq('master', true), key: 'masterSwitch', critical: true,
      why: why('Energises the 12 V ignition accumulator and charging dynamo.'),
    }),
    item('clearProp', 'Airscrew area', 'Clear', {
      control: null, state: null, key: null,
      why: why('Clear ahead of the open front airscrew frame.'),
    }),
    item('start', 'Ignition key', 'Start (~450 RPM idle)', {
      control: 'magnetos', state: eq('engineRunning', true), key: 'starter',
      why: why('Crank until both cylinders fire evenly, then settle near 450 RPM.'),
    }),
  ]),
  afterStart: list('afterStart', 'After start', [
    item('oilPress', 'Oil pressure', 'In the green (15–45 PSI)', {
      control: 'oil', state: gt('oilPsi', 14), key: null,
      why: why('Confirms oil is reaching the double-acting piston rod glands.'),
    }),
    item('coilComms', 'Comms coil', 'On', {
      control: 'avionics', state: eq('avionics', true), key: 'avionicsMaster',
      why: why('Powers the radio transceiver for modern airfield traffic.'),
    }),
  ]),
  runup: list('runup', 'Engine run-up', [
    brakeSet,
    item('runupRpm', 'Throttle', '750 RPM', {
      control: 'throttle', state: ge('rpm', 700), key: THROTTLE_KEYS,
      why: why('Test ignition coils at mid speed before committing to take-off.'),
    }),
    magsBoth,
    item('idleCheck', 'Throttle', 'Idle (~450 RPM)', {
      control: 'throttle', state: le('rpm', 580), key: THROTTLE_KEYS,
      why: why('Verify the twin idles steadily without stalling.'),
    }),
  ]),
  beforeTakeoff: list('beforeTakeoff', 'Before take-off', [
    item('controlsFree', 'Stick & rudder bar', 'Full and free', {
      control: 'yoke', state: null, key: null,
      why: why('Check ailerons, rear elevator and rudder move freely in the right sense.'),
    }),
    item('trimSet', 'Elevator spring trim', 'Neutral', {
      control: 'trimWheel', state: all(ge('trim', -0.15), le('trim', 0.15)), key: TRIM_KEYS,
      why: why('Neutral spring bias for the 31 knot lift-off.'),
    }),
    item('flapsClean', 'Wing camber lever', '0° ( or 9° short grass )', {
      control: 'flapLever', state: le('flapsDeg', 10), key: 'flapsUp',
      why: why('Clean wing climbs best above the hedges once airborne.'),
    }),
    fuelOn,
    mixtureRich,
    magsBoth,
  ]),
  afterTakeoff: list('afterTakeoff', 'After take-off', [
    item('flapsUp', 'Wing camber lever', '0°', {
      control: 'flapLever', state: le('flapsDeg', 1), key: 'flapsUp',
      why: why('Reduce camber drag once climbing clear at 39 knots.'),
    }),
    item('climbSpeed', 'Airspeed', '39 knots (Vy)', {
      control: 'asi', state: null, key: null,
      why: why('39 knots gives the best climb rate on 24 horsepower.'),
    }),
  ]),
  hasell: list('hasell', 'HASELL checks', [
    item('height', 'Height', 'Sufficient for a 6:1 glide', {
      control: 'alt', state: null, key: null,
      why: why('Open wire rigging glides steeper than modern trainers.'),
    }),
    item('airframe', 'Airframe', 'Below 54 KIAS, camber 0°', {
      control: 'asi', state: le('flapsDeg', 1), key: 'flapsUp',
      why: why('Respect the 3 g structural limit of the bamboo spars.'),
    }),
    item('security', 'Security', 'Lap strap tight', {
      control: null, state: null, key: null,
      why: why('Open wicker seat in the slipstream — check strap tight.'),
    }),
    item('engine', 'Engine', 'Oil PSI green, petrol checked', {
      control: 'oil', state: null, key: null,
      why: why('Monitor oil pressure and remaining petrol in the overhead tank.'),
    }),
    item('location', 'Location & lookout', 'Clear of traffic and obstacles', {
      control: null, state: null, key: null,
      why: why('All-round open visibility — scan both sides and below.'),
    }),
  ]),
  downwind: list('downwind', 'Downwind', [
    fuelOn,
    mixtureRich,
    item('speed', 'Airspeed', '43 knots', {
      control: 'asi', state: null, key: null,
      why: why('Settle near 920 RPM for a steady 43 knot circuit leg.'),
    }),
  ]),
  final: list('final', 'Final approach', [
    item('flapsFull', 'Wing camber lever', '16°', {
      control: 'flapLever', state: ge('flapsDeg', 14), key: 'flapsDown',
      why: why('Full trailing-edge camber lowers touchdown speed near 28–30 knots.'),
    }),
    item('approachSpeed', 'Airspeed', '36–39 knots', {
      control: 'asi', state: null, key: null,
      why: why('Keep speed up until the flare — wire drag bleeds energy fast.'),
    }),
  ]),
  afterLanding: list('afterLanding', 'After landing', [
    item('flapsUp', 'Wing camber lever', '0°', {
      control: 'flapLever', state: le('flapsDeg', 1), key: 'flapsUp',
      why: why('Flatten wing camber so crosswinds do not lift a wing on the ground.'),
    }),
    item('landingLampOff', 'Forward lamp', 'Off', {
      control: 'landingLight', state: eq('lightLanding', false), key: 'landingLight',
      why: why('Save the small 12 V accumulator while taxiing.'),
    }),
  ]),
  shutdown: list('shutdown', 'Shutdown', [
    brakeSet,
    item('coilOff', 'Comms coil', 'Off', {
      control: 'avionics', state: eq('avionics', false), key: 'avionicsMaster',
      why: why('Switch off radio load before cutting power.'),
    }),
    item('cutoff', 'Mixture lever', 'Cut-off', {
      control: 'mixture', state: lt('mixture', 0.05), key: 'mixtureLean',
      why: why('Starves the cylinders cleanly so hot carbon cannot kick back.'),
    }),
    item('magsOff', 'Spark coils', 'Off', {
      control: 'magnetos', state: eq('mags', 0), key: 'magnetoOff', critical: true,
      why: why('Dead coils ensure the open airscrew cannot fire if touched.'),
    }),
    item('fuelOff', 'Overhead petrol tap', 'Off', {
      control: 'fuelSelector', state: eq('fuelSel', 'off'), key: 'fuelSelector',
      why: why('Prevent gravity-fed petrol flooding the carburettor while parked.'),
    }),
    item('masterOff', 'Accumulator & dynamo', 'Off', {
      control: 'master', state: eq('master', false), key: 'masterSwitch',
      why: why('Isolates the 12 V ignition accumulator.'),
    }),
  ]),
  engineFailure: list('engineFailure', 'Engine failure in flight', [
    item('airspeed', 'Airspeed', '38 knots at once', {
      control: 'asi', state: null, key: null, stateLabel: '38 KIAS',
      why: why('Pitch down promptly — wire-braced drag decays airspeed rapidly!'),
    }),
    fuelOn,
    mixtureRich,
    magsBoth,
  ]),
  forcedLandingSecurity: list('forcedLandingSecurity', 'Forced landing: security', [
    item('mixtureCutoff', 'Mixture lever', 'Cut-off', {
      control: 'mixture', state: lt('mixture', 0.05), key: 'mixtureLean',
      why: why('Shut off petrol vapour to the hot cast-iron cylinders.'),
    }),
    item('fuelOff', 'Overhead petrol tap', 'Off', {
      control: 'fuelSelector', state: eq('fuelSel', 'off'), key: 'fuelSelector',
      why: why('Isolate the overhead brass petrol tank above the pilot.'),
    }),
    item('magsOff', 'Spark coils', 'Off', {
      control: 'magnetos', state: eq('mags', 0), key: 'magnetoOff',
      why: why('Kill ignition sparks before touching down in rough pasture.'),
    }),
    item('masterOff', 'Accumulator', 'Off', {
      control: 'master', state: eq('master', false), key: 'masterSwitch',
      why: why('Disconnect battery before impact.'),
    }),
  ]),
  nightLights: list('nightLights', 'Night: lamps', [
    item('navLights', 'Marker lamps', 'On', {
      control: 'navLights', state: eq('lightNav', true), key: 'navLights',
      why: why('Wingtip and rudder position lamps on.'),
    }),
    item('panelLights', 'Binnacle lantern', 'Set', {
      control: 'panelLights', state: null, key: 'panelLights',
      why: why('Warm brass lantern illuminates the mahogany instrument board.'),
    }),
    item('landingLight', 'Forward lamp', 'On', {
      control: 'landingLight', state: eq('lightLanding', true), key: 'landingLight',
      why: why('Lights the grass strip ahead of the nosewheel.'),
    }),
  ]),
};

export const PEARSE: AircraftTypeDef = {
  id: 'pearse',
  name: 'Richard Pearse 1903 Monoplane',
  icaoType: 'PRSE',
  registration: 'ZK-RWP',
  registrations: { faa: 'N1903P', easa: 'ZK-RWP' },
  classRating: 'SEP',
  vspeeds: VSPEEDS,
  settings: SETTINGS,
  flapDetentsDeg: FLAP_DETENTS_DEG,
  flapLeverForDeg: FLAP_LEVER,
  limits: { gPos: 3.0, gNeg: -1.2, maxDemoCrosswindKt: SETTINGS.maxDemoCrosswindKt },
  checklists: { ...citeChecklists(CHECKLISTS, PEARSE_CHECKLIST_SOURCE), ...PEARSE_EXTRA_CHECKLISTS },
  envelope: ENVELOPE,
  demoTuning: { maxBankDeg: 20, rollRateDps: 10 },
  systems: {
    engines: 1,
    induction: 'carburettor',
    carbHeat: false,
    primer: 'none',
    electricFuelPump: false,
    fuelSelector: ['off', 'on'],
    prop: 'fixed',
    mixture: true,
    magnetos: true,
    cowlFlaps: false,
    gear: 'fixed',
    steering: 'nosewheel',
    flapControl: 'manualLever',
    flapStageNames: ['0', '8', '16'],
    inceptor: 'stick',
    wing: 'high',
  },
  school: {
    syllabus: false,
    reason: 'Flight School lessons are flown in the Cessna 172S; enjoy free flight in Richard Pearse’s 1903 Waitohi Monoplane!',
  },
};
