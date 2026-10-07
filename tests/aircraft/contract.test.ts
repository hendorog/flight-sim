// The aircraft contract (src/core/types.ts, src/physics/interfaces.ts, src/aircraft/types.ts and the area
// definition modules): the helpers every module copies controls with, the identity rules of the state
// factories, the moisture model, and the Cessna 172S files that are plain data.
//
// The numeric behaviour of the Cessna 172S is pinned by tests/golden; these tests pin the RULES the other
// modules rely on (what is shared and what is copied, what a partial patch keeps, which object is which).
//
// The second half is the assembly: the C172S definition and presentation, the registry with its catalogue and
// loaders, the placeholders of the five types that have no files of their own yet, and the URL parameter.
// Its catalogue checks are INVARIANTS (they hold for a placeholder and for a finished type alike), so nothing
// here changes when a type lands.

import { describe, expect, it, vi } from 'vitest';
import { C172S_AUDIO } from '../../src/aircraft/c172s/audio';
import { C172S_GEOMETRY } from '../../src/aircraft/c172s/geometry';
import C172S_DEFINITION_DEFAULT, { C172S_DEFINITION } from '../../src/aircraft/c172s/index';
import { C172S_INPUT } from '../../src/aircraft/c172s/input';
import { C172S_ASI_MARKS, C172S_INSTRUMENT_SYSTEMS, C172S_PANEL, C172S_TACH_MARKS } from '../../src/aircraft/c172s/panel';
import { C172_POWERPLANT } from '../../src/aircraft/c172s/powerplant';
import C172S_PRESENTATION_DEFAULT, { C172S_PRESENTATION } from '../../src/aircraft/c172s/presentation';
import { C172S_REFERENCE } from '../../src/aircraft/c172s/reference';
import { C172S_SIM } from '../../src/aircraft/c172s/sim';
import { C172S_AIR_DATA, C172S_AUTOPILOT, C172S_CONTROLS, C172S_LIMITS, C172S_MASS } from '../../src/aircraft/c172s/systems';
import { C172S as C172S_TRAINING } from '../../src/aircraft/c172s/training';
import { C172S_UI } from '../../src/aircraft/c172s/ui';
import { C172S_VISUAL } from '../../src/aircraft/c172s/visual';
import { placeholderDefinition, placeholderPresentation } from '../../src/aircraft/placeholder';
import type {
  AircraftDefinition,
  AircraftGeometry,
  AircraftPresentation,
  AudioProfile,
  AutoflightProfile,
  ControlSystemDef,
  FadecDef,
  InputProfile,
  LimitsDef,
  PanelEngineDisplayRow,
  RetractConfig,
  SimProfile,
  TailVisualDef,
  UiProfile,
} from '../../src/aircraft/types';
import {
  AIRCRAFT_CATALOGUE,
  AIRCRAFT_IDS as REGISTRY_IDS,
  AIRCRAFT_PREF_KEY,
  aircraftSummary,
  loadAircraft,
  loadAirframeVisual,
  loadPresentation,
  loadedAircraft,
} from '../../src/aircraft/registry';
import { loadAirframeVisual as loadAirframeVisualDirect } from '../../src/aircraft/visualLoader';
import { C172 } from '../../src/core/c172';
import { createEventBus, type SimContext } from '../../src/core/context';
import { DEG } from '../../src/core/math';
import { CG_HEIGHT_ON_GROUND, makeMockState } from '../../src/core/mockState';
import {
  AIRCRAFT_IDS,
  DEFAULT_AIRCRAFT_ID,
  PROP_FEATHER_GATE,
  applyControls,
  clearEngineControl,
  cloneControls,
  copyControls,
  defaultControls,
  defaultWeather,
  emptyEngineState,
  emptyPropellerState,
  emptySurfaceState,
  engineControl,
  fixedGearState,
  isAircraftId,
  mergeControlPatches,
  setEngineControl,
  type AircraftState,
  type ControlInputs,
  type ControlPatch,
  type SurfaceState,
  type WeatherSettings,
} from '../../src/core/types';
import { AIRPORT } from '../../src/core/world';
import { InputSystem } from '../../src/input/InputSystem';
import { PANEL_HEIGHT, PANEL_LAYOUT, PANEL_WIDTH } from '../../src/instruments/layout';
import type { InstrumentReadings } from '../../src/instruments/dynamics/instrumentSet';
import { gaugeRecess, type GaugeDef } from '../../src/instruments/panelDef';
import { C172FlightModel, createEnvironment } from '../../src/physics';
import { viternaCd90 } from '../../src/physics/aero/definition';
import { createC172AeroDefinition } from '../../src/physics/aero';
import { C172_GEAR, LandingGear } from '../../src/physics/gear';
import type { GearConfig } from '../../src/physics/gear/gearConfig';
import { AVGAS_100LL, JET_A1 } from '../../src/physics/propulsion/defs';
import { FUEL_DENSITY, ROTOR_INERTIA } from '../../src/physics/propulsion';
import type { EngineSnapshot } from '../../src/physics/interfaces';
import type { TrimSpec } from '../../src/physics/trim';
import { PANEL } from '../../src/render/aircraft/cockpit';
import { parseParams } from '../../src/sim/params';
import { buildStart } from '../../src/sim/starts';
import { getAircraftType } from '../../src/training/aircraft/registry';
import { makeRig } from '../input/keyboardPilot';
import { makeInput, run, runningSystem } from '../propulsion/helpers';

/** What identifies a gear configuration without comparing its spring objects and closures. */
const gearFacts = (g: GearConfig) => ({
  wheels: g.wheels.map((w) => ({ name: w.name, position: w.position, axis: w.axis, radius: w.tyre.radius, brake: w.brake, limitLoad: w.limitLoad })),
  structure: g.structure.map((p) => ({ position: p.position, message: p.message, tolerance: p.tolerance })),
  retract: g.retract,
});

/** The keys of T that an object may not leave out. */
type RequiredKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? never : K }[keyof T];
/** Compiles only if every key named is a REQUIRED member of T (npx tsc --noEmit is the check; it returns the names). */
const required = <T>() => <K extends RequiredKeys<T>>(...keys: K[]): K[] => keys;

/** The controls of the single-type simulator, written out: defaultControls() must keep returning them. */
const LEGACY_DEFAULTS = {
  elevator: 0,
  aileron: 0,
  rudder: 0,
  throttle: 0,
  mixture: 1,
  flaps: 0,
  elevatorTrim: 0,
  brakeLeft: 0,
  brakeRight: 0,
  parkingBrake: false,
  magnetos: 3,
  starter: false,
  fuelPump: false,
  fuelSelector: 'both',
  masterBattery: true,
  alternator: true,
  avionics: true,
  pitotHeat: false,
  lights: { nav: true, beacon: true, strobe: true, landing: false, taxi: false, panel: 0.6, dome: false },
  kollsmanHpa: 1013.25,
  headingBugDeg: 70,
  obsDeg: 70,
  dgAlign: false,
};

function flatEnvironment(weather: WeatherSettings) {
  return createEnvironment({
    weather,
    terrain: { height: () => AIRPORT.elevation, normal: () => ({ x: 0, y: 0, z: -1 }), surface: () => 'runway' },
  });
}

