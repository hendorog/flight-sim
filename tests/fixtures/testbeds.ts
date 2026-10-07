// Whole-aircraft test-beds: synthetic definitions built from the Cessna 172S that each switch on mechanisms the
// C172S does not have, so the flight model (and everything built on it) is proven on them before any real
// aircraft data exists. They are ASSEMBLED from the pieces the component areas exported:
//
//   aero        tests/aero/testbed.ts        (always on baseDefinition(): a fresh C172S definition per call)
//   powerplant  tests/propulsion/testbed.ts
//   gear        tests/gear/testbed.ts
//   input       tests/input/testbed.ts
//
//   TWIN_TESTBED('crCS')  two IO-360 units at y = -/+1.9 m, COUNTER-rotating constant-speed feathering
//                         propellers, nacelles with cowl flaps, two tanks with crossfeed, 14 V, rudder trim,
//                         direct nosewheel steering (the PA-34 pattern)
//   TWIN_TESTBED('coFP')  the same airframe with two C172S units, CO-rotating fixed-pitch propellers (critical
//                         engine and power yaw with the simplest propeller)
//   DIESEL_TESTBED        a co-rotating twin of FADEC diesels with a reduction gear and three-blade
//                         constant-speed feathering propellers, unfeathered by an accumulator, 28 V (the DA42 pattern)
//   STABILATOR_TESTBED    all-moving tailplane with a geared anti-servo tab that is the trim (the PA-34 pattern)
//   SPRING_TRIM_TESTBED   spring-biased elevator without a tab, flaps on a hand lever (the PA-38 pattern)
//   TTAIL_TESTBED         tailplane on the fin's tip
//   CASTER_TESTBED        free-castering nosewheel, steered by differential braking (the DA20 pattern)
//   RETRACT_TESTBED       electro-hydraulic retractable gear (PA-34 system) with scaled gear drag, 'warn' overspeed rules
//   CARB_TESTBED          an O-235-like carburetted engine with a fixed-pitch propeller on a 14 V bus (the C152 pattern)
//
// None is an aircraft: the airframe, mass, wing and tail are the C172S's wherever the mechanism does not need
// otherwise, and every twin has the C172S's ground-adjustable rudder tab and aileron rigging removed and its
// one-sided elevator trim tab put on both elevators (each would make "a symmetric twin trims with zero rudder
// and aileron" false for a reason that is not the framework). The reference speeds of the twins are measured on the
// test-bed itself: Vmca at sea level and aft CG, the keyboard rudder at full authority up to it.

import C172S_DEFINITION from '../../src/aircraft/c172s/index';
import type { AircraftDefinition, ControlSystemDef, GearConfig, PowerplantDef } from '../../src/aircraft/types';
import { C172 } from '../../src/core/c172';
import { DEG, KT, type Vec3 } from '../../src/core/math';
import type { AircraftAeroDefinition } from '../../src/physics/aero';
import type { DragItem } from '../../src/physics/aero/bodies';
import { c172FinPlanform, c172TailplanePlanform } from '../../src/physics/aero/c172Aero';
import { buildFin, buildStrips } from '../../src/physics/aero/strips';
import { C172_GEAR } from '../../src/physics/gear';
import {
  baseDefinition,
  stabilatorAeroDefinition,
  tTailAeroDefinition,
  twinAeroDefinition,
  twinHub,
} from '../aero/testbed';
import { casterGear, retractGear } from '../gear/testbed';
import { CARB_INPUT, CASTER_INPUT, FADEC_TWIN_INPUT, TWIN_INPUT } from '../input/testbed';
import { CARB_POWERPLANT, TWIN_CS_POWERPLANT, TWIN_FP_POWERPLANT, TWIN_HUB_Y, twinDieselPowerplant } from '../propulsion/testbed';

const C = C172S_DEFINITION;

/** The C172S definition with members replaced (shallow), under a test-bed name. */
function variant(name: string, over: Partial<AircraftDefinition>): AircraftDefinition {
  return { ...C, name, shortName: name, variant: `${name} (synthetic test-bed on the Cessna 172S airframe)`, ...over };
}

/** Flaps driven by a motor that works on a 14 V bus (the C172S's needs 20 V). */
const flaps14V = (controls: ControlSystemDef): ControlSystemDef['flaps'] => ({ ...controls.flaps, drive: { kind: 'electric', rate: 3 * DEG, minVolts: 10 } });

/** The hubs of a powerplant moved to the aero test-bed's stations (the propeller definitions are kept as objects). */
function atHubs(pp: PowerplantDef, hubs: readonly Vec3[]): PowerplantDef {
  return { ...pp, engines: pp.engines.map((install, i) => ({ ...install, hub: { ...hubs[i] } })) };
}

