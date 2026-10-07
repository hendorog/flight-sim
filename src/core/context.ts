// Render-side contract: the context object handed to every visual/audio/UI subsystem each frame,
// and the conventions all three.js code in this project follows.
//
// RENDERING CONVENTIONS
//   - Scene units are metres. World coordinates are the NED->three mapping in frames.ts (y = altitude MSL).
//   - Depth (near 0.1 m, far 400 km): the simulator uses a reversed-Z float depth buffer where the browser has
//     EXT_clip_control, else three's logarithmic depth buffer (renderSetup.ts). Prefer built-in materials
//     (optionally patched with onBeforeCompile); a raw ShaderMaterial that writes depth must include three's
//     logdepthbuf_* shader chunks (no-ops under reversed-Z) so it agrees with everything else in both modes.
//     Never write gl_FragDepth unconditionally: it disables early-Z. Read scene depth only through DEPTH_GLSL.
//   - Lighting is HDR, linear, scene-referred. The scene renders to a float target with NoToneMapping; the
//     post-processing chain does aerial perspective, clouds, bloom, exposure and tone mapping. Materials must
//     not tone map or gamma encode themselves.
//   - The sky module owns the sun/moon directional light, ambient light, shadows and scene.environment.
//     Other modules only add local emissive/point lights (aircraft lights, runway lights) and set
//     castShadow / receiveShadow on their meshes. They read ctx.sky for anything sun-dependent.
//   - Distance haze is applied in post from the depth buffer, so materials must not use scene.fog.
//   - PHOTOMETRIC SCALE: light is in physical units scaled by SCENE_UNITS_PER_LUX. A surface luminance of L cd/m^2
//     is L * SCENE_UNITS_PER_LUX in the HDR buffer; an illuminance of E lux is a light colour*intensity of
//     E * SCENE_UNITS_PER_LUX. Noon sunlight is therefore ctx.sky.sunColor ~ 1e4, sky ambient ~ 500, a moonlit
//     scene ~ 0.02. Auto exposure in the post chain brings this to display range. Emissive sources (lamps,
//     displays, lit windows) must be specified in cd/m^2 (or candela for point sources) times this constant:
//     e.g. an LCD ~ 200-500 cd/m^2, an instrument backlight ~ 5-20 cd/m^2, a runway edge light ~ 1e4-1e5 cd/m^2
//     over its lens, a landing light ~ 1e5 candela.

import type * as THREE from 'three';
import type { AircraftDefinition, AircraftPresentation } from '../aircraft/types';
import type { AircraftId, AircraftState, ControlInputs, Environment, WeatherSettings } from './types';

export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 400_000;
/** Scene radiance units per cd/m^2 (and light intensity units per lux). See PHOTOMETRIC SCALE above. */
export const SCENE_UNITS_PER_LUX = 0.1;

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
export type CameraMode = 'cockpit' | 'chase' | 'orbit' | 'flyby' | 'tower';
export type ScenarioId = 'runway' | 'apron' | 'final' | 'cruise' | 'downwind';

/** Lighting state published by the sky module every frame. Vectors are in three.js world space. */
export interface SkyState {
  /** Unit vector toward the sun. */
  sunDir: THREE.Vector3;
  /** Unit vector toward the moon. */
  moonDir: THREE.Vector3;
  /** Linear RGB colour of direct sunlight reaching the ground (already attenuated by the atmosphere), times its intensity. */
  sunColor: THREE.Color;
  /** Linear RGB colour of direct moonlight reaching the ground, times its intensity (black when the moon is down). */
  moonColor: THREE.Color;
  /** Linear RGB sky-dome ambient (upper hemisphere average). */
  skyColor: THREE.Color;
  /** Linear RGB colour of the horizon haze the scene fades into with distance. */
  hazeColor: THREE.Color;
  /**
   * Haze the aerial-perspective pass applies, so other effects (clouds, lights) can fade identically:
   * extinction coefficient at sea level (1/m) falling off as exp(-altitudeMSL / hazeScaleHeight).
   */
  hazeExtinction: number;
  hazeScaleHeight: number;
  /** 1 in full daylight, 0 at night; smooth through twilight. */
  dayFactor: number;
}

/**
 * Actions any module (UI, input) may request; implemented by the main loop (src/sim/Simulator.ts).
 * Key ownership: the shell toggles pause on P (input keeps Pause/Break and gamepad Start), toggles the
 * autopilot on A and restarts the scenario on Shift+R; the UI owns Escape, F8 and F9.
 */
export interface SimCommands {
  reset(scenario: ScenarioId): void;
  setPaused(paused: boolean): void;
  setCameraMode(mode: CameraMode): void;
  setTimeScale(scale: number): void;
  setQuality(q: QualityLevel): void;
  /**
   * 3D render scale, 0.5..1 (times the device-pixel-ratio cap; the DOM UI keeps the native ratio).
   * Optional for older mocks; the simulator implements it.
   */
  setRenderScale?(scale: number): void;
  /**
   * Flight School: put the aircraft at a lesson start (curtain + physics.resetTo) and resolve when it is
   * flying again. `sc` is a src/sim/scenarios.ts `Scenario` built by src/sim/starts.ts buildStart(); typed
   * `unknown` here so the render-side contract does not depend on the sim layer. Optional: free flight and
   * older mocks do not implement it.
   */
  startFrom?(sc: unknown, opts: { lessonId: string; label: string }): Promise<void>;
  /**
   * Choose another aircraft: stores the preference ('fs.aircraft') and RELOADS the page without the URL
   * parameters that would undo the choice (aircraft, scenario, lesson, phase, brief, resume), plus `school=1`
   * when `opts.open` is 'school'. The type is selected at boot only. Optional: older mocks do not implement it.
   */
  setAircraft?(id: AircraftId, opts?: { open?: 'school' }): void;
  /** Carburettor-icing realism toggle: stores 'fs.carbIcing' ('0' = off; absent = on) and sets ctx.carbIcing. */
  setCarbIcing?(on: boolean): void;
}