describe('aircraft ids', () => {
  it('lists the six types, the C172S first and the default', () => {
    expect(AIRCRAFT_IDS).toEqual(['c172s', 'c152', 'pa38', 'da20', 'pa34', 'da42']);
    expect(DEFAULT_AIRCRAFT_ID).toBe('c172s');
    expect(isAircraftId('pa34')).toBe(true);
    expect(isAircraftId('c172')).toBe(false);
    expect(isAircraftId(undefined)).toBe(false);
  });
});

describe('defaultControls', () => {
  it('keeps every legacy key at its value, in the same order', () => {
    const c = defaultControls() as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(LEGACY_DEFAULTS)) expect(c[k], k).toEqual(v);
    expect(Object.keys(c).slice(0, Object.keys(LEGACY_DEFAULTS).length)).toEqual(Object.keys(LEGACY_DEFAULTS));
    expect(Object.keys(c.lights as object)).toEqual(Object.keys(LEGACY_DEFAULTS.lights));
  });

  it('adds the per-type levers at positions that mean "not there" and one engine entry', () => {
    const c = defaultControls();
    expect(c.propeller).toBe(1);
    expect(c.carbHeat).toBe(0);
    expect(c.cowlFlaps).toBe(1);
    expect(c.alternateAir).toBe(false);
    expect(c.engineMaster).toBe(true);
    expect(c.gearLever).toBe('down');
    expect(c.gearEmergency).toBe(false);
    expect(c.rudderTrim).toBe(0);
    expect(c.engines).toEqual([{}]);
    expect(PROP_FEATHER_GATE).toBe(0.08);
  });

  it('returns fresh objects every time', () => {
    const a = defaultControls(), b = defaultControls();
    expect(a).not.toBe(b);
    expect(a.lights).not.toBe(b.lights);
    expect(a.engines).not.toBe(b.engines);
  });

  it('takes the engine count and the overrides of a definition', () => {
    const overrides = { fuelSelector: 'on', cowlFlaps: 0.5, lights: { ...defaultControls().lights, strobe: false } } as const;
    const c = defaultControls({ engineCount: 2, controlDefaults: overrides });
    expect(c.engines).toEqual([{}, {}]);
    expect(c.engines[0]).not.toBe(c.engines[1]);
    expect(c.fuelSelector).toBe('on');
    expect(c.cowlFlaps).toBe(0.5);
    expect(c.lights.strobe).toBe(false);
    expect(c.lights).not.toBe(overrides.lights);
    expect(c.throttle).toBe(0);
    expect(defaultControls({ engineCount: 1, controlDefaults: {} })).toEqual(defaultControls());
  });
});

describe('copying controls', () => {
  const twin = (): ControlInputs => {
    const c = defaultControls({ engineCount: 2, controlDefaults: {} });
    c.throttle = 0.7;
    c.lights.landing = true;
    setEngineControl(c, 1, 'throttle', 0.2);
    return c;
  };

  it('copyControls copies every control and shares neither lights nor engines', () => {
    const src = twin();
    const dst = defaultControls();
    expect(copyControls(dst, src)).toBe(dst);
    expect(dst).toEqual(src);
    expect(dst.lights).not.toBe(src.lights);
    expect(dst.engines).not.toBe(src.engines);
    expect(dst.engines[1]).not.toBe(src.engines[1]);
    src.lights.landing = false;
    setEngineControl(src, 1, 'throttle', 0.9);
    expect(dst.lights.landing).toBe(true);
    expect(dst.engines[1].throttle).toBe(0.2);
  });

  it('cloneControls makes an independent copy', () => {
    const src = twin();
    const copy = cloneControls(src);
    expect(copy).toEqual(src);
    expect(copy).not.toBe(src);
    expect(copy.lights).not.toBe(src.lights);
    expect(copy.engines).not.toBe(src.engines);
    expect(copy.engines[0]).not.toBe(src.engines[0]);
  });

  it('applyControls assigns scalars and leaves the rest alone', () => {
    const c = twin();
    const lights = c.lights, engines = c.engines;
    expect(applyControls(c, { flaps: 1 / 3, magnetos: 1, fuelSelector: 'left' })).toBe(c);
    expect(c.flaps).toBe(1 / 3);
    expect(c.magnetos).toBe(1);
    expect(c.fuelSelector).toBe('left');
    expect(c.throttle).toBe(0.7);
    expect(c.lights).toBe(lights);
    expect(c.engines).toBe(engines);
  });

  it('applyControls merges a PARTIAL lights patch into a fresh object: the other lamps and the panel stay', () => {
    const c = defaultControls();
    const before = c.lights;
    const patch: ControlPatch = { lights: { landing: true } };
    applyControls(c, patch);
    expect(c.lights).toEqual({ nav: true, beacon: true, strobe: true, landing: true, taxi: false, panel: 0.6, dome: false });
    expect(c.lights).not.toBe(before);
    expect(c.lights).not.toBe(patch.lights);
    expect(patch.lights).toEqual({ landing: true });
  });

  it('a partial lights patch leaves the bus at 28 V (an undefined lamp load would collapse it)', () => {
    const sys = runningSystem(2000);
    const input = makeInput({ controls: { throttle: 0.4 } });
    applyControls(input.controls, { lights: { landing: true } });
    let out = sys.step(input);
    for (let i = 0; i < 240; i++) out = sys.step(input);
    expect(Number.isFinite(out.electrical.busVoltage)).toBe(true);
    expect(out.electrical.busVoltage).toBeGreaterThan(27);
    expect(out.electrical.busVoltage).toBeLessThan(29);
    expect(input.controls.lights.panel).toBe(0.6);
    expect(input.controls.lights.nav).toBe(true);
  });

  it('applyControls replaces engines with a deep copy padded or truncated to the engine count', () => {
    const c = twin();
    const patch: ControlPatch = { engines: [{ mixture: 0 }] };
    applyControls(c, patch);
    expect(c.engines).toEqual([{ mixture: 0 }, {}]);
    expect(c.engines[0]).not.toBe(patch.engines![0]);
    const single = defaultControls();
    applyControls(single, { engines: [{ throttle: 0.1 }, { throttle: 0.9 }] });
    expect(single.engines).toEqual([{ throttle: 0.1 }]);
  });

  it('mergeControlPatches: the second wins, lights merge, engines are copied, nothing is shared', () => {
    const a: ControlPatch = { masterBattery: true, fuelPump: false, lights: { nav: true, taxi: true }, engines: [{ throttle: 0.3 }] };
    const b: ControlPatch = { fuelPump: true, flaps: 1, lights: { taxi: false, landing: true } };
    const m = mergeControlPatches(a, b);
    expect(m).toEqual({ masterBattery: true, fuelPump: true, flaps: 1, lights: { nav: true, taxi: false, landing: true }, engines: [{ throttle: 0.3 }] });
    expect(m.lights).not.toBe(a.lights);
    expect(m.lights).not.toBe(b.lights);
    expect(m.engines).not.toBe(a.engines);
    expect(m.engines![0]).not.toBe(a.engines![0]);
    expect(mergeControlPatches(a, { engines: [{ mixture: 0 }] }).engines).toEqual([{ mixture: 0 }]);
    expect(mergeControlPatches(undefined, b)).toEqual(b);
    expect(mergeControlPatches(a, undefined)).toEqual(a);
    expect(mergeControlPatches(undefined, undefined)).toEqual({});
    expect('lights' in mergeControlPatches({ flaps: 0 }, { flaps: 1 })).toBe(false);
  });
});

