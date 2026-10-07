// The Cessna 172S sim profile and UI profile (src/aircraft/c172s/sim.ts, ui.ts) against what src/sim and
// src/ui do today.
//
// C172S_SIM refers to the constants of scenarios.ts, starts.ts and autoflight.ts BY REFERENCE, so every member
// must BE the constant it names; the tables below are the same numbers written out (the scenario line of the
// contract, the autoflight table of the sim map), which catches a member wired to the wrong constant. The
// scripted-pilot tests then fly one step of each law and compare it with the law written in the profile's
// terms: that is the reading of each member the profile was written to.
//
// C172S_UI holds closures written inline; they must say what cues.ts says for every switch and state.

import { describe, expect, it } from 'vitest';
import { C172S_GEOMETRY } from '../../src/aircraft/c172s/geometry';
import { C172S_REFERENCE } from '../../src/aircraft/c172s/reference';
import { C172S_SIM } from '../../src/aircraft/c172s/sim';
import simSource from '../../src/aircraft/c172s/sim.ts?raw';
import { C172S as C172S_TRAINING } from '../../src/aircraft/c172s/training';
import { C172S_UI } from '../../src/aircraft/c172s/ui';
import uiSource from '../../src/aircraft/c172s/ui.ts?raw';
import { C172 } from '../../src/core/c172';
import { DEG, FT, KT, clamp, wrapPi } from '../../src/core/math';
import { makeMockState } from '../../src/core/mockState';
import {
  applyControls,
  defaultControls,
  defaultWeather,
  setEngineControl,
  type AircraftState,
  type ControlInputs,
  type FuelSelector,
  type MagnetoPosition,
} from '../../src/core/types';
import { AIRPORT, runwayCoords } from '../../src/core/world';
import { createEnvironment } from '../../src/physics';
import * as autoflight from '../../src/sim/autoflight';
import { Autoflight, centrelineRudder, type AutoflightPhase } from '../../src/sim/autoflight';
import * as scenarios from '../../src/sim/scenarios';
import { PATTERN_ALTITUDE, buildScenario, type AutoflightPlan } from '../../src/sim/scenarios';
import * as starts from '../../src/sim/starts';
import { buildStart } from '../../src/sim/starts';
import { flapLeverFor } from '../../src/training/aircraft/c172s';
import {
  FUEL_NAMES,
  MAGNETO_NAMES,
  STARTUP_STEPS,
  mixtureLabel,
  starterAdvice,
  switchChanges,
  switchSnapshot,
  trimLabel,
  type SwitchSnapshot,
} from '../../src/ui/cues';

const RWY = AIRPORT.runway;
const env = createEnvironment({
  weather: defaultWeather(),
  terrain: { height: () => AIRPORT.elevation, normal: () => ({ x: 0, y: 0, z: -1 }), surface: () => 'runway' },
});