/** The shared geometry facts of the powerplant's propellers (AircraftGeometry.propellers). */
function propellersOf(pp: PowerplantDef): AircraftDefinition['geometry']['propellers'] {
  return pp.engines.map((e) => ({ hub: { ...e.hub }, diameter: e.propeller.diameter, blades: e.propeller.blades, rotation: e.rotation }));
}

/** The C172S gear with one propeller disc per engine of `pp`. */
function gearFor(pp: PowerplantDef, base: GearConfig = C172_GEAR): GearConfig {
  const twin = pp.engines.length > 1;
  return {
    ...base,
    propellers: pp.engines.map((e, i) => {
      const side = i === 0 ? 'left' : 'right';
      const disc = { hub: { ...e.hub }, radius: e.propeller.diameter / 2, message: 'Propeller strike' };
      return twin ? { ...disc, message: `${side === 'left' ? 'Left' : 'Right'} propeller strike`, part: `${side} propeller` } : disc;
    }),
  };
}

/** Each aero propeller station given the radius of its powerplant propeller. */
function stationsFor(aero: AircraftAeroDefinition, pp: PowerplantDef): AircraftAeroDefinition {
  aero.propellers = aero.propellers.map((s, i) => ({ ...s, hub: { ...pp.engines[i].hub }, radius: pp.engines[i].propeller.diameter / 2 }));
  return aero;
}

// ---------------------------------------------------------------------------------------------- twins

export type TwinKind = 'crCS' | 'coFP';

/** Hubs of the twin test-beds, left first: the aero test-bed's stations at y = -/+1.9 m. */
export const TWIN_HUBS: readonly Vec3[] = [-1, 1].map((side) => {
  const right = twinHub(TWIN_HUB_Y);
  return { x: right.x, y: side * TWIN_HUB_Y, z: right.z };
});

/**
 * Per-nacelle cooling drag that the cowl flaps scale (closed: 40 % of it), in place of the nose's cooling item: an
 * engine with cowl flaps then has the drag of open flaps in the climb and less in the cruise.
 */
function nacelleCooling(aero: AircraftAeroDefinition, pp: PowerplantDef): void {
  const cooling = aero.dragItems.find((d) => d.name === 'cooling');
  aero.dragItems = aero.dragItems.filter((d) => d.name !== 'cooling');
  if (!cooling) return;
  pp.engines.forEach((e, i) => {
    const item: DragItem = { name: `cooling ${i}`, position: { x: e.hub.x - 0.6, y: e.hub.y, z: e.hub.z + 0.3 }, area: { ...cooling.area } };
    if (e.engine.thermal.cowlFlapClosedFactor !== 1) {
      item.scale = { kind: 'cowlFlap', engine: i };
      item.retractedFraction = 0.4;
    }
    aero.dragItems.push(item);
  });
}

/**
 * The C172S tail with its elevator trim tab on BOTH elevators (the C172S's is on the right one only, which rolls
 * and yaws the aircraft a little with the trim: an asymmetry of that airframe, not of the framework).
 */
function symmetricTabTail(aero: AircraftAeroDefinition): void {
  const tailplane = c172TailplanePlanform();
  tailplane.controls = tailplane.controls.map(({ mirrorSource: _, ...c }) => c);
  aero.tail = [...buildStrips(tailplane), ...buildFin(c172FinPlanform())];
}

/**
 * Rudder travel of the twins, either way, rad. The C172S's 16 deg rudder cannot hold one 200 hp engine 1.9 m out
 * below about 95 kt; a twin's rudder travels further (PA-34 class).
 */
export const TWIN_RUDDER_TRAVEL = 25 * DEG;

/** Controls of every twin test-bed: no rudder tab offset, no aileron rigging, cockpit rudder trim; flaps for its bus. */
function twinControls(pp: PowerplantDef, steering: ControlSystemDef['steering']): ControlSystemDef {
  return {
    ...C.controls,
    aileron: { ...C.controls.aileron, rigging: 0 },
    // Rudder trim: 6 deg of rudder at full trim, a tab of 10 deg (12 to the left), at a quarter of the travel a second.
    rudder: {
      ...C.controls.rudder,
      maxDeflection: TWIN_RUDDER_TRAVEL,
      tabOffset: 0,
      trim: { authority: 6 * DEG, tabDeflection: 10 * DEG, tabDeflectionLeft: 12 * DEG, rate: 0.25 },
    },
    flaps: pp.electrical.nominalVolts === 14 ? flaps14V(C.controls) : C.controls.flaps,
    steering,
  };
}