describe('per-engine controls', () => {
  it('engineControl falls back to the scalar; an override takes over; clearing rejoins', () => {
    const c = defaultControls({ engineCount: 2, controlDefaults: {} });
    c.throttle = 0.6;
    c.magnetos = 3;
    expect(engineControl(c, 0, 'throttle')).toBe(0.6);
    expect(engineControl(c, 1, 'throttle')).toBe(0.6);
    setEngineControl(c, 1, 'throttle', 0);
    setEngineControl(c, 1, 'magnetos', 0);
    setEngineControl(c, 1, 'fuelSelector', 'crossfeed');
    expect(engineControl(c, 1, 'throttle')).toBe(0);
    expect(engineControl(c, 1, 'magnetos')).toBe(0);
    expect(engineControl(c, 1, 'fuelSelector')).toBe('crossfeed');
    expect(engineControl(c, 0, 'throttle')).toBe(0.6);
    c.throttle = 0.9;
    expect(engineControl(c, 0, 'throttle')).toBe(0.9);
    expect(engineControl(c, 1, 'throttle')).toBe(0);
    clearEngineControl(c, 'throttle', 1);
    expect(engineControl(c, 1, 'throttle')).toBe(0.9);
    expect(engineControl(c, 1, 'magnetos')).toBe(0);
    setEngineControl(c, 0, 'magnetos', 1);
    clearEngineControl(c, 'magnetos');
    expect(c.engines).toEqual([{}, { fuelSelector: 'crossfeed' }]);
  });

  it('an engine that does not exist reads the scalar and cannot be written', () => {
    const c = defaultControls();
    c.mixture = 0.8;
    expect(engineControl(c, 1, 'mixture')).toBe(0.8);
    setEngineControl(c, 1, 'mixture', 0);
    clearEngineControl(c, 'mixture', 1);
    expect(c.engines).toEqual([{}]);
    expect(engineControl(c, 1, 'mixture')).toBe(0.8);
  });
});

describe('state factories', () => {
  const expectIdentity = (s: AircraftState): void => {
    expect(s.engines[0]).toBe(s.engine);
    expect(s.propellers[0]).toBe(s.propeller);
  };

  it('the empty states are today\'s cold values plus the new members', () => {
    expect(emptyEngineState()).toEqual({
      running: false, rpm: 0, manifoldPressure: 29.92, power: 0, torque: 0, fuelFlow: 0, egt: 15, cht: 15, oilTemp: 15,
      oilPressure: 0, fuelPressure: 0, propRpm: 0, loadPercent: 0, carbIce: 0, cowlFlap: 1,
    });
    expect(emptyPropellerState()).toEqual({ rpm: 0, thrust: 0, advanceRatio: 0, rotation: 0, bladePitch: 0, feathered: false, direction: 1 });
    expect(emptyPropellerState(-1).direction).toBe(-1);
    expect(emptySurfaceState()).toEqual({ elevator: 0, aileronLeft: 0, aileronRight: 0, rudder: 0, flaps: 0, elevatorTrim: 0, rudderTrim: 0 });
    expect(fixedGearState()).toEqual({ retractable: false, lever: 'down', extension: [1, 1, 1], locked: [true, true, true], inTransit: false, warning: false });
    expect(emptyEngineState()).not.toBe(emptyEngineState());
  });

  it('the flight model publishes engines[0] === engine, the tanks and the alternator list in step', () => {
    const fm = new C172FlightModel();
    const s = fm.state;
    expectIdentity(s);
    expect(s.aircraft).toBe('c172s');
    expect(s.gear).toEqual(fixedGearState());
    expect(s.fuel.tanks.map((t) => t.id)).toEqual(['left', 'right']);
    expect(s.surfaces.rudderTrim).toBe(0);

    const env = flatEnvironment({ ...defaultWeather(), windSpeedKt: 0, turbulence: 0 });
    fm.reset({ position: { x: 0, y: 0, z: 0 }, heading: 0, airspeed: 0, onGround: true, engineRunning: true, fuelFraction: 0.5 }, env);
    const controls = cloneControls(fm.trimControls);
    for (let i = 0; i < 60; i++) fm.step(1 / 60, controls, env);
    expectIdentity(s);
    expect(s.engine.running).toBe(true);
    expect(s.engines).toHaveLength(1);
    expect(s.propellers).toHaveLength(1);
    expect(s.engine.propRpm).toBe(s.engine.rpm);
    expect(s.engine.loadPercent).toBe((100 * s.engine.power) / C172.engine.ratedPower);
    expect(s.engine.carbIce).toBe(0);
    expect(s.engine.cowlFlap).toBe(1);
    expect(s.propeller.direction).toBe(1);
    expect(s.propeller.feathered).toBe(false);
    // The 60 in pitch helix at three quarters of the radius.
    expect(s.propeller.bladePitch / DEG).toBeCloseTo(18.53, 2);
    expect(s.fuel.left).toBeGreaterThan(0);
    expect(s.fuel.left).toBeLessThan(s.fuel.capacityEach);
    expect(s.fuel.tanks).toEqual([
      { id: 'left', quantity: s.fuel.left, capacity: s.fuel.capacityEach },
      { id: 'right', quantity: s.fuel.right, capacity: s.fuel.capacityEach },
    ]);
    expect(s.electrical.alternatorAmps).toBeGreaterThan(0);
    expect(s.electrical.alternators).toEqual([s.electrical.alternatorAmps]);
    expect(s.gear).toEqual(fixedGearState());
    // The live controls are a copy: the model's trimmed set does not share lights or engines with it.
    expect(controls.lights).not.toBe(fm.trimControls.lights);
    expect(controls.engines).not.toBe(fm.trimControls.engines);
  });

  it('the powerplant lists hold the same objects as the singular outputs', () => {
    const sys = runningSystem(2000);
    const out = run(sys, { ktas: 60, controls: { throttle: 0.5 } }, 1);
    expect(out.engines).toEqual([out.engine]);
    expect(out.engines[0]).toBe(out.engine);
    expect(out.propellers[0]).toBe(out.propeller);
    expect(out.slipstreams[0]).toBe(out.slipstream);
    expect(out.tanks).toEqual([sys.fuelLeft, sys.fuelRight]);
    expect(out.tanks[0]).toBeLessThan(72);
    expect(out.electrical.alternators).toEqual([out.electrical.alternatorAmps]);
    expect(out.engine.propRpm).toBe(out.engine.rpm);
    // settle() restores the tanks: the list must show the restored contents.
    const settled = sys.settle(makeInput({ ktas: 60, controls: { throttle: 0.5 } }));
    expect(settled.tanks).toEqual([sys.fuelLeft, sys.fuelRight]);
  });

  it('a mock state is one aircraft whichever fields it is set through', () => {
    const s = makeMockState();
    expectIdentity(s);
    expect(s.aircraft).toBe('c172s');
    s.engine.rpm = 1234;
    s.propeller.rotation = 2;
    expect(s.engines[0].rpm).toBe(1234);
    expect(s.propellers[0].rotation).toBe(2);
    s.fuel.left = 12.5;
    s.fuel.right = 31;
    expect(s.fuel.tanks[0].quantity).toBe(12.5);
    expect(s.fuel.tanks[1].quantity).toBe(31);
    expect(s.fuel.tanks.map((t) => t.capacity)).toEqual([s.fuel.capacityEach, s.fuel.capacityEach]);
    s.fuel.tanks[0].quantity = 40;
    expect(s.fuel.left).toBe(40);
    s.electrical.alternatorAmps = 33;
    expect(s.electrical.alternators).toHaveLength(1);
    expect(s.electrical.alternators[0]).toBe(33);
    // A copy is plain data with the same values.
    const copy = JSON.parse(JSON.stringify(s)) as AircraftState;
    expect(copy.fuel.tanks).toEqual([{ id: 'left', quantity: 40, capacity: 72 }, { id: 'right', quantity: 31, capacity: 72 }]);
    expect(copy.electrical.alternators).toEqual([33]);
    expect(copy.engines[0]).toEqual(copy.engine);
  });

  it('a mock state can carry a second engine', () => {
    const s = makeMockState({ engines: 2 });
    expectIdentity(s);
    expect(s.engines).toHaveLength(2);
    expect(s.propellers).toHaveLength(2);
    expect(s.engines[1]).not.toBe(s.engines[0]);
    expect(s.engines[1]).toEqual(s.engines[0]);
    expect(makeMockState().engines).toHaveLength(1);
  });
});