export interface SimEvents {
  touchdown: { wheel: 'nose' | 'left' | 'right'; sinkRate: number };
  crash: { reason: string };
  /**
   * A new start. `scenario` is the base scenario id (a lesson start maps onto one, see
   * src/sim/starts.ts baseScenario); `lessonId` is set when the start belongs to a Flight School lesson.
   */
  reset: { scenario: ScenarioId; lessonId?: string };
  /**
   * Flight School lifecycle for audio ducking and UI: lesson start/end, control authority changes
   * (`detail` 'student' | 'instructor') and phase entries (`detail` = phase id).
   */
  lesson: { kind: 'start' | 'end' | 'authority' | 'phase'; lessonId: string; detail?: string };
  paused: { paused: boolean };
  cameraMode: { mode: CameraMode };
  weatherChanged: Record<string, never>;
  qualityChanged: { quality: QualityLevel };
  /** Gear events for sound and UI: a leg unlocked, reached down-and-locked, or reached up. Emitted by SimPhysics. */
  gear: { kind: 'unlock' | 'downLocked' | 'up'; leg: 0 | 1 | 2 };
}

export interface EventBus {
  on<K extends keyof SimEvents>(type: K, handler: (e: SimEvents[K]) => void): () => void;
  emit<K extends keyof SimEvents>(type: K, e: SimEvents[K]): void;
}

export interface SimContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Root object posed at the aircraft CG with the aircraft attitude each frame, before subsystems update. */
  aircraftRoot: THREE.Object3D;
  /**
   * Latest flight model output, as rendered: a copy of the physics state whose position/attitude are
   * interpolated between the last two fixed physics steps (src/sim/SimPhysics.ts). Same object every frame.
   */
  state: AircraftState;
  /** Mutable pilot inputs; the input module writes, everything else reads. */
  controls: ControlInputs;
  /** Mutable weather/time settings; UI writes (then emits weatherChanged), physics and sky read. */
  weather: WeatherSettings;
  env: Environment;
  sky: SkyState;
  /** Wall-clock-independent simulation time, s (the flight model's clock; restarts at 0 on a scenario reset). */
  simTime: number;
  paused: boolean;
  /** Requested time acceleration (1 = real time). */
  timeScale: number;
  /**
   * Time acceleration actually achieved over the last second (simulated / wall time; lower than timeScale
   * when the physics hits its per-frame CPU budget). Optional for older mocks; the simulator always sets it.
   */
  achievedTimeScale?: number;
  /** Current 3D render scale (0.5..1, times the capped pixel ratio), read-only; kept by the simulator. */
  renderScale?: number;
  cameraMode: CameraMode;
  quality: QualityLevel;
  commands: SimCommands;
  events: EventBus;
  /**
   * The type being flown. Same object for the whole session. For the shell and the UI: a subsystem receives its
   * per-type data by constructor option and does not read this in update() (test fakes omit it).
   */
  aircraft: AircraftDefinition;
  presentation: AircraftPresentation;
  /** Which engine(s) the engine keys act on; written by the input system every frame. Absent = 'all'. */
  engineSelection?: 'all' | 0 | 1;
  /** Carburettor icing enabled (default true). SimPhysics passes PropulsionInput.moisture only while it is not false. */
  carbIcing?: boolean;
}

/** A per-frame subsystem. update() runs once per rendered frame with the real frame dt (0 when paused). */
export interface Subsystem {
  init(ctx: SimContext): void | Promise<void>;
  update(dt: number, ctx: SimContext): void;
  dispose?(): void;
}

export function createEventBus(): EventBus {
  const handlers = new Map<string, Set<(e: never) => void>>();
  return {
    on(type, handler) {
      let set = handlers.get(type);
      if (!set) handlers.set(type, (set = new Set()));
      set.add(handler as (e: never) => void);
      return () => set.delete(handler as (e: never) => void);
    },
    emit(type, e) {
      handlers.get(type)?.forEach((h) => (h as (e: unknown) => void)(e));
    },
  };
}

/**
 * A full-screen HDR effect that the post-processing pipeline runs after the opaque scene render and
 * before bloom / exposure / tone mapping (e.g. aerial perspective, volumetric clouds). Effects run in
 * the order they were added; each reads the previous colour buffer and writes the next.
 */
export interface SceneEffect {
  readonly name: string;
  setSize(width: number, height: number): void;
  /**
   * @param input  HDR linear scene colour so far.
   * @param depth  Scene depth texture (reversed-Z or logarithmic; decode with DEPTH_GLSL from shaderLib.ts).
   * @param output Target to write the composited result to.
   */
  render(
    renderer: THREE.WebGLRenderer,
    input: THREE.Texture,
    depth: THREE.DepthTexture,
    output: THREE.WebGLRenderTarget,
    ctx: SimContext,
    dt: number,
  ): void;
  dispose?(): void;
}