describe('C172S_SIM.scenario', () => {
  const sc = C172S_SIM.scenario;

  it('is the constants of scenarios.ts and starts.ts', () => {
    expect(sc.finalKias).toBe(scenarios.FINAL_KIAS);
    expect(sc.cruiseKias).toBe(scenarios.CRUISE_KIAS);
    expect(sc.cruiseAltFt).toBe(scenarios.CRUISE_ALT_FT);
    expect(sc.downwindKias).toBe(scenarios.DOWNWIND_KIAS);
    expect(sc.afterTakeoffKias).toBe(scenarios.AFTER_TAKEOFF_KIAS);
    expect(sc.baseFlapsDeg).toBe(starts.BASE_FLAPS_DEG);
  });

  it('holds the numbers of the contract', () => {
    expect(sc).toEqual({
      finalKias: 70,
      finalFlapsDeg: 20,
      baseFlapsDeg: 20,
      cruiseKias: 110,
      cruiseAltFt: 4500,
      downwindKias: 90,
      downwindFlapsDeg: 0,
      afterTakeoffKias: 90,
      restoreMinTas: 25,
      restoreFallbackTas: 50,
    });
  });

  it('gives its flap settings in degrees: through the detent table they are the levers the code sets', () => {
    expect(flapLeverFor(C172S_TRAINING, sc.finalFlapsDeg)).toBe(scenarios.FINAL_FLAPS);
    expect(flapLeverFor(C172S_TRAINING, sc.downwindFlapsDeg)).toBe(0);
    expect(flapLeverFor(C172S_TRAINING, C172S_SIM.autoflight.takeoff.flapsDeg)).toBe(autoflight.TAKEOFF_FLAPS);
  });

  it('is what the five scenarios start from', () => {
    const runway = buildScenario('runway', env);
    expect(runway.autoflight).toMatchObject({ kind: 'takeoff', cruiseKias: sc.afterTakeoffKias });
    const final = buildScenario('final', env);
    expect(final.autoflight).toEqual({ kind: 'approach', kias: sc.finalKias });
    expect(final.ic.flaps).toBe(flapLeverFor(C172S_TRAINING, sc.finalFlapsDeg));
    expect(final.ic.airspeed).toBe(scenarios.kiasToTas(sc.finalKias, -final.ic.position.z, env));
    const cruise = buildScenario('cruise', env);
    expect(cruise.autoflight).toMatchObject({ kind: 'hold', altitude: sc.cruiseAltFt * FT, kias: sc.cruiseKias });
    expect(cruise.ic.airspeed).toBe(scenarios.kiasToTas(sc.cruiseKias, sc.cruiseAltFt * FT, env));
    const downwind = buildScenario('downwind', env);
    expect(downwind.autoflight).toMatchObject({ kind: 'hold', kias: sc.downwindKias });
    expect(downwind.ic.airspeed).toBe(scenarios.kiasToTas(sc.downwindKias, PATTERN_ALTITUDE, env));
    expect(downwind.ic.flaps ?? 0).toBe(flapLeverFor(C172S_TRAINING, sc.downwindFlapsDeg));
  });

  it('is what the Flight School starts use where a lesson names nothing', () => {
    const lineup = buildStart({ kind: 'ground', spot: 'lineup07', engine: 'running' }, env);
    expect(lineup.autoflight).toMatchObject({ kind: 'takeoff', cruiseKias: sc.afterTakeoffKias });
    const base = buildStart({ kind: 'circuit', leg: 'base', position: 'abeamMid', kias: 75 }, env);
    expect(base.ic.flaps).toBe(flapLeverFor(C172S_TRAINING, sc.baseFlapsDeg));
  });
});

describe('C172S_SIM.presets', () => {
  const p = C172S_SIM.presets;

  it('are the five preset objects of starts.ts', () => {
    expect(p.cold).toBe(starts.COLD);
    expect(p.groundRunning).toBe(starts.GROUND_RUNNING);
    expect(p.linedUp).toBe(starts.LINED_UP);
    expect(p.airborne).toBe(starts.AIRBORNE);
    expect(p.approach).toBe(starts.ON_APPROACH);
    expect(Object.keys(p).sort()).toEqual(['airborne', 'approach', 'cold', 'groundRunning', 'linedUp']);
  });

  it('are what each kind of start applies', () => {
    expect(buildStart({ kind: 'ground', spot: 'parking', engine: 'cold' }, env).controls).toBe(p.cold);
    expect(buildStart({ kind: 'ground', spot: 'holdA1', engine: 'running' }, env).controls).toBe(p.groundRunning);
    expect(buildStart({ kind: 'ground', spot: 'lineup07', engine: 'running' }, env).controls).toBe(p.linedUp);
    expect(buildStart({ kind: 'air', at: 'trainingArea', altFt: 3000, altRef: 'msl', hdgDeg: 90, kias: 100 }, env).controls).toBe(p.airborne);
    expect(buildStart({ kind: 'circuit', leg: 'downwind', position: 'abeamMid', kias: 90 }, env).controls).toBe(p.airborne);
    expect(buildStart({ kind: 'final', distNm: 2, kias: 65, flapsDeg: 30 }, env).controls).toBe(p.approach);
    expect(buildStart({ kind: 'circuit', leg: 'base', position: 'early', kias: 75 }, env).controls).toBe(p.approach);
  });

  it('set the same controls as the free-flight scenarios do with their own literals', () => {
    const applied = (patch: Parameters<typeof applyControls>[1] | undefined): ControlInputs => applyControls(defaultControls(), patch ?? {});
    expect(buildScenario('apron', env).controls).toEqual(p.cold);
    expect(buildScenario('final', env).controls).toEqual(p.approach);
    // The runway scenario sets the lights only; the switches of the lined-up preset are the defaults.
    expect(applied(buildScenario('runway', env).controls)).toEqual(applied(p.linedUp));
    expect(applied(buildScenario('cruise', env).controls)).toEqual(applied(p.airborne));
    expect(applied(buildScenario('downwind', env).controls)).toEqual(applied(p.airborne));
  });
});