describe('moisture', () => {
  const weather = defaultWeather();
  const env = flatEnvironment(weather);

  it('is saturated inside the cloud layer', () => {
    Object.assign(weather, { cloudCover: 0.5, cloudBaseM: 1500, cloudTopM: 2600 });
    const m = env.moisture(2000);
    expect(m.inCloud).toBe(true);
    expect(m.dewPointSpread).toBe(0);
    expect(env.moisture(1499).inCloud).toBe(false);
    expect(env.moisture(2601).inCloud).toBe(false);
  });

  it('gives the spread the cloud base implies at the field, closing with height', () => {
    Object.assign(weather, { cloudCover: 0.5, cloudBaseM: 1500, cloudTopM: 2600 });
    expect(env.moisture(AIRPORT.elevation).dewPointSpread).toBeCloseTo((1500 - AIRPORT.elevation) / 125, 12);
    expect(env.moisture(AIRPORT.elevation + 1000).dewPointSpread).toBeCloseTo((1500 - AIRPORT.elevation) / 125 - 4.7, 12);
    // Thin cover: between base and top is not "in cloud", and the spread never goes negative.
    weather.cloudCover = 0.2;
    const m = env.moisture(2000);
    expect(m.inCloud).toBe(false);
    expect(m.dewPointSpread).toBeGreaterThanOrEqual(0);
    expect(env.moisture(5000).dewPointSpread).toBe(0);
  });

  it('is dry (at least 12 K of spread) under a clear sky, at any height', () => {
    Object.assign(weather, { cloudCover: 0, cloudBaseM: 400, cloudTopM: 2600 });
    for (const h of [AIRPORT.elevation, 500, 2000, 4000]) {
      const m = env.moisture(h);
      expect(m.inCloud).toBe(false);
      expect(m.dewPointSpread).toBeGreaterThanOrEqual(12);
    }
    weather.cloudBaseM = 3000;
    expect(env.moisture(AIRPORT.elevation).dewPointSpread).toBeCloseTo((3000 - AIRPORT.elevation) / 125, 12);
  });
});

describe('area definition modules', () => {
  // The single-propeller members of Stage A (propellerHub / propellerRadius, GearConfig.propeller) were removed
  // by the steward at the Stage B freeze; `propellers` is required in both modules.
  it('the aerodynamic definition carries the propeller AeroModel reads', () => {
    const def = createC172AeroDefinition();
    expect(def.propellers).toHaveLength(1);
    expect(def.propellers[0]).toMatchObject({ hub: C172.prop.hub, radius: C172.prop.diameter / 2 });
    expect('propellerHub' in def || 'propellerRadius' in def).toBe(false);
    expect([def.stallWarning].flat()).toHaveLength(1);
    expect(def.jetStations).toBeUndefined();
    expect(viternaCd90(7.5)).toBe(1.11 + 0.018 * 7.5);
  });

  it('the gear configuration carries its propeller disc', () => {
    const disc = { hub: C172.prop.hub, radius: C172.prop.diameter / 2, message: 'Propeller strike' };
    expect(C172_GEAR.propellers).toHaveLength(1);
    expect(C172_GEAR.propellers[0]).toMatchObject(disc);
    expect('propeller' in C172_GEAR).toBe(false);
    expect(C172_GEAR.retract).toBeUndefined();
    expect(C172_GEAR.wheels.map((w) => w.name)).toEqual(['nose', 'left', 'right']);
  });

  it('the fuels: 100LL by reference to the combustion constants, Jet A-1 as given', () => {
    expect(AVGAS_100LL).toEqual({ name: 'avgas', stoichFar: 1 / 14.8, lhv: 43.5e6, density: 719 });
    expect(AVGAS_100LL.density).toBe(FUEL_DENSITY);
    expect(JET_A1).toEqual({ name: 'jetA1', stoichFar: 0.0686, lhv: 43.1e6, density: 800 });
  });

  it('gaugeRecess gives the recess of every round gauge of the C172S panel and none for the rest', () => {
    const L = PANEL_LAYOUT;
    const apertures = { large: L.apertures.sixPack, small: L.apertures.small };
    const at = (x: number, y: number) => [x, y] as const;
    const scale = { label: '', min: 0, max: 1, majors: [], minorStep: 1, read: () => 0 };
    const large: GaugeDef[] = [
      { kind: 'asi', id: 'asi', at: at(L.sixPack.cols[0], L.sixPack.rows[0]), marks: C172S_ASI_MARKS },
      { kind: 'attitude', id: 'attitude', at: at(L.sixPack.cols[1], L.sixPack.rows[0]) },
      { kind: 'altimeter', id: 'altimeter', at: at(L.sixPack.cols[2], L.sixPack.rows[0]) },
      { kind: 'turn', id: 'turn', at: at(L.sixPack.cols[0], L.sixPack.rows[1]) },
      { kind: 'heading', id: 'heading', at: at(L.sixPack.cols[1], L.sixPack.rows[1]) },
      { kind: 'vsi', id: 'vsi', at: at(L.sixPack.cols[2], L.sixPack.rows[1]) },
      { kind: 'cdi', id: 'cdi1', at: at(L.cdi.x, L.cdi.rows[0]), receiver: 'nav1', fixedCourseDeg: 0 },
      { kind: 'tach', id: 'tach', at: at(L.engineRow.tach, L.engineRow.y), size: 'large', marks: C172S_TACH_MARKS },
    ];
    const small: GaugeDef[] = [
      { kind: 'clock', id: 'clock', at: at(L.leftColumn.x, L.leftColumn.clock) },
      { kind: 'suction', id: 'suction', at: at(L.leftColumn.x, L.leftColumn.suction) },
      { kind: 'ammeter', id: 'ammeter', at: at(L.leftColumn.x, L.leftColumn.ammeter) },
      { kind: 'dual', id: 'fuel', at: at(L.engineRow.fuel, L.engineRow.y), seed: 1, title: ['L', 'R'], left: scale, right: scale },
      { kind: 'tach', id: 'tach2', at: at(10, 20), size: 'small', marks: C172S_TACH_MARKS },
      { kind: 'single', id: 'mp', at: at(30, 40), seed: 1, size: 'small', a0: 0, a1: 1, title: '', units: '', labels: [], scale },
    ];
    for (const g of large) {
      expect(gaugeRecess(g, apertures), g.id).toEqual({ x: (g as { at: readonly number[] }).at[0], y: (g as { at: readonly number[] }).at[1], r: 74, depth: 0.014 });
    }
    for (const g of small) {
      expect(gaugeRecess(g, apertures), g.id).toEqual({ x: (g as { at: readonly number[] }).at[0], y: (g as { at: readonly number[] }).at[1], r: 51, depth: 0.01 });
    }
    expect(gaugeRecess({ kind: 'single', id: 'x', at: at(1, 2), seed: 1, size: 'large', a0: 0, a1: 1, title: '', units: '', labels: [], scale }, apertures)?.r).toBe(74);
    const flat: GaugeDef[] = [
      { kind: 'gps', id: 'gps', bounds: { x: 0, y: 0, w: 10, h: 10 } },
      { kind: 'flapLever', id: 'flaps', bounds: { x: 0, y: 0, w: 10, h: 10 }, maxDeg: 30, legends: [] },
      { kind: 'gearLights', id: 'gear', bounds: { x: 0, y: 0, w: 10, h: 10 } },
      { kind: 'guardedKnob', id: 'knob', at: at(5, 5), label: '', action: 'starter' },
      { kind: 'engineDisplay', id: 'eng', bounds: { x: 0, y: 0, w: 10, h: 10 }, engines: 2, rows: [] },
      { kind: 'flapLights', id: 'flapLights', bounds: { x: 0, y: 0, w: 10, h: 10 }, positions: ['UP', 'APP', 'LDG'], colors: ['green', 'white', 'white'], lever: at(5, 5) },
    ];
    for (const g of flat) expect(gaugeRecess(g, apertures), g.id).toBeNull();
  });
});

