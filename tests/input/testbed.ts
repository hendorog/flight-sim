// Synthetic input profiles that switch on what the Cessna 172S profile has not (two engines, a propeller lever,
// ENGINE MASTER switches, a castering nosewheel, a carburettor), and a rig that runs the real InputSystem on a
// mock aircraft state, so the per-engine keys, the airborne guard and the brake steering are proven before any
// such aircraft exists. The profiles are the Cessna 172S one with single members changed; the numbers that
// matter are from the type sheets of the aircraft whose pattern they follow.

import { C172S_INPUT } from '../../src/aircraft/c172s/input';
import { createEventBus, type SimContext } from '../../src/core/context';
import { KT } from '../../src/core/math';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls, type AircraftState, type ControlInputs, type ControlPatch } from '../../src/core/types';
import { InputSystem } from '../../src/input/InputSystem';
import type { InputProfile } from '../../src/input/profile';

export const FRAME = 1 / 60;

/** Vmc of the PA-34-200 (red radial): 80 mph = 69 kt (TCDS, AFM). */
export const TWIN_VMCA = 69 * KT;

/**
 * A piston twin with constant-speed feathering propellers and toggle magnetos (the PA-34 pattern): per-engine
 * fuel selectors ON / CROSSFEED / OFF, cowl flaps, alternate air, retractable gear, rudder trim. The keyboard
 * rudder keeps full travel up to Vmca and loses it no faster than 1 / V above (InputProfile.assists).
 */
export const TWIN_INPUT: InputProfile = {
  ...C172S_INPUT,
  engines: 2,
  fuelSelectorCycle: ['on', 'crossfeed', 'off'],
  ignition: 'toggles',
  has: { mixture: true, propeller: true, feather: true, carbHeat: false, alternateAir: true, cowlFlaps: true, gear: true, rudderTrim: true, fuelPump: true },
  assists: {
    ...C172S_INPUT.assists,
    axes: { ...C172S_INPUT.assists.axes, rudder: { ...C172S_INPUT.assists.axes.rudder, fullAuthoritySpeed: TWIN_VMCA, authorityExponent: 1 } },
  },
};

/**
 * A FADEC diesel twin (the DA42 pattern): one power lever per engine and nothing else on the quadrant, ENGINE
 * MASTER switches for ignition, one alternate-air lever for both engines.
 */
export const FADEC_TWIN_INPUT: InputProfile = {
  ...TWIN_INPUT,
  ignition: 'engineMaster',
  has: { mixture: false, propeller: false, feather: false, carbHeat: false, alternateAir: true, cowlFlaps: false, gear: true, rudderTrim: true, fuelPump: true },
  commonControls: ['alternateAir'],
  labels: { throttleUp: 'Power lever forward', throttleDown: 'Power lever back', magnetoOff: 'Engine master OFF', magnetoBoth: 'Engine master ON' },
};

/**
 * A single with a castering nosewheel (the DA20 pattern: free castering, steered by differential toe braking,
 * the rudder as speed builds; AFM 7.5). The rudder takes over at 15 m/s (about 30 kt).
 */
export const CASTER_INPUT: InputProfile = {
  ...C172S_INPUT,
  fuelSelectorCycle: ['on', 'off'],
  has: { ...C172S_INPUT.has, alternateAir: true },
  assists: {
    ...C172S_INPUT.assists,
    steering: { ...C172S_INPUT.assists.steering, kind: 'differentialBrake', rudderEffectiveSpeed: 15, brakeGain: 1, pedalBrakeGain: 0.5 },
  },
};

/** A carburetted single without an electric fuel pump (the C152 pattern). */
export const CARB_INPUT: InputProfile = {
  ...C172S_INPUT,
  fuelSelectorCycle: ['on', 'off'],
  has: { ...C172S_INPUT.has, carbHeat: true, fuelPump: false },
};

export interface InputRig {
  input: InputSystem;
  ctx: SimContext;
  c: ControlInputs;
  s: AircraftState;
  /** Every message the input system showed the pilot, oldest first. */
  toasts: string[];
  /** Run the input system alone for a time (the mock state stays as the test set it). */
  run(seconds: number): void;
  /** Press a key for a time (default: one frame), then let go and run one more frame. */
  tap(code: string, shift?: boolean, seconds?: number): void;
  /** Put the aircraft on its wheels or in the air (the weight-on-wheels flags the guard reads). */
  setAirborne(airborne: boolean): void;
}

/**
 * The real InputSystem for `profile` on a mock state with the engine count of the profile, parked on the runway
 * (engines running). `controls`: applied over the default controls.
 */
export function makeInputRig(profile: InputProfile, controls: ControlPatch = {}): InputRig {
  const s = makeMockState({ heightAGL: 0, engines: profile.engines });
  const c = defaultControls({ engineCount: profile.engines, controlDefaults: controls });
  const events = createEventBus();
  const noop = (): void => {};
  const ctx = {
    state: s,
    controls: c,
    events,
    paused: false,
    timeScale: 1,
    cameraMode: 'cockpit',
    simTime: 0,
    commands: { reset: noop, setPaused: noop, setCameraMode: noop, setTimeScale: noop, setQuality: noop },
  } as unknown as SimContext;
  const toasts: string[] = [];
  const input = new InputSystem({ profile, shell: { toast: (t) => void toasts.push(t) } });
  input.attach(ctx);
  const run = (seconds: number): void => {
    for (let i = 0, n = Math.round(seconds / FRAME); i < n; i++) input.update(FRAME, ctx);
  };
  return {
    input,
    ctx,
    c,
    s,
    toasts,
    run,
    tap(code, shift = false, seconds = FRAME) {
      input.keyDown(code, shift);
      run(seconds);
      input.keyUp(code);
      run(FRAME);
    },
    setAirborne(airborne) {
      for (const w of s.wheels) w.onGround = !airborne;
      s.onGround = !airborne;
    },
  };
}