describe('C172S_SIM.autoflight', () => {
  const a = C172S_SIM.autoflight;
  const restHeight = C172S_GEOMETRY.restHeight;

  it('is the constants of autoflight.ts', () => {
    expect(a.takeoff.rotateKias).toBe(autoflight.ROTATE_KIAS);
    expect(a.takeoff.rotatePitchDeg[0]).toBe(autoflight.ROTATE_PITCH_DEG);
    expect(a.takeoff.rotatePitchDeg[1]).toBe(autoflight.ROTATE_PITCH_DEG + autoflight.ROTATE_PITCH_RISE_DEG);
    expect(a.takeoff.rotateBlendKt).toBe(autoflight.ROTATE_BLEND_KT);
    expect(a.takeoff.elevatorBias).toBe(autoflight.ROTATE_ELEVATOR_BIAS);
    expect(a.takeoff.pitchGain).toBe(autoflight.ROTATE_PITCH_GAIN);
    expect(a.takeoff.pitchRateGain).toBe(autoflight.ROTATE_PITCH_RATE_GAIN);
    expect(a.takeoff.aileronAliveKias).toBe(autoflight.AILERON_ALIVE_KIAS);
    expect(a.takeoff.handoverM).toBe(autoflight.HANDOVER_HEIGHT);
    expect(a.climb.kias).toBe(autoflight.CLIMB_KIAS);
    expect(a.climb.vsLimit).toBe(autoflight.CLIMB_VS_LIMIT);
    expect(a.hold.minKias).toBe(autoflight.HOLD_MIN_KIAS);
    expect(a.hold.maxBankDeg).toBe(autoflight.HOLD_MAX_BANK_DEG);
    expect(a.hold.vsLimit).toBe(autoflight.HOLD_VS_LIMIT);
    expect(a.flare.minHeightM).toBe(autoflight.FLARE_MIN_HEIGHT);
    expect(a.flare.timeS).toBe(autoflight.FLARE_TIME);
    expect(a.flare.pitchRiseDeg).toBe(autoflight.FLARE_PITCH_RISE_DEG);
    expect(a.flare.maxPitchDeg).toBe(autoflight.FLARE_MAX_PITCH_DEG);
    expect(a.rollout.brake).toBe(autoflight.ROLLOUT_BRAKE);
    expect(a.rollout.noseHoldKias[0]).toBe(autoflight.ROLLOUT_NOSE_HOLD_KIAS);
    expect(a.rollout.noseHoldKias[1]).toBe(autoflight.ROLLOUT_NOSE_HOLD_KIAS + autoflight.ROLLOUT_NOSE_HOLD_RANGE_KT);
    expect(a.rollout.noseHoldMax).toBe(autoflight.ROLLOUT_NOSE_HOLD_MAX);
    expect(a.centreline.headingGain).toBe(autoflight.CENTRELINE_HEADING_GAIN);
    expect(a.centreline.yawRateGain).toBe(autoflight.CENTRELINE_YAW_RATE_GAIN);
    expect(a.centreline.lookAheadM).toBe(autoflight.CENTRELINE_LOOK_AHEAD);
  });

  it('holds the numbers of the scripted pilot', () => {
    expect(a).toEqual({
      takeoff: {
        flapsDeg: 0,
        rotateKias: 55,
        rotatePitchDeg: [4, 8],
        rotateBlendKt: 6,
        elevatorBias: 0.3,
        pitchGain: 5,
        pitchRateGain: 1.5,
        aileronAliveKias: 40,
        handoverM: 15,
      },
      climb: { kias: 74, vsLimit: 3 },
      hold: { minKias: 65, maxBankDeg: 25, vsLimit: 3.5 },
      flare: { minHeightM: 6, timeS: 3, pitchRiseDeg: 7, maxPitchDeg: 10 },
      rollout: { brake: 0.8, noseHoldKias: [25, 65], noseHoldMax: 0.5 },
      steering: { kind: 'rudder' },
      centreline: { headingGain: 4, yawRateGain: 1.5, lookAheadM: 60 },
      phaseControls: {},
    });
    // The climb is flown at Vy, and the take-off trim is the Vy climb with the flaps up.
    expect(a.climb.kias).toBe(C172S_REFERENCE.vy);
    expect(C172S_SIM.takeoffTrim.kias).toBe(C172.poh.vyKias);
    expect(C172S_SIM.takeoffTrim).toEqual({ kias: 74, flapsDeg: 0 });
  });

  const takeoffPlan: AutoflightPlan = { kind: 'takeoff', heading: RWY.heading, climbTo: PATTERN_ALTITUDE, cruiseKias: 90 };
  const onRunway = (kias: number): AircraftState => {
    const s = makeMockState({ north: RWY.center.north, east: RWY.center.east, heightAGL: 0 });
    s.ias = kias * KT;
    return s;
  };
  const airborne = (heightAboveRest: number): AircraftState =>
    makeMockState({ north: RWY.center.north, east: RWY.center.east, heightAGL: restHeight + heightAboveRest, tas: 65 * KT });
  /** An autoflight continued in `phase` (as after a resume). */
  const inPhase = (phase: AutoflightPhase, plan: AutoflightPlan, flareStartPitch: number | null = null, flareHeight: number | null = null): Autoflight => {
    const af = new Autoflight();
    af.importState({ phase, plan, settings: { ...af.autopilot.settings }, drift: 0, dgOffset: 0, flareStartPitch, flareHeight, integrators: {} });
    return af;
  };

  it('centreline: headingGain on the heading error toward a point lookAheadM ahead, yawRateGain on the yaw rate', () => {
    const k = a.centreline;
    // 5 m right of the centreline, 1.5 degrees off the runway heading, yawing.
    const s = makeMockState({ north: RWY.center.north - 5 * Math.sin(RWY.heading), east: RWY.center.east + 5 * Math.cos(RWY.heading), heightAGL: 0 });
    s.heading = RWY.heading + 1.5 * DEG;
    s.angularVelocity.z = 0.04;
    const across = runwayCoords(s.position.x, s.position.y).across;
    expect(across).toBeCloseTo(5, 9);
    const desired = RWY.heading - Math.atan2(across, k.lookAheadM);
    const expected = k.headingGain * wrapPi(desired - s.heading) - k.yawRateGain * s.angularVelocity.z;
    expect(Math.abs(expected)).toBeLessThan(1);
    expect(centrelineRudder(s, RWY.heading)).toBeCloseTo(expected, 12);
  });

  it('take-off: flaps set, rotation law from rotateKias, ailerons above aileronAliveKias', () => {
    const t = a.takeoff;
    const kias = t.rotateKias + t.rotateBlendKt / 2;
    const s = onRunway(kias);
    s.pitch = 2 * DEG;
    s.angularVelocity.y = 0.01;
    s.roll = 3 * DEG;
    const c = defaultControls();
    c.flaps = 1;
    const af = new Autoflight();
    af.engage(takeoffPlan, s, c);
    expect(c.flaps).toBe(flapLeverFor(C172S_TRAINING, t.flapsDeg));
    af.update(1 / 60, s, c);
    const blend = clamp((kias - t.rotateKias) / t.rotateBlendKt, 0, 1);
    const target = (t.rotatePitchDeg[0] + (t.rotatePitchDeg[1] - t.rotatePitchDeg[0]) * blend) * DEG;
    const expected = t.pitchGain * (target - s.pitch) - t.pitchRateGain * s.angularVelocity.y + t.elevatorBias;
    expect(Math.abs(expected)).toBeLessThan(1);
    expect(c.elevator).toBeCloseTo(expected, 12);
    expect(c.aileron).not.toBe(0);

    // Below the rotation speed the elevator is left alone; below the aileron speed so are the ailerons.
    for (const [v, elevator, aileron] of [
      [t.rotateKias - 1, false, true],
      [t.aileronAliveKias + 1, false, true],
      [t.aileronAliveKias - 1, false, false],
    ] as const) {
      const slow = onRunway(v);
      slow.roll = 3 * DEG;
      const cs = defaultControls();
      const roll = new Autoflight();
      roll.engage(takeoffPlan, slow, cs);
      roll.update(1 / 60, slow, cs);
      expect(cs.elevator !== 0, `elevator at ${v} kt`).toBe(elevator);
      expect(cs.aileron !== 0, `aileron at ${v} kt`).toBe(aileron);
    }
  });

  it('take-off: the autopilot takes over handoverM above the rest height, climbing at climb.kias', () => {
    for (const [above, phase] of [
      [a.takeoff.handoverM - 0.2, 'roll'],
      [a.takeoff.handoverM + 0.2, 'climb'],
    ] as const) {
      const ground = onRunway(60);
      const c = defaultControls();
      const af = new Autoflight();
      af.engage(takeoffPlan, ground, c);
      const s = airborne(above);
      af.update(1 / 60, s, c);
      expect(af.phase, `${above} m above the rest height`).toBe(phase);
      if (phase === 'climb') {
        expect(af.autopilot.settings.vertical).toBe('airspeed');
        expect(af.autopilot.settings.airspeed).toBeCloseTo(a.climb.kias * KT, 12);
      }
    }
    // Engaged at the plan's altitude: level, capturing with climb.vsLimit.
    const high = makeMockState({ heightAGL: PATTERN_ALTITUDE - AIRPORT.elevation });
    const af = new Autoflight();
    af.engage(takeoffPlan, high, defaultControls());
    expect(af.phase).toBe('cruise');
    expect(af.autopilot.settings.verticalSpeed).toBe(a.climb.vsLimit);
  });

  it('hold (the A key): not below hold.minKias, bank limited to hold.maxBankDeg, capture at hold.vsLimit', () => {
    const s = makeMockState({ tas: 50 * KT });
    const af = new Autoflight();
    af.engageHere(s, defaultControls());
    expect(af.plan).toMatchObject({ kind: 'hold', kias: a.hold.minKias });
    expect(af.autopilot.settings.maxBank).toBeCloseTo(a.hold.maxBankDeg * DEG, 12);
    expect(af.autopilot.settings.verticalSpeed).toBe(a.hold.vsLimit);
    const fast = makeMockState({ tas: 110 * KT });
    af.engageHere(fast, defaultControls());
    expect(af.plan).toMatchObject({ kind: 'hold', kias: fast.ias / KT });
  });

  it('flare: begins flare.timeS above the ground at the present sink rate, not below flare.minHeightM', () => {
    const f = a.flare;
    const approach: AutoflightPlan = { kind: 'approach', kias: 70 };
    const fastSink = (2 * f.minHeightM) / f.timeS;
    for (const [sink, height, phase] of [
      [1, f.minHeightM + 0.2, 'approach'],
      [1, f.minHeightM - 0.2, 'flare'],
      [fastSink, f.timeS * fastSink + 0.2, 'approach'],
      [fastSink, f.timeS * fastSink - 0.2, 'flare'],
    ] as const) {
      const s = airborne(height);
      s.verticalSpeed = -sink;
      const af = inPhase('approach', approach);
      af.update(1 / 60, s, defaultControls());
      expect(af.phase, `${height} m, sinking ${sink} m/s`).toBe(phase);
    }
    // At the ground the target is the pitch at the start of the flare plus pitchRiseDeg, limited to maxPitchDeg.
    for (const startDeg of [1, f.maxPitchDeg - f.pitchRiseDeg + 2]) {
      const s = airborne(0);
      const af = inPhase('flare', approach, startDeg * DEG, f.minHeightM);
      af.update(1 / 60, s, defaultControls());
      expect(af.autopilot.settings.pitch).toBeCloseTo(Math.min(startDeg + f.pitchRiseDeg, f.maxPitchDeg) * DEG, 12);
    }
  });

  it('roll-out: brakes at rollout.brake, the elevator holds the nose from noseHoldKias[0], rising toward [1], up to noseHoldMax', () => {
    const r = a.rollout;
    const [lo, hi] = r.noseHoldKias;
    for (const kias of [lo - 5, lo + 10, lo + 0.3 * (hi - lo), hi]) {
      const s = onRunway(kias);
      s.groundSpeed = kias * KT;
      const c = defaultControls();
      const af = inPhase('rollout', { kind: 'approach', kias: 70 });
      af.update(1 / 60, s, c);
      expect(c.elevator, `${kias} kt`).toBeCloseTo(clamp((kias - lo) / (hi - lo), 0, r.noseHoldMax), 12);
      expect(c.brakeLeft).toBe(r.brake);
      expect(c.brakeRight).toBe(r.brake);
      expect(c.flaps).toBe(0);
    }
  });
});