// Compile-time guards (npx tsc --noEmit): a member the contract makes required may not become optional, or
// every reader would have to write `?? 0` and a state could legally lack it; and the optional members that
// exist for the twins and the Diamonds stay writable. The expectations only keep the lists honest.
describe('what the frozen types require and accept', () => {
  it('the members every state, control set and definition must carry are required', () => {
    expect(required<SurfaceState>()('elevator', 'aileronLeft', 'aileronRight', 'rudder', 'flaps', 'elevatorTrim', 'rudderTrim')).toHaveLength(7);
    expect(
      required<ControlInputs>()('propeller', 'carbHeat', 'cowlFlaps', 'alternateAir', 'engineMaster', 'gearLever', 'gearEmergency', 'rudderTrim', 'engines'),
    ).toHaveLength(9);
    expect(required<AircraftState>()('aircraft', 'engine', 'propeller', 'engines', 'propellers', 'gear', 'surfaces')).toHaveLength(7);
    expect(required<AircraftState['fuel']>()('left', 'right', 'capacityEach', 'tanks')).toHaveLength(4);
    expect(required<AircraftState['electrical']>()('alternatorAmps', 'alternators')).toHaveLength(2);
    expect(
      required<AircraftDefinition>()(
        'id', 'engineCount', 'controlDefaults', 'geometry', 'mass', 'limits', 'controls', 'airData', 'autopilot', 'reference', 'powerplant', 'aero', 'gear', 'sim', 'input',
      ),
    ).toHaveLength(15);
    expect(required<AircraftPresentation>()('id', 'visual', 'panel', 'instrumentSystems', 'ui', 'audio', 'training')).toHaveLength(7);
    expect(required<AutoflightProfile['centreline']>()('headingGain', 'yawRateGain', 'lookAheadM')).toHaveLength(3);
  });

  it('a swept, stepped, wingletted wing, a swept tailplane and split flaps have a place in the shared geometry', () => {
    const wing: Pick<AircraftGeometry['wing'], 'breaks' | 'winglet'> & { flap: AircraftGeometry['wing']['flap'] } = {
      // Two stations at one y are a step (a nacelle).
      breaks: [{ y: 0, chord: 1.86, qcX: 0.1 }, { y: 1.67, chord: 1.39, qcX: 0 }, { y: 1.67, chord: 1.28, qcX: 0 }, { y: 6.43, chord: 0.91, qcX: -0.05 }],
      flap: { innerY: 0.61, outerY: 4.78, chordFraction: 0.25, maxDeflection: 42 * DEG, segments: [{ innerY: 0.61, outerY: 1.35, chordFraction: 0.25 }, { innerY: 1.87, outerY: 4.78, chordFraction: 0.23 }] },
      winglet: { height: 0.55, cant: 80 * DEG, rootChord: 0.9, tipChord: 0.4, sweep: 30 * DEG, rootY: 6.43 },
    };
    const hTail: Pick<AircraftGeometry['hTail'], 'quarterChord' | 'tipQuarterChordX'> = { quarterChord: { x: -5.2, z: -1.9 }, tipQuarterChordX: -5.45 };
    expect(wing.breaks).toHaveLength(4);
    expect(wing.flap.segments).toHaveLength(2);
    expect(hTail.tipQuarterChordX).toBeLessThan(hTail.quarterChord.x);
  });

  it('the limits, the control system, the scripted climb and the engine snapshot take what a twin and a FADEC engine add', () => {
    const limits: Pick<LimitsDef, 'loadFactorPositiveFlaps' | 'loadFactorNegativeFlaps'> = { loadFactorPositiveFlaps: 2, loadFactorNegativeFlaps: 0 };
    const controls: Pick<ControlSystemDef, 'trimDrive'> & { trim: NonNullable<ControlSystemDef['rudder']['trim']> } = {
      trimDrive: { kind: 'electric', minVolts: 10 },
      trim: { authority: 0.2, tabDeflection: 22 * DEG, tabDeflectionLeft: 17 * DEG, rate: 0.2 },
    };
    const climb: AutoflightProfile['climb'] = { kias: 90, vsLimit: 3, throttle: 0.92 };
    const phaseControls: AutoflightProfile['phaseControls'] = { climb: { gearLever: 'up', lights: { landing: false } } };
    const presets: Partial<SimProfile['presets']> = { cold: { masterBattery: false, lights: { beacon: false } } };
    const lever: UiProfile['hud']['levers'][number] = { label: 'TRIM', read: () => 0.5, style: 'marker' };
    const snapshot: Pick<EngineSnapshot, 'ecuBackupUsed' | 'accumulatorCharged' | 'glowSeconds'> = { ecuBackupUsed: 1500, accumulatorCharged: false, glowSeconds: 4 };
    expect([limits.loadFactorPositiveFlaps, controls.trimDrive?.minVolts, controls.trim.tabDeflectionLeft, climb.throttle]).toEqual([2, 10, 17 * DEG, 0.92]);
    // A phase entry and a preset are patches: one lamp may be named without the other six.
    const c = applyControls(applyControls(defaultControls(), presets.cold!), phaseControls.climb!);
    const d = defaultControls();
    expect([c.gearLever, c.masterBattery, c.lights.landing, c.lights.beacon]).toEqual(['up', false, false, false]);
    expect([c.lights.nav, c.lights.strobe, c.lights.taxi, c.lights.panel]).toEqual([d.lights.nav, d.lights.strobe, d.lights.taxi, d.lights.panel]);
    expect([lever.style, snapshot.ecuBackupUsed]).toEqual(['marker', 1500]);
  });

  it('the area modules take the engine display rows, the anti-servo gearing, the sag time and the common controls', () => {
    const row: PanelEngineDisplayRow = { label: 'LOAD', unit: '%', min: 0, max: 100, arcs: [{ from: 0, to: 92, color: 'green' }], read: (_r, engine) => engine };
    const tab: NonNullable<TailVisualDef['h']['tab']> = { y0: 0.2, y1: 1.5, xc: 0.8, sides: 'both', gearing: 1.5 };
    const tail: Pick<TailVisualDef['h'], 'quarterChord' | 'tipQuarterChordX'> = { quarterChord: { x: -5.2, z: -1.9 }, tipQuarterChordX: -5.45 };
    const retract: Pick<RetractConfig, 'upLocks' | 'deadBusSagTime'> = { upLocks: false, deadBusSagTime: Infinity };
    const fadec: Pick<FadecDef, 'idleRpm' | 'alternatorFed'> = { alternatorFed: true };
    const input: Pick<InputProfile, 'commonControls'> = { commonControls: ['alternateAir'] };
    const gear: NonNullable<AudioProfile['gear']> = { pump: true, warningHorn: true, warningKind: 'chime' };
    expect(row.read({} as InstrumentReadings, 1)).toBe(1);
    expect([tab.gearing, tail.tipQuarterChordX, retract.deadBusSagTime, fadec.idleRpm, fadec.alternatorFed]).toEqual([1.5, -5.45, Infinity, undefined, true]);
    expect([input.commonControls, gear.warningKind]).toEqual([['alternateAir'], 'chime']);
  });
});