/** `input` with the keyboard rudder at full authority up to `speed`, m/s. */
function withRudderAuthority(input: AircraftDefinition['input'], speed: number): AircraftDefinition['input'] {
  const axes = input.assists.axes;
  return { ...input, assists: { ...input.assists, axes: { ...axes, rudder: { ...axes.rudder, fullAuthoritySpeed: speed } } } };
}

/**
 * A twin test-bed on `pp` (hubs moved to the twin stations). `vmca` / `vyse`, KIAS: the sea-level, aft-CG Vmca the
 * conformance twin block measures for the bed (a C172S fin against 180-200 hp 1.9 m out: far above a real light
 * twin's), and a Vyse clear of it; the keyboard rudder has full authority up to that Vmca (contract 3.6 "Twins").
 */
function twin(
  name: string,
  source: PowerplantDef,
  o: { input: AircraftDefinition['input']; steering?: ControlSystemDef['steering']; vmca: number; vyse: number },
): AircraftDefinition {
  const pp = atHubs(source, TWIN_HUBS);
  return variant(name, {
    engineCount: 2,
    controlDefaults: { fuelSelector: 'on' },
    geometry: {
      ...C.geometry,
      vTail: { ...C.geometry.vTail, rudder: { ...C.geometry.vTail.rudder, maxDeflection: TWIN_RUDDER_TRAVEL } },
      propellers: propellersOf(pp),
    },
    controls: twinControls(pp, o.steering ?? C.controls.steering),
    reference: { ...C.reference, vmca: o.vmca, vyse: o.vyse },
    powerplant: pp,
    aero: () => {
      const aero = stationsFor(twinAeroDefinition(), pp);
      nacelleCooling(aero, pp);
      symmetricTabTail(aero);
      return aero;
    },
    gear: () => gearFor(pp),
    input: withRudderAuthority(o.input, o.vmca * KT),
  });
}

/**
 * The twin test-bed: 'crCS' two IO-360 units with counter-rotating constant-speed feathering propellers (the
 * PA-34 pattern), direct nosewheel steering; 'coFP' two C172S units, co-rotating fixed pitch.
 */
export function TWIN_TESTBED(kind: TwinKind): AircraftDefinition {
  if (kind === 'crCS') {
    return twin('Twin test-bed, counter-rotating constant speed', TWIN_CS_POWERPLANT, {
      input: TWIN_INPUT,
      steering: { kind: 'direct', restraintQ: 1500, refLoad: 2000 },
      vmca: 101,
      vyse: 120,
    });
  }
  return twin('Twin test-bed, co-rotating fixed pitch', TWIN_FP_POWERPLANT, {
    input: { ...TWIN_INPUT, has: { ...TWIN_INPUT.has, propeller: false, feather: false, alternateAir: false, cowlFlaps: false } },
    vmca: 99,
    vyse: 120,
  });
}

/** Two FADEC diesels, co-rotating, three-blade constant-speed propellers unfeathered by an accumulator (the DA42 pattern). */
export const DIESEL_TESTBED: AircraftDefinition = twin('Diesel twin test-bed', twinDieselPowerplant(), { input: FADEC_TWIN_INPUT, vmca: 101, vyse: 120 });

// ---------------------------------------------------------------------------------------------- tails and trims

/** Geared anti-servo tab of the stabilator test-bed: tab angle = 1.5 x stabilator + trim offset. */
export const STABILATOR_GEARING = 1.5;

/**
 * All-moving tailplane (14 deg leading edge down, 6 up) with an anti-servo tab geared 1.5 : 1 that is also the trim
 * tab (offset 12 deg nose-up, 8 deg nose-down); the surface floats at -offset / gearing and only a little with
 * the tail's angle of attack (pivot near its aerodynamic centre).
 */
export const STABILATOR_TESTBED: AircraftDefinition = variant('Stabilator test-bed', {
  geometry: {
    ...C.geometry,
    hTail: { ...C.geometry.hTail, allMoving: true, elevator: { chordFraction: 1, maxUp: 14 * DEG, maxDown: 6 * DEG } },
  },
  controls: {
    ...C.controls,
    elevator: { ...C.controls.elevator, maxUp: 14 * DEG, maxDown: 6 * DEG, alphaFloat: 0.15 },
    pitchTrim: { kind: 'antiServoTab', tabDown: 12 * DEG, tabUp: 8 * DEG, floatRatio: 1 / STABILATOR_GEARING, gearing: STABILATOR_GEARING },
  },
  aero: () => stabilatorAeroDefinition({ tabGearing: STABILATOR_GEARING }),
});