describe('C172S_UI', () => {
  const ui = C172S_UI;

  it('names the yoke and shows the start-up card of cues.ts', () => {
    expect(ui.controlName).toBe('yoke');
    expect(ui.startupSteps).toBe(STARTUP_STEPS);
    expect(ui.hints).toEqual([]);
  });

  it('gives the starter advice of cues.ts in every state', () => {
    const selectors: FuelSelector[] = ['off', 'left', 'right', 'both', 'on', 'crossfeed'];
    const mixtures = [0, 0.01, 0.0199, 0.02, 0.0201, 0.085, 0.3, 0.4999, 0.5, 0.7, 0.984, 0.985, 1];
    const seen = new Set<string | null>();
    for (const masterBattery of [false, true]) {
      for (const fuelSelector of selectors) {
        for (const mixture of mixtures) {
          const c = defaultControls();
          Object.assign(c, { masterBattery, fuelSelector, mixture });
          const advice = ui.starterAdvice(c, 0);
          expect(advice, `${masterBattery} ${fuelSelector} ${mixture}`).toBe(starterAdvice(c));
          seen.add(advice);
        }
      }
    }
    // Master off, selector off, idle cut-off, too lean (with the mixture read out), and nothing wrong.
    expect(seen.has(null)).toBe(true);
    expect(seen.size).toBeGreaterThanOrEqual(6);
    expect(ui.starterAdvice(Object.assign(defaultControls(), { mixture: 0.085 }), 0)).toBe(`${mixtureLabel(0.085)}: too lean to start. Hold Shift+M for full rich.`);
  });

  it('reads the mixture and the fuel selector of the engine asked about', () => {
    const c = defaultControls();
    expect(ui.starterAdvice(c, 0)).toBeNull();
    setEngineControl(c, 0, 'mixture', 0);
    expect(ui.starterAdvice(c, 0)).toMatch(/IDLE CUT-OFF/);
    setEngineControl(c, 0, 'mixture', 1);
    setEngineControl(c, 0, 'fuelSelector', 'off');
    expect(ui.starterAdvice(c, 0)).toMatch(/fuel selector is OFF/);
  });

  /** The toasts a table-driven announcer makes of two control sets: one per switch whose reading changed. */
  const announced = (prev: ControlInputs, cur: ControlInputs, skip: readonly string[] = []): string[] =>
    ui.switches.filter((sw) => !skip.includes(sw.id) && sw.read(prev) !== sw.read(cur)).map((sw) => `${sw.label} ${sw.read(cur)}`);
  const changes = (prev: ControlInputs, cur: ControlInputs): string[] => switchChanges(switchSnapshot(prev), switchSnapshot(cur));

  /** Every position of every switch, as a patch of the controls. */
  const positions: Record<keyof SwitchSnapshot, ((c: ControlInputs) => void)[]> = {
    masterBattery: [false, true].map((v) => (c: ControlInputs) => void (c.masterBattery = v)),
    alternator: [false, true].map((v) => (c: ControlInputs) => void (c.alternator = v)),
    avionics: [false, true].map((v) => (c: ControlInputs) => void (c.avionics = v)),
    magnetos: ([0, 1, 2, 3] as MagnetoPosition[]).map((v) => (c: ControlInputs) => void (c.magnetos = v)),
    fuelPump: [false, true].map((v) => (c: ControlInputs) => void (c.fuelPump = v)),
    fuelSelector: (Object.keys(FUEL_NAMES) as FuelSelector[]).map((v) => (c: ControlInputs) => void (c.fuelSelector = v)),
    pitotHeat: [false, true].map((v) => (c: ControlInputs) => void (c.pitotHeat = v)),
    nav: [false, true].map((v) => (c: ControlInputs) => void (c.lights.nav = v)),
    beacon: [false, true].map((v) => (c: ControlInputs) => void (c.lights.beacon = v)),
    strobe: [false, true].map((v) => (c: ControlInputs) => void (c.lights.strobe = v)),
    landing: [false, true].map((v) => (c: ControlInputs) => void (c.lights.landing = v)),
    taxi: [false, true].map((v) => (c: ControlInputs) => void (c.lights.taxi = v)),
  };

  it('lists the switches of the switch snapshot, in the order they are announced', () => {
    expect(ui.switches.map((sw) => sw.id)).toEqual(Object.keys(switchSnapshot(defaultControls())));
    expect(ui.switches.map((sw) => sw.id)).toEqual(Object.keys(positions));
    expect(Object.keys(MAGNETO_NAMES)).toHaveLength(4);
  });

  it('announces every switch, in every position, as cues.ts does', () => {
    for (const sw of ui.switches) {
      if (sw.id === 'masterBattery' || sw.id === 'alternator') continue;
      const set = positions[sw.id as keyof SwitchSnapshot];
      for (const from of set) {
        for (const to of set) {
          const prev = defaultControls();
          from(prev);
          const cur = defaultControls();
          to(cur);
          expect(announced(prev, cur), sw.id).toEqual(changes(prev, cur));
          if (from !== to) expect(announced(prev, cur), sw.id).toHaveLength(1);
        }
      }
    }
  });

  it('announces the two halves of the master switch as cues.ts does, which merges them when they end up alike', () => {
    const battery = ui.switches.find((sw) => sw.id === 'masterBattery')!;
    const alternator = ui.switches.find((sw) => sw.id === 'alternator')!;
    const states = [false, true].flatMap((b) => [false, true].map((alt) => ({ masterBattery: b, alternator: alt })));
    for (const from of states) {
      for (const to of states) {
        const prev = Object.assign(defaultControls(), from);
        const cur = Object.assign(defaultControls(), to);
        const today = changes(prev, cur);
        const table = announced(prev, cur);
        if (table.length === 0) expect(today).toEqual([]);
        else if (to.masterBattery === to.alternator) {
          expect(today).toEqual([`Master switch ${battery.read(cur)}`]);
          expect(battery.read(cur)).toBe(alternator.read(cur));
        } else if (from.alternator !== to.alternator) expect(today).toEqual([`${alternator.label} ${alternator.read(cur)}`]);
        else expect(today).toEqual(table);
      }
    }
  });

  it('announces several changes in the order of cues.ts', () => {
    const prev = defaultControls();
    const cur = defaultControls();
    for (const [id, set] of Object.entries(positions)) {
      if (id === 'masterBattery' || id === 'alternator') continue;
      const before = announced(prev, cur);
      for (const to of set) {
        to(cur);
        if (announced(prev, cur).length > before.length) break;
      }
    }
    const today = changes(prev, cur);
    expect(today).toHaveLength(ui.switches.length - 2);
    expect(announced(prev, cur)).toEqual(today);
    // With the master switch thrown as well, its one message comes first.
    cur.masterBattery = cur.alternator = !prev.masterBattery;
    prev.alternator = prev.masterBattery;
    expect(changes(prev, cur)).toEqual([`Master switch ${cur.masterBattery ? 'ON' : 'OFF'}`, ...announced(prev, cur, ['masterBattery', 'alternator'])]);
  });

  it("draws the HUD's four bars and its RPM read-out", () => {
    expect(ui.hud.levers.map((l) => l.label)).toEqual(['THR', 'MIX', 'FLAPS', 'TRIM']);
    // THR and FLAPS are plain fills, MIX is filled in the mixture colour, TRIM is a mark on a centred bar (hud.ts, styles.ts).
    expect(ui.hud.levers.map((l) => l.style ?? 'fill')).toEqual(['fill', 'mixture', 'fill', 'marker']);
    expect(ui.hud.readouts.map((r) => r.label)).toEqual(['RPM']);
    const [thr, mix, flaps, trim] = ui.hud.levers;
    const s = makeMockState({ flaps: 19.6 * DEG, rpm: 2437 });
    const c = defaultControls();
    Object.assign(c, { throttle: 0.426, mixture: 0.85, flaps: 2 / 3, elevatorTrim: 0.12 });
    expect([thr.read(c, s), thr.text!(c, s)]).toEqual([0.426, '43%']);
    expect([mix.read(c, s), mix.text!(c, s)]).toEqual([0.85, '85%']);
    // The bar follows the lever, the number the surface.
    expect([flaps.read(c, s), flaps.text!(c, s)]).toEqual([2 / 3, '20°']);
    expect([trim.read(c, s), trim.text!(c, s)]).toEqual([0.5 + 0.12 * 0.5, '12% UP']);
    expect(ui.hud.readouts[0].text(s)).toBe('2440');
    s.engine.rpm = 0;
    expect(ui.hud.readouts[0].text(s)).toBe('0');
  });

  it('reads the trim as cues.ts does, over the whole travel', () => {
    const trim = ui.hud.levers[3];
    const s = makeMockState();
    const c = defaultControls();
    for (let i = -1000; i <= 1000; i++) {
      c.elevatorTrim = i / 1000;
      expect(trim.text!(c, s)).toBe(trimLabel(c.elevatorTrim));
      // The marker's place along the bar, 0 (full nose down) .. 1 (full nose up), as the HUD computes it.
      expect(trim.read(c, s)).toBe(0.5 + c.elevatorTrim * 0.5);
    }
    expect(trim.read(Object.assign(c, { elevatorTrim: -1 }), s)).toBe(0);
    expect(trim.read(Object.assign(c, { elevatorTrim: 1 }), s)).toBe(1);
  });
});

describe('by-reference imports', () => {
  // The definition files may import component modules only until the components read the definition
  // (contract 1.4 rule 7); every such import names the slot that inverts it.
  const componentImport = /from '\.\.\/\.\.\/(?!core\/)[^']+'/;

  it('are marked BYREF(C2) in sim.ts and BYREF(C3) in ui.ts', () => {
    for (const [file, source, mark] of [
      ['sim.ts', simSource, '// BYREF(C2)'],
      ['ui.ts', uiSource, '// BYREF(C3)'],
    ] as const) {
      const lines = source.split('\n').filter((l) => componentImport.test(l) && !l.startsWith('import type'));
      for (const l of lines) expect(l.endsWith(mark), `${file}: ${l}`).toBe(true);
    }
  });
});