describe('seams', () => {
  it('buildStart takes the aircraft type as a fifth argument, defaulting to the registered one', () => {
    const env = flatEnvironment({ ...defaultWeather(), windSpeedKt: 0 });
    const spec = { kind: 'ground', spot: 'lineup07', engine: 'running' } as const;
    const implicit = buildStart(spec, env);
    const explicit = buildStart(spec, env, {}, undefined, getAircraftType());
    expect(explicit).toEqual(implicit);
    // A lesson's partial lights are layered on the preset, lamp by lamp.
    const lit = buildStart(spec, env, { controls: { lights: { landing: false } }, fuelFraction: 0.5 });
    expect(lit.controls?.lights).toEqual({ ...implicit.controls!.lights, landing: false });
    expect(lit.controls?.lights).not.toBe(implicit.controls!.lights);
    expect(lit.controls?.masterBattery).toBe(implicit.controls!.masterBattery);
  });

  // The seam is the EFFECT of a click-hold on the controls; which path it takes inside the input system (the
  // key map today) is not part of it.
  it('InputSystem.hold holds a momentary control for as long as the click lasts; the selection starts as "all"', () => {
    expect(new InputSystem().engineSelection).toBe('all');
    const { input, ctx } = makeRig({ windSpeedKt: 0 });
    const starter = (): boolean => {
      input.update(1 / 60, ctx);
      return engineControl(ctx.controls, 0, 'starter');
    };
    expect(starter()).toBe(false);
    input.hold('starter', true);
    expect(starter()).toBe(true);
    expect(starter()).toBe(true);
    input.hold('starter', false);
    expect(starter()).toBe(false);
    // Naming the engine of a single-engine type is the same control.
    input.hold('starter', true, 0);
    expect(starter()).toBe(true);
    input.hold('starter', false, 0);
    expect(starter()).toBe(false);
  });

  // A compile-time guard: the literal is what is checked (npx tsc --noEmit), the expectation cannot fail.
  it('TrimSpec accepts the multi-engine and gear members', () => {
    const spec: TrimSpec = { tas: 50, altitude: 1000, lateral: 'fixedBank', bank: 5 * DEG, engineOut: { index: 0, propeller: 'feathered' }, gearDown: false, cowlFlaps: [1, 0] };
    expect(spec.engineOut?.index).toBe(0);
  });
});

describe('Cessna 172S plain definition files', () => {
  it('reference speeds are the training profile\'s and the POH figures of core/c172.ts', () => {
    const v = C172S_TRAINING.vspeeds;
    const r = C172S_REFERENCE;
    expect(r).toEqual({
      vs0: 40, vs1: 48, vr: 55, vx: 62, vy: 74, vglide: 68, va: 105, vfe: [110, 85, 85], vno: 129, vne: 163,
      vapp: 70, vref: 65, vcruise: 105, vdownwind: 90, glideRatio: 9.0,
    });
    expect([r.vs0, r.vs1, r.vr, r.vx, r.vy, r.vglide, r.va, r.vno, r.vne, r.vapp, r.vref, r.vcruise, r.vdownwind]).toEqual([
      v.Vs0, v.Vs1, v.Vr, v.Vx, v.Vy, v.Vglide, v.Va, v.Vno, v.Vne, v.Vapp, v.Vref, v.Vcruise, v.Vdownwind,
    ]);
    expect(r.vfe).toEqual([v.Vfe10, v.VfeFull, v.VfeFull]);
    expect([r.vx, r.vy, r.vglide, r.vno, r.vne, r.glideRatio]).toEqual([
      C172.poh.vxKias, C172.poh.vyKias, C172.poh.bestGlideKias, C172.poh.vnoKias, C172.poh.vneKias, C172.poh.glideRatio,
    ]);
    expect(r.vmca).toBeUndefined();
    expect(r.vle).toBeUndefined();
  });

  it('geometry is the C172 object with the new discriminants', () => {
    const g = C172S_GEOMETRY;
    expect(g.wing).toEqual({ mount: 'high', ...C172.wing });
    expect(g.hTail).toEqual({ mount: 'fuselage', allMoving: false, ...C172.hTail });
    expect(g.vTail).toBe(C172.vTail);
    expect(g.fuselage).toBe(C172.fuselage);
    expect(g.gear).toEqual({ ...C172.gear, retractable: false });
    expect(g.propellers).toEqual([{ hub: C172.prop.hub, diameter: 1.93, blades: 2, rotation: 1 }]);
    expect(g.propellers[0].hub).toBe(C172.prop.hub);
    expect(g.restHeight).toBe(CG_HEIGHT_ON_GROUND);
    expect(g.bounds).toEqual({ radius: 6.5, fitSize: 13 });
    // Nothing of the aircraft lies outside the bounding radius.
    expect(Math.hypot(C172.wing.span / 2, C172.wing.quarterChord.z)).toBeLessThan(g.bounds.radius);
    expect(-C172.fuselage.tailX).toBeLessThan(g.bounds.radius);
  });

  it('the gear rests the reference point at restHeight', () => {
    const mass = 1050;
    const pose = new LandingGear().restingPose(mass, { x: 0, y: 0, z: 0 });
    expect(Math.abs(pose.height - C172S_GEOMETRY.restHeight)).toBeLessThan(0.03);
  });
});