/**
 * Spring trim (no tab): full nose-up trim holds the elevator 15 deg trailing edge up, full nose-down 8 deg down, the
 * spring's moment equal to the air's at 1500 Pa; flaps on a hand lever (the PA-38 pattern).
 */
export const SPRING_TRIM_TESTBED: AircraftDefinition = variant('Spring-trim test-bed', {
  controls: {
    ...C.controls,
    pitchTrim: { kind: 'spring', springUp: -15 * DEG, springDown: 8 * DEG, springQ: 1500 },
    flaps: { ...C.controls.flaps, drive: { kind: 'manual', rate: 0.6 } },
  },
});

/** The tailplane on the fin's tip (tests/aero/testbed.ts tTailAeroDefinition). */
export const TTAIL_TESTBED: AircraftDefinition = variant('T-tail test-bed', {
  geometry: { ...C.geometry, hTail: { ...C.geometry.hTail, mount: 'tTail', quarterChord: { x: C.geometry.hTail.quarterChord.x, z: c172FinPlanform().tip.z } } },
  aero: () => tTailAeroDefinition(),
});

// ---------------------------------------------------------------------------------------------- gear

/** Free-castering nosewheel (DA20 swivel): pedals do not steer, differential braking does (the DA20 pattern). */
export const CASTER_TESTBED: AircraftDefinition = variant('Castering-nosewheel test-bed', {
  controls: { ...C.controls, steering: { kind: 'castering' } },
  gear: () => casterGear(),
  input: CASTER_INPUT,
  sim: { ...C.sim, autoflight: { ...C.sim.autoflight, steering: { kind: 'differentialBrake', rudderEffectiveKias: 30, brakeGain: 1 } } },
});

/** Gear extended (KCAS) and operating limits of the retractable test-bed. */
export const RETRACT_VLE = 120;
export const RETRACT_VLO_RETRACT = 100;

/**
 * Electro-hydraulic retractable gear (PA-34 system, tests/gear/testbed.ts) with the gear's drag items scaled by
 * their legs (5 % left when stowed), and the flap and gear overspeed rules set to 'warn'.
 */
export const RETRACT_TESTBED: AircraftDefinition = variant('Retractable-gear test-bed', {
  geometry: { ...C.geometry, gear: { ...C.geometry.gear, retractable: true } },
  limits: {
    ...C.limits,
    vleCas: RETRACT_VLE * KT,
    vloExtendCas: RETRACT_VLE * KT,
    vloRetractCas: RETRACT_VLO_RETRACT * KT,
    flapOverspeed: { consequence: 'warn', margin: 0.03, time: 1 },
    gearOverspeed: { consequence: 'warn', margin: 0.03, time: 1 },
  },
  reference: { ...C.reference, vle: RETRACT_VLE, vloExtend: RETRACT_VLE, vloRetract: RETRACT_VLO_RETRACT },
  aero: () => {
    const aero = baseDefinition();
    const legs: Record<string, 0 | 1 | 2> = { 'nose gear': 0, 'left main gear': 1, 'right main gear': 2 };
    for (const item of aero.dragItems) {
      const leg = legs[item.name];
      if (leg === undefined) continue;
      item.scale = { kind: 'gear', leg };
      item.retractedFraction = 0.05;
    }
    return aero;
  },
  gear: () => retractGear(),
  input: { ...C.input, has: { ...C.input.has, gear: true } },
});

// ---------------------------------------------------------------------------------------------- carburettor

const CARB_PP: PowerplantDef = atHubs(CARB_POWERPLANT, [C172.prop.hub]);

/** An O-235-like carburetted engine with carburettor heat and icing, gravity-fed, fixed pitch, 14 V (the C152 pattern). */
export const CARB_TESTBED: AircraftDefinition = variant('Carburettor test-bed', {
  geometry: { ...C.geometry, propellers: propellersOf(CARB_PP) },
  controls: { ...C.controls, flaps: flaps14V(C.controls) },
  powerplant: CARB_PP,
  aero: () => stationsFor(baseDefinition(), CARB_PP),
  gear: () => gearFor(CARB_PP),
  input: CARB_INPUT,
});

/** Every test-bed by name (the twins once each). */
export const TESTBEDS: Readonly<Record<string, AircraftDefinition>> = {
  TWIN_crCS: TWIN_TESTBED('crCS'),
  TWIN_coFP: TWIN_TESTBED('coFP'),
  DIESEL: DIESEL_TESTBED,
  STABILATOR: STABILATOR_TESTBED,
  SPRING_TRIM: SPRING_TRIM_TESTBED,
  TTAIL: TTAIL_TESTBED,
  CASTER: CASTER_TESTBED,
  RETRACT: RETRACT_TESTBED,
  CARB: CARB_TESTBED,
};