describe('Cessna 172S powerplant definition', () => {
  it('keeps its electrical thresholds in volts', () => {
    const el = C172_POWERPLANT.electrical;
    expect([el.nominalVolts, el.lowVoltsLamp, el.overVolts, el.busDeadVolts]).toEqual([28, 24.5, 32, 18]);
  });

  it('splits the shaft inertia into propeller and crank side; the sum is ROTOR_INERTIA', () => {
    const { engine, propeller } = C172_POWERPLANT.engines[0];
    expect(propeller.inertia + engine.rotatingInertia).toBe(ROTOR_INERTIA);
  });
});

describe('Cessna 172S definition and presentation', () => {
  it('the definition assembles the files of its directory, with no control overrides', () => {
    const d = C172S_DEFINITION;
    expect(C172S_DEFINITION_DEFAULT).toBe(d);
    expect([d.id, d.name, d.shortName, d.icaoType, d.engineCount]).toEqual(['c172s', 'Cessna 172S Skyhawk SP', 'Cessna 172S', 'C172', 1]);
    expect(d.placeholder).toBeUndefined();
    expect(d.controlDefaults).toEqual({});
    expect(defaultControls(d)).toEqual(defaultControls());
    expect(d.geometry).toBe(C172S_GEOMETRY);
    expect(d.mass).toBe(C172S_MASS);
    expect(d.limits).toBe(C172S_LIMITS);
    expect(d.controls).toBe(C172S_CONTROLS);
    expect(d.airData).toBe(C172S_AIR_DATA);
    expect(d.autopilot).toBe(C172S_AUTOPILOT);
    expect(d.reference).toBe(C172S_REFERENCE);
    expect(d.powerplant).toBe(C172_POWERPLANT);
    expect(d.powerplant.engines).toHaveLength(d.engineCount);
    expect(d.geometry.propellers).toHaveLength(d.engineCount);
    expect(d.sim).toBe(C172S_SIM);
    expect(d.input).toBe(C172S_INPUT);
  });

  it('its factories give what the components build today', () => {
    expect(C172S_DEFINITION.aero).toBe(createC172AeroDefinition);
    // The strip model is built per AeroModel; the gear configuration is LandingGear's default argument (one
    // shared object today; a factory may come to build one per flight model, with the same content).
    expect(C172S_DEFINITION.aero()).not.toBe(C172S_DEFINITION.aero());
    expect(gearFacts(C172S_DEFINITION.gear())).toEqual(gearFacts(C172_GEAR));
  });

  it('the presentation assembles the browser-side files', () => {
    const p = C172S_PRESENTATION;
    expect(C172S_PRESENTATION_DEFAULT).toBe(p);
    expect(p.id).toBe('c172s');
    expect(p.visual).toBe(C172S_VISUAL);
    expect(p.panel).toBe(C172S_PANEL);
    expect(p.instrumentSystems).toBe(C172S_INSTRUMENT_SYSTEMS);
    expect(p.ui).toBe(C172S_UI);
    expect(p.audio).toBe(C172S_AUDIO);
    expect(p.training).toBe(C172S_TRAINING);
    expect(p.training).toBe(getAircraftType());
  });

  it('the airframe visual is plain data and places the eye and the panel where the cockpit has them', () => {
    const v = C172S_VISUAL;
    expect(structuredClone(v)).toEqual(v);
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
    expect(v.id).toBe('c172s');
    const eye = C172.fuselage.pilotEye;
    expect(v.cockpit.pilotEye).toEqual([eye.x, eye.y, eye.z]);
    expect(v.cockpit.defaultPitchDeg).toBe(-7);
    expect(v.cockpit.panel).toEqual({ x: PANEL.x, zTop: PANEL.zTop, width: PANEL.width });
    // No pxRect: the whole 2080 x 800 px canvas at 2000 px/m gives today's face height.
    expect((PANEL_HEIGHT / PANEL_WIDTH) * v.cockpit.panel.width).toBeCloseTo(PANEL.height, 12);
    expect(v.shadow.halfX).toBeGreaterThanOrEqual(C172S_GEOMETRY.bounds.radius);
    expect(v.shadow.fuselage).toHaveLength(3);
  });

  it('a mock state takes its identity from the definition', () => {
    expect(makeMockState({ def: C172S_DEFINITION }).aircraft).toBe('c172s');
    expect(makeMockState({ def: C172S_DEFINITION }).engines).toHaveLength(1);
  });
});

describe('aircraft registry', () => {
  it('the catalogue has one row per id, in the order of AIRCRAFT_IDS, the C172S available', () => {
    expect(REGISTRY_IDS).toBe(AIRCRAFT_IDS);
    expect(AIRCRAFT_CATALOGUE.map((r) => r.id)).toEqual([...AIRCRAFT_IDS]);
    for (const id of AIRCRAFT_IDS) {
      const row = aircraftSummary(id);
      expect(row, id).toBe(AIRCRAFT_CATALOGUE.find((r) => r.id === id));
      expect(row.name.length, id).toBeGreaterThan(0);
      expect(row.shortName.length, id).toBeGreaterThan(0);
      expect(row.blurb.length, id).toBeGreaterThan(0);
    }
    expect(aircraftSummary('c172s')).toEqual({
      id: 'c172s',
      name: C172S_DEFINITION.name,
      shortName: C172S_DEFINITION.shortName,
      blurb: 'Four-seat high-wing trainer, 180 hp',
      engineCount: 1,
      available: true,
    });
    expect(aircraftSummary(DEFAULT_AIRCRAFT_ID).available).toBe(true);
    expect(() => aircraftSummary('c172' as never)).toThrow();
    expect(AIRCRAFT_PREF_KEY).toBe('fs.aircraft');
  });

  it('the C172S is loaded from the start; it is the object every component defaults to', async () => {
    expect(loadedAircraft('c172s')).toBe(C172S_DEFINITION);
    expect(await loadAircraft('c172s')).toBe(C172S_DEFINITION);
    expect(await loadPresentation('c172s')).toBe(C172S_PRESENTATION);
  });

  it('every id loads; a placeholder is not available; the catalogue agrees with a finished type', async () => {
    for (const id of AIRCRAFT_IDS) {
      const row = aircraftSummary(id);
      const def = await loadAircraft(id);
      expect(def.id, id).toBe(id);
      expect(loadedAircraft(id), id).toBe(def);
      expect(await loadAircraft(id), id).toBe(def);
      if (def.placeholder === true) {
        expect(row.available, id).toBe(false);
      } else {
        expect(row.engineCount, id).toBe(def.engineCount);
        expect(row.name, id).toBe(def.name);
        expect(row.shortName, id).toBe(def.shortName);
      }
      expect(def.powerplant.engines, id).toHaveLength(def.engineCount);
      expect(def.geometry.propellers, id).toHaveLength(def.engineCount);
      expect(defaultControls(def).engines, id).toHaveLength(def.engineCount);
    }
  });

  it('every presentation loads and carries its id, on the airframe too', async () => {
    for (const id of AIRCRAFT_IDS) {
      const p = await loadPresentation(id);
      expect(p.id, id).toBe(id);
      expect(p.visual.id, id).toBe(id);
      expect(await loadPresentation(id), id).toBe(p);
      for (const member of ['panel', 'instrumentSystems', 'ui', 'audio', 'training'] as const) expect(p[member], `${id}.${member}`).toBeDefined();
      expect(structuredClone(p.audio), id).toEqual(p.audio);
    }
  });

  it('every airframe visual loads by itself as plain data; the registry hands out the loader of visualLoader.ts', async () => {
    expect(loadAirframeVisual).toBe(loadAirframeVisualDirect);
    for (const id of AIRCRAFT_IDS) {
      const v = await loadAirframeVisual(id);
      expect(v.id, id).toBe(id);
      expect(structuredClone(v), id).toEqual(v);
      expect(await loadAirframeVisual(id), id).toBe(v);
      expect((await loadPresentation(id)).visual, id).toEqual(v);
    }
    expect(await loadAirframeVisual('c172s')).toBe(C172S_VISUAL);
    await expect(loadAirframeVisual('c172')).rejects.toThrow(/unknown aircraft/);
    await expect(loadAirframeVisual('constructor')).rejects.toThrow(/unknown aircraft/);
  });

  it('an unknown id is refused by every loader', async () => {
    await expect(loadAircraft('c172' as never)).rejects.toThrow(/unknown aircraft/);
    await expect(loadPresentation('toString' as never)).rejects.toThrow(/unknown aircraft/);
  });
});

describe('placeholders', () => {
  const names = { name: 'Test type', shortName: 'Test', variant: 'Test type (placeholder)', icaoType: 'TEST' };

  it('a placeholder definition is the C172S under another id: one engine, marked, same parts', () => {
    const d = placeholderDefinition('pa34', names);
    expect(d).toEqual({ ...C172S_DEFINITION, id: 'pa34', ...names, engineCount: 1, placeholder: true });
    expect(d.geometry).toBe(C172S_GEOMETRY);
    expect(d.powerplant).toBe(C172_POWERPLANT);
    expect(d.aero).toBe(C172S_DEFINITION.aero);
    expect(d.gear).toBe(C172S_DEFINITION.gear);
    expect(C172S_DEFINITION.id).toBe('c172s');
    expect(C172S_DEFINITION.placeholder).toBeUndefined();
  });

  it('a placeholder presentation is the C172S one with the id on it and on a copy of the airframe', () => {
    const p = placeholderPresentation('da42', C172S_PRESENTATION);
    expect(p.id).toBe('da42');
    expect(p.visual).toEqual({ ...C172S_VISUAL, id: 'da42' });
    expect(p.panel).toBe(C172S_PANEL);
    expect(p.ui).toBe(C172S_UI);
    expect(p.audio).toBe(C172S_AUDIO);
    expect(C172S_PRESENTATION.id).toBe('c172s');
    expect(C172S_VISUAL.id).toBe('c172s');
  });

  it('a type that is still a placeholder flies the C172S flight model data and shows its panel', async () => {
    for (const id of AIRCRAFT_IDS) {
      const def = await loadAircraft(id);
      if (def.placeholder !== true) continue;
      const { id: _id, name, shortName, variant, icaoType, placeholder: _placeholder, ...rest } = def;
      const { id: _c, name: _n, shortName: _s, variant: _v, icaoType: _i, ...c172s } = C172S_DEFINITION;
      expect(rest, id).toEqual(c172s);
      for (const text of [name, shortName, variant, icaoType]) expect(text.length, id).toBeGreaterThan(0);
      expect(name, id).toBe(aircraftSummary(id).name);
      expect(shortName, id).toBe(aircraftSummary(id).shortName);
      const p = await loadPresentation(id);
      expect(p.panel, id).toBe(C172S_PANEL);
      expect(p.instrumentSystems, id).toBe(C172S_INSTRUMENT_SYSTEMS);
      expect(p.training, id).toBe(C172S_TRAINING);
    }
  });
});

describe('aircraft selection and context', () => {
  it('parseParams reads aircraft=<id>; absent or unknown is null', () => {
    expect(parseParams('').aircraft).toBeNull();
    expect(parseParams('?scenario=final').aircraft).toBeNull();
    for (const id of AIRCRAFT_IDS) expect(parseParams(`?aircraft=${id}`).aircraft, id).toBe(id);
    expect(parseParams('?aircraft=c172').aircraft).toBeNull();
    expect(parseParams('?aircraft=').aircraft).toBeNull();
    expect(parseParams('?aircraft=C172S').aircraft).toBeNull();
    expect(parseParams('?aircraft=da42&scenario=cruise').scenario).toBe('cruise');
  });

  // The `members` literal is a compile-time guard (npx tsc --noEmit): its expectations cannot fail. The event is run.
  it('the context carries the definition and the presentation; the gear event travels on the bus', () => {
    const members: Pick<SimContext, 'aircraft' | 'presentation' | 'engineSelection' | 'carbIcing'> = {
      aircraft: C172S_DEFINITION,
      presentation: C172S_PRESENTATION,
    };
    expect(members.aircraft.id).toBe(members.presentation.id);
    expect(members.engineSelection).toBeUndefined();
    expect(members.carbIcing).toBeUndefined();
    const bus = createEventBus();
    const seen: string[] = [];
    bus.on('gear', (e) => seen.push(`${e.kind} ${e.leg}`));
    bus.emit('gear', { kind: 'downLocked', leg: 2 });
    expect(seen).toEqual(['downLocked 2']);
  });
});

// Last in the file: it evaluates the modules a second time, and what a loader imports after that would be
// built from the second C172S definition.
describe('a registry of its own', () => {
  it('a type that is not loaded yet throws; a registered definition is there at once and stays', async () => {
    vi.resetModules();
    const fresh = await import('../../src/aircraft/registry');
    const c172s = fresh.loadedAircraft('c172s');
    expect(() => fresh.loadedAircraft('pa34')).toThrow(/not loaded/);
    const twin = { ...c172s, id: 'pa34' as const, name: 'Test twin' };
    fresh.registerAircraft(twin);
    expect(fresh.loadedAircraft('pa34')).toBe(twin);
    expect(await fresh.loadAircraft('pa34')).toBe(twin);
    expect(fresh.loadedAircraft('c172s')).toBe(c172s);
  });
});
