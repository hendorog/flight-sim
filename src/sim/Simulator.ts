// The application shell: boots every module in dependency order, owns the SimContext and SimCommands,
// runs the frame loop and exposes the automation hooks (window.__sim, window.__ready).
//
// FRAME ORDER (one requestAnimationFrame):
//   input -> physics (fixed steps + interpolation) -> pose ctx.aircraftRoot -> aircraft visual -> cameras
//   -> sky/lighting (needs the final camera) -> terrain, airport -> instrument panel, UI, audio
//   -> PostPipeline.render (scene, aerial perspective, clouds, bloom, exposure, tone map)
// Subsystems receive the simulated time that actually elapsed this frame (0 while paused; less than wall
// time x time scale when the physics hits its CPU budget, see SimPhysics); UI, cameras and exposure use wall
// time internally where they must keep working while paused. The local time of day advances with it.
//
// FLIGHT SCHOOL (docs/instructor-spec.md; src/training/TrainingSystem.ts): created after the UI; its update runs
// after panel.update with the frame's simulated dt (indicated signals need fresh instrument readings). During a
// lesson it owns Enter, Shift+Enter, R, [, Tab and Shift+R (section 5.9), caps the time scale, gates the A key,
// and adds the lesson to the resume snapshot (schema 2). With no lesson active nothing here changes free flight.
//
// THE AIRCRAFT is chosen once, at boot (aircraftChoice.ts: URL, stored preference, else the Cessna 172S); every
// subsystem receives the type's definition or presentation through its constructor. Another type is a reload
// (commands.setAircraft). Each type keeps its own resume snapshot (resume.ts snapshotKey).
//
// STALLS are hidden, never flown through: a scenario reset and a graphics-quality change fade to a curtain,
// hold the simulation, do the synchronous work (trim, shader compiles, terrain rebuild), render a warm-up
// frame for the interior and exterior views so every shader variant is linked, and fade back in.

import * as THREE from 'three';
import {
  createEventBus,
  SCENE_UNITS_PER_LUX,
  type CameraMode,
  type QualityLevel,
  type ScenarioId,
  type SimCommands,
  type SimContext,
  type Subsystem,
} from '../core/context';
import { applyPose } from '../core/frames';
import { createCamera, createRenderer, depthModeOf } from '../core/renderSetup';
import { defaultWeather, type WeatherSettings } from '../core/types';
import { AIRPORT } from '../core/world';
import { DEFAULT_AIRCRAFT_ID, loadAircraft, loadPresentation } from '../aircraft/registry';
import type { AircraftDefinition, AircraftPresentation } from '../aircraft/types';
import type { AircraftId } from '../core/types';
import { AudioSystem } from '../audio';
import { InputSystem, TRAINING_KEYS, keyBindingsFor } from '../input';
import { InstrumentPanel } from '../instruments';
import { prebuildPropellers } from '../physics/propulsion';
import { AircraftVisual } from '../render/aircraft/AircraftVisual';
import { CameraSystem } from '../render/cameras';
import { CloudsEffect } from '../render/clouds';
import { PostPipeline } from '../render/post';
import { SkySystem } from '../render/sky';
import { SIM_RATES, UISystem, type KeyBinding } from '../ui';
import { AirportSystem, TOWER } from '../world/airport';
import { TerrainSystem, terrainHeight } from '../world/terrain';
import { aircraftSwitchUrl, chooseAircraft, loadCarbIcing, saveAircraftPreference, saveCarbIcing } from './aircraftChoice';
import { SceneMaterialPatches } from './cloudShadows';
import { advanceTimeOfDay } from './clock';
import { showContextLost, showCurtain, type Curtain } from './overlays';
import { parseParams, type SimParams } from './params';
import {
  browserStore,
  clearSnapshot,
  type FlightSnapshot,
  decideBoot,
  formatAge,
  loadResumePreference,
  loadSnapshot,
  RESUME_ARM_SECONDS,
  SAVE_INTERVAL_S,
  saveResumePreference,
  saveSnapshot,
  type BootDecision,
} from './resume';
import type { Scenario } from './scenarios';
import { SimPhysics } from './SimPhysics';
import { TrainingSystem } from '../training/TrainingSystem';
import { validateTrainingBlock } from '../training/career/validate';

/**
 * Device-pixel-ratio cap per quality level. The 3D view renders at CSS-pixel resolution on every quality
 * (a HiDPI buffer is 2.25-4x the pixels, 27-73 ms of GPU at 2560x1440@2 on a desktop GPU); the DOM UI
 * stays sharp at the native ratio. dpr= raises the cap, scale= lowers the render scale.
 */
const DPR_CAP: Record<QualityLevel, number> = { low: 1, medium: 1, high: 1, ultra: 1 };
/** Render scale when neither scale= nor the menu slider set one. */
const DEFAULT_RENDER_SCALE: Record<QualityLevel, number> = { low: 0.75, medium: 1, high: 1, ultra: 1 };
/** CPU time per frame the physics may use before time acceleration gives way, ms. */
const PHYSICS_BUDGET_MS = 8;
/**
 * Longest a curtain waits for the terrain and forest around the camera to be complete before lifting anyway,
 * ms. A quality change rebuilds every tile from the root level (681 tiles on high, 3-5 s on a loaded
 * desktop); a scenario reset mostly finds its tiles resident.
 */
const CURTAIN_MAX_MS = 12_000;
/** Frames the terrain must stay converged (nothing missing, nothing building) before a curtain lifts. */
const CURTAIN_SETTLED_FRAMES = 4;
/** Frames the tree-impostor count must stay unchanged before a curtain lifts. */
const CURTAIN_TREES_STABLE_FRAMES = 20;
/** Frames rendered before the time-acceleration limit can be reported (loading, first streaming). */
const TIME_SCALE_WARMUP_FRAMES = 120;
/** Time-scale range the commands accept. */
const TIME_SCALE_MIN = 0.125;
const TIME_SCALE_MAX = 16;
/** Wall-clock budget per frame for run= fast-forwarding, ms. */
const FAST_FORWARD_BUDGET_MS = 45;
/** Give up waiting for terrain streaming before __ready after this long, ms. */
const READY_TIMEOUT_MS = 45_000;
/** LOD distance within which every terrain tile must be built before __ready, m. */
const NEAR_TERRAIN = 4000;

/** Keys the shell itself handles (listed in the UI's Controls tab together with the input bindings). */
const SHELL_BINDINGS: KeyBinding[] = [
  { keys: 'P', action: 'Pause / resume', category: 'Simulation' },
  { keys: 'A', action: 'Autopilot on / off (flies the heading bug, holds altitude; power is yours)', category: 'Simulation' },
  { keys: 'T / Shift+T', action: 'Autopilot altitude up / down 100 ft', category: 'Simulation' },
  { keys: 'Shift+R', action: 'Restart the scenario', category: 'Simulation' },
  { keys: 'Shift+[ / Shift+]', action: 'Simulation rate slower / faster (0.5x to 16x)', category: 'Simulation' },
  { keys: 'H', action: 'Cabin dome light on / off', category: 'Lights' },
  { keys: 'Escape', action: 'Menu', category: 'Simulation' },
  { keys: 'F9', action: 'HUD on / off', category: 'View' },
  { keys: 'F8', action: 'Frame-time readout', category: 'View' },
];

export interface SimSystems {
  sky: SkySystem;
  terrain: TerrainSystem;
  airport: AirportSystem;
  aircraft: AircraftVisual;
  cameras: CameraSystem;
  input: InputSystem;
  audio: AudioSystem;
  ui: UISystem;
  panel: InstrumentPanel;
  clouds: CloudsEffect;
}

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

export class Simulator {
  readonly params: SimParams;
  readonly weather: WeatherSettings;
  ctx!: SimContext;
  physics!: SimPhysics;
  post!: PostPipeline;
  /** Scene-wide material patches (cloud shadows on the sun term, floodlight pools); see cloudShadows.ts. */
  cloudShadows!: SceneMaterialPatches;
  systems!: SimSystems;
  /** Frames rendered since boot. */
  frames = 0;
  /** First error thrown by each subsystem update (the loop keeps running). */
  readonly errors: string[] = [];
  ready = false;

  private readonly failed = new Set<string>();
  private lastFrame = -1;
  private fastForwardLeft = 0;
  private hiddenPaused = false;
  private readyPhase: 'boot' | 'fastForward' | 'streaming' | 'settling' | 'ready' = 'boot';
  private readyStart = 0;
  private settleFrames = 0;
  private contextLost = false;
  private fixedCamera: { pos: THREE.Vector3; look: THREE.Vector3 | null } | null = null;
  private rafId = 0;
  private lastDpr = 1;
  /** Simulation held (dt = 0) behind a curtain, without a pause event. */
  private holding = false;
  /** Simulation held while a Flight School screen (home, briefing, debrief...) is open. */
  private schoolHold = false;
  /** The Flight School (null until boot has created it). */
  training: TrainingSystem | null = null;
  private curtainBusy = false;
  private pendingQuality: QualityLevel | null = null;
  /** Scenario reset requested while a curtain was up: run when it lifts (latest request wins). */
  private pendingReset: ScenarioId | null = null;
  /** Wall and simulated time accumulated for the achieved time scale. */
  private scaleWall = 0;
  private scaleSim = 0;
  private limitedFor = 0;
  private limitToastShown = false;
  /** Completed 1 s windows of the achieved-time-scale measurement. */
  private scaleWindows = 0;
  // Resume on reload (resume.ts).
  private readonly store = browserStore();
  /** The menu preference "Resume where I left off on reload". */
  private resumeEnabled = loadResumePreference(this.store);
  /** What boot did: resumed a snapshot, started a remembered scenario, or started normally. */
  bootDecision: BootDecision | null = null;
  /** Simulated time (physics.time) from which snapshots carry resume: true again after a restart. */
  private resumeArmAt = 0;
  /** Some simulation has run since boot (nothing is saved while loading or paused before the first frame). */
  private flown = false;
  private saveClock = 0;
  /** Snapshots written since boot (for the automation API). */
  savesWritten = 0;
  /** True once the aircraft's livery / cabin-occlusion bake is in place (part of __ready). */
  private liveryBaked: () => boolean = () => false;
  /** The type flown: chosen at boot (aircraftChoice.ts), the same for the whole session. */
  aircraftId: AircraftId = DEFAULT_AIRCRAFT_ID;

  constructor(search: string = location.search) {
    this.params = parseParams(search);
    this.weather = defaultWeather();
    const w = this.params.weather;
    if (w.cloudBaseM !== undefined) w.cloudTopM ??= w.cloudBaseM + (this.weather.cloudTopM - this.weather.cloudBaseM);
    Object.assign(this.weather, w);
  }

  // ------------------------------------------------------------------------------------------- boot

  async boot(): Promise<void> {
    const p = this.params;
    // The type flown, before anything aircraft-specific is built: its definition (the C172S's is in the bundle;
    // another type's is one small chunk) and, under the loading screen, its presentation.
    const { def, presentation } = await this.loadAircraft();
    const id = def.id;
    this.aircraftId = id;
    let lateInput: InputSystem | null = null;
    // The UI first: its loading screen covers the page while everything else loads. It is built before the input
    // system, so the cockpit clicks reach InputSystem.hold through a late-bound closure.
    const ui = new UISystem({
      title: def.name,
      bindings: [...keyBindingsFor(def.input), ...SHELL_BINDINGS, ...TRAINING_KEYS],
      hold: (action, down, engine) => lateInput?.hold(action, down, engine),
    });
    const progress = async (f: number, label: string): Promise<void> => {
      ui.setLoadingProgress(f, label);
      await nextFrame();
    };
    await progress(0.02, 'Starting the renderer');

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;display:block;touch-action:none;outline:none';
    canvas.tabIndex = -1;
    document.body.style.cssText = 'margin:0;overflow:hidden;background:#000';
    document.body.prepend(canvas);
    const renderer = createRenderer(canvas, { antialias: false, depth: p.depth });
    if (!renderer.capabilities.isWebGL2) throw new Error('WebGL 2 is not available');
    // Shader error checking queries the info logs, which blocks on every compile; keep it for development.
    renderer.debug.checkShaderErrors = !import.meta.env.PROD;
    const scene = new THREE.Scene();
    const camera = createCamera(window.innerWidth / Math.max(1, window.innerHeight), p.fov ?? 60);
    const aircraftRoot = new THREE.Object3D();
    aircraftRoot.name = 'aircraftRoot';
    scene.add(aircraftRoot);
    canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);

    await progress(0.06, 'Building the flight model');
    const events = createEventBus();
    // Resume the last flight (a reload), or start the URL's (or the remembered) scenario.
    const decision = decideBoot(loadSnapshot(this.store, id), { param: p.resume, explicitScenario: p.explicitScenario, enabled: this.resumeEnabled, now: Date.now(), aircraft: id });
    const weatherBefore = { ...this.weather };
    if (decision.kind === 'resume') Object.assign(this.weather, decision.snapshot.weather);
    const physics = new SimPhysics({ weather: this.weather, events, aircraft: def });
    const carbIcing = loadCarbIcing(this.store);
    physics.carbIcing = carbIcing;
    // Every propeller map now, not on first use inside the frame loop (a constant-speed propeller has many).
    prebuildPropellers(def.powerplant);
    physics.autoflightOnReset = p.autoflight;
    this.physics = physics;
    this.bootDecision = decision;
    let resumed: Extract<BootDecision, { kind: 'resume' }> | null = null;
    if (decision.kind === 'resume') {
      try {
        physics.restore(decision.snapshot);
        resumed = decision;
      } catch (e) {
        console.warn('[sim] could not resume the last flight; starting the scenario', e);
        Object.assign(this.weather, weatherBefore);
        this.bootDecision = { kind: 'normal', reason: 'restore failed' };
      }
    }
    if (!resumed) physics.reset(decision.kind === 'scenario' ? decision.scenario : p.scenario, this.weather);
    if (resumed) {
      const snap = resumed.snapshot;
      if (p.renderScale === null) p.renderScale = snap.renderScale;
    }

    const commands: SimCommands = {
      // From the UI and keys: behind a curtain (the automation API resets directly).
      reset: (id) => this.resetBehindCurtain(id),
      setPaused: (paused) => this.setPaused(paused),
      setCameraMode: (mode) => this.setCameraMode(mode),
      setTimeScale: (s) => {
        // A lesson caps time acceleration (1x, 4x on navigation legs; section 3.10).
        const cap = this.training?.timeScaleCap ?? Number.POSITIVE_INFINITY;
        if (s > cap) {
          if (s > this.ctx.timeScale || this.ctx.timeScale > cap) this.systems?.ui.showToast(`Lesson: time acceleration limited to ${cap}x`);
          s = cap;
        }
        this.ctx.timeScale = Math.min(TIME_SCALE_MAX, Math.max(TIME_SCALE_MIN, s));
      },
      startFrom: (sc, opts) => this.startFrom(sc as Scenario, opts),
      setQuality: (q) => this.setQuality(q),
      setRenderScale: (scale) => {
        this.params.renderScale = Math.min(1, Math.max(0.5, Number.isFinite(scale) ? scale : 1));
        this.applySize();
      },
      setAircraft: (next, opts) => this.setAircraft(next, opts),
      setCarbIcing: (on) => {
        saveCarbIcing(this.store, on);
        this.ctx.carbIcing = on;
        this.physics.carbIcing = on;
      },
    };
    const ctx: SimContext = {
      renderer,
      scene,
      camera,
      aircraftRoot,
      state: physics.renderState,
      controls: physics.controls,
      weather: this.weather,
      env: physics.env,
      sky: {
        sunDir: new THREE.Vector3(0, 1, 0),
        moonDir: new THREE.Vector3(0, -1, 0),
        sunColor: new THREE.Color(0, 0, 0),
        moonColor: new THREE.Color(0, 0, 0),
        skyColor: new THREE.Color(0, 0, 0),
        hazeColor: new THREE.Color(0, 0, 0),
        hazeExtinction: 3.912 / this.weather.visibilityM,
        hazeScaleHeight: 1200,
        dayFactor: 1,
      },
      simTime: physics.time,
      paused: false,
      timeScale: 1,
      achievedTimeScale: 1,
      cameraMode: resumed && !p.camPos ? resumed.snapshot.cameraMode : p.cam,
      quality: resumed ? resumed.snapshot.quality : p.quality,
      commands,
      events,
      aircraft: def,
      presentation,
      carbIcing,
    };
    this.ctx = ctx;
    this.applySize();
    window.addEventListener('resize', () => this.applySize());
    this.lastDpr = window.devicePixelRatio || 1;
    document.addEventListener('visibilitychange', this.onVisibility);
    // The last moment to save the flight before a reload or close.
    window.addEventListener('pagehide', () => this.persist());
    window.addEventListener('beforeunload', () => this.persist());
    applyPose(aircraftRoot, ctx.state.position, ctx.state.orientation);
    aircraftRoot.updateMatrixWorld(true);

    // Sky first (lights, shadows, environment map), then the camera at the scenario start so the
    // terrain preload streams the right area.
    await progress(0.14, 'Sky and atmosphere');
    const sky = new SkySystem();
    sky.init(ctx);
    // The tower camera stands at eye height in the glass cab (the roof overhang just shows at the top).
    const tower = { x: TOWER.north, y: TOWER.east, z: -(AIRPORT.elevation + TOWER.eyeHeight) };
    const cameras = new CameraSystem({ towerPositionNED: tower });
    cameras.init(ctx);
    // The type's eye point, size and default cockpit view; the temporal pass gets the same radius (below).
    cameras.setAircraft({
      pilotEye: def.geometry.fuselage.pilotEye,
      radius: def.geometry.bounds.radius,
      fitSize: def.geometry.bounds.fitSize,
      defaultPitchDeg: presentation.visual.cockpit.defaultPitchDeg,
    });
    // A camera cut (cockpit <-> exterior, a reset) must not blend the old view into the new one.
    cameras.onCut = () => this.post?.resetTemporalHistory();
    if (p.camPos) this.setFixedCamera(p.camPos, p.camLook);
    this.updateCamera(0, cameras);
    sky.update(0, ctx);

    await progress(0.22, 'Aircraft');
    const aircraft = new AircraftVisual({ airframe: presentation.visual, panelDef: presentation.panel });
    aircraft.init(ctx);
    const panel = new InstrumentPanel({
      def: presentation.panel,
      systems: presentation.instrumentSystems,
      pxRect: presentation.visual.cockpit.panel.pxRect,
      gyrosSpunUp: ctx.state.engines.some((e) => e.running),
    });
    panel.reset(ctx.state);
    aircraft.setPanelTexture(panel.texture);
    // Exact night-lighting mask: only markings, pointers, displays and lamps glow.
    aircraft.setPanelEmissiveTexture(panel.emissiveTexture);
    let liveryBaked = false;
    void aircraft.textureBake.finally(() => (liveryBaked = true));
    this.liveryBaked = () => liveryBaked;

    await progress(0.34, 'Airport and valley');
    const airport = new AirportSystem({ heightAt: terrainHeight });
    airport.init(ctx);

    await progress(0.42, 'Terrain (streaming tiles around the start position)');
    const terrain = new TerrainSystem();
    const terrainDone = terrain.init(ctx);
    // Report streaming progress while the preload runs.
    let terrainFinished = false;
    void terrainDone.finally(() => (terrainFinished = true));
    while (!terrainFinished) {
      const s = terrain.stats;
      const f = s.resident / Math.max(1, s.resident + s.inflight);
      ui.setLoadingProgress(0.42 + 0.4 * f, `Terrain: ${s.resident} tiles, ${s.inflight} building`);
      await new Promise((r) => setTimeout(r, 100));
    }
    await terrainDone;

    await progress(0.84, 'Controls, instruments and sound');
    const input = new InputSystem({ view: cameras, profile: def.input });
    lateInput = input;
    input.init(ctx);
    // While the mouse is the yoke, a left drag must not also swing the view.
    cameras.suppressLeftDrag = () => input.isMouseYoke();
    if (!p.assists) {
      input.assists.groundSteering = false;
      input.assists.rollTrim = false;
    }
    const audio = new AudioSystem({ profile: presentation.audio });
    audio.init(ctx);
    audio.onError = (reason) => ui.showToast(reason, 12000);
    ui.fpsExtra = () => audio.status();
    if (p.mute) audio.setMuted(true);
    ui.init(ctx);
    ui.scenario = physics.scenario.id;
    ui.resumeOnReload = {
      get: () => this.resumeEnabled,
      set: (on) => {
        this.resumeEnabled = on;
        saveResumePreference(this.store, on);
        if (on) this.persist();
        else clearSnapshot(this.store, id);
      },
    };
    ui.hudEnabled = p.hud;
    if (!p.ui) ui.root.style.display = 'none';
    if (p.freeze) ui.pausedBadgeEnabled = false;
    ui.setGamepads(input.gamepads);
    // The Flight School after the UI (its screens mount on the UI's school layer) and before the loading
    // screen lifts (a training profile keeps the first-flight hints away).
    const training = new TrainingSystem({
      physics,
      weather: this.weather,
      params: p.school,
      ui,
      readings: () => panel.instruments.readings,
      pilotFlying: () => input.pilotFlying(),
      inputFlags: () => {
        const src = input.getYokeIndicator().source;
        return { kbdAssists: input.assists.groundSteering || input.assists.rollTrim, inputDevice: src };
      },
      aircraftId: () => id,
      startFrom: (sc, o) => this.startFrom(sc, o),
      restoreFlight: (snap, o) => this.restoreFlightBehindCurtain(snap, o),
      captureFlight: () => this.captureFlight(true),
      setHold: (on) => {
        this.schoolHold = on;
        this.lastFrame = -1;
      },
      setCameraMode: (mode) => this.setCameraMode(mode),
      audio,
      persist: () => this.persist(),
    });
    training.init(ctx);
    this.training = training;
    // Input <-> UI links: mode-change toasts (mouse yoke on / off) and the control-position widget for
    // every input source, including the mouse yoke. A controller's Start button keeps the input module's
    // default (a synthetic Escape press, which the UI handles exactly as the key: menu or crash dialog).
    input.setShell({ toast: (t) => ui.showToast(t) });
    ui.setYokeIndicator(() => input.getYokeIndicator());
    ui.assists = input.assists;
    ui.autopilot = {
      engaged: () => physics.autoflight.engaged,
      // KAP 140 style annunciation while holding: 'HDG 070 ALT 4500'; the scripted phases otherwise.
      mode: () => {
        const af = physics.autoflight;
        if (af.phase !== 'hold' || af.plan?.kind !== 'hold' || !af.plan.followBug) return String(af.phase);
        const bug = String(Math.round((((ctx.controls.headingBugDeg % 360) + 360) % 360)) || 360).padStart(3, '0');
        const alt = af.targetAltitude;
        return Number.isNaN(alt) ? `HDG ${bug}` : `HDG ${bug} ALT ${Math.round(alt / 0.3048 / 10) * 10}`;
      },
      toggle: () => this.toggleAutoflight(),
    };

    await progress(0.9, 'Post-processing and clouds');
    const post = new PostPipeline(renderer, scene, camera);
    const clouds = new CloudsEffect(renderer);
    post.addEffect(clouds);
    this.post = post;
    post.setAircraftRadius(def.geometry.bounds.radius);
    await clouds.ready;
    // Cloud shadows dim the sun term of every lit material instead of the whole pixel in the composite;
    // the apron floodlight pools also reach the aircraft exterior and the terrain grass (cloudShadows.ts).
    this.cloudShadows = new SceneMaterialPatches(clouds.shadowUniforms, airport.shared, aircraftRoot);
    clouds.compositeShadows = false;
    this.cloudShadows.scan(scene);

    this.systems = { sky, terrain, airport, aircraft, cameras, input, audio, ui, panel, clouds };
    this.wireEvents();
    window.addEventListener('keydown', this.onKey);
    // While a curtain is up nothing may be operated underneath it (the menu stays clickable otherwise).
    window.addEventListener('keydown', this.onKeyWhileCurtain, true);

    await progress(0.95, 'Compiling shaders');
    this.warmUpShaders();

    this.installAutomation();
    await progress(1, 'Ready');
    ui.hideLoading();
    const lessonResumed = !!resumed && resumed.snapshot.training !== undefined && validateTrainingBlock(resumed.snapshot.training) !== null;
    if (resumed && !lessonResumed) ui.showToast(`Resumed flight from ${formatAge(resumed.ageMs)} ago · Shift+R / menu: Restart scenario`, 7000);
    training.afterBoot({ resumed: resumed?.snapshot ?? null, explicitScenario: p.explicitScenario });
    this.fastForwardLeft = p.run;
    if (p.freeze && p.run === 0) this.setPaused(true);
    this.readyPhase = p.run > 0 ? 'fastForward' : 'streaming';
    this.readyStart = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  /**
   * The definition and presentation of the type this session flies (aircraftChoice.ts). A type whose chunks fail
   * to load (offline, a broken deployment) gives way to the Cessna 172S, which is part of the application.
   */
  private async loadAircraft(): Promise<{ def: AircraftDefinition; presentation: AircraftPresentation }> {
    const choice = chooseAircraft(this.params, this.store);
    try {
      const [def, presentation] = await Promise.all([loadAircraft(choice.id), loadPresentation(choice.id)]);
      return { def, presentation };
    } catch (e) {
      if (choice.id === DEFAULT_AIRCRAFT_ID) throw e;
      console.warn(`[sim] could not load the ${choice.id}; flying the ${DEFAULT_AIRCRAFT_ID}`, e);
      const [def, presentation] = await Promise.all([loadAircraft(DEFAULT_AIRCRAFT_ID), loadPresentation(DEFAULT_AIRCRAFT_ID)]);
      return { def, presentation };
    }
  }

  /**
   * Another aircraft (SimCommands.setAircraft; the UI has asked for confirmation): the flight is saved under
   * this type's key, the choice stored, and the page reloaded without the parameters that would undo it.
   */
  setAircraft(id: AircraftId, opts: { open?: 'school' } = {}): void {
    this.persist();
    saveAircraftPreference(this.store, id);
    location.replace(aircraftSwitchUrl(location.href, opts));
  }

  /**
   * Compile and link every shader variant the views need, so no camera switch stalls later. For the cockpit
   * and an exterior view (the aircraft shows different parts in each): renderer.compile() over the whole
   * scene (all visible objects, not just those in the frustum) with an HDR render target bound, as the post
   * pipeline renders it (the program key depends on the output colour space), then one real frame through
   * the post chain for the shadow-depth and full-screen programs (the exterior one without frustum culling,
   * so every caster reaches the shadow cascades). Finally every program is linked now
   * (three otherwise finishes the link at first use, in the middle of a frame).
   */
  private warmUpShaders(): void {
    const { ctx, systems: s } = this;
    const { renderer, camera: cam } = ctx;
    const t0 = performance.now();
    const saved = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov, mode: ctx.cameraMode };
    const probeTarget = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
    const prevTarget = renderer.getRenderTarget();
    const aircraftPos = new THREE.Vector3().setFromMatrixPosition(ctx.aircraftRoot.matrixWorld);
    try {
      for (const mode of ['cockpit', 'chase'] as const) {
        ctx.cameraMode = mode;
        s.aircraft.update(0, ctx);
        if (mode !== 'cockpit') {
          // 25 m behind and 6 m above the aircraft (three: x east, y up, z south), looking at it.
          const back = new THREE.Vector3(0, 0, 1).applyQuaternion(ctx.aircraftRoot.quaternion);
          back.y = 0;
          if (back.lengthSq() < 1e-6) back.set(0, 0, 1);
          cam.position.copy(aircraftPos).addScaledVector(back.normalize(), 25);
          cam.position.y += 6;
          cam.lookAt(aircraftPos);
        }
        cam.updateMatrixWorld();
        renderer.setRenderTarget(probeTarget);
        renderer.compile(ctx.scene, cam);
        renderer.setRenderTarget(prevTarget);
        // The shadow pass creates its depth-material variants only for objects inside a cascade: for the
        // exterior frame, draw everything once without frustum culling so none is left for later.
        const unculled: THREE.Object3D[] = [];
        if (mode !== 'cockpit') {
          ctx.scene.traverse((o) => {
            if (o.frustumCulled && (o as THREE.Mesh).isMesh) {
              o.frustumCulled = false;
              unculled.push(o);
            }
          });
        }
        try {
          this.post.render(ctx, 0);
        } finally {
          for (const o of unculled) o.frustumCulled = true;
        }
      }
    } catch (e) {
      console.warn('[sim] shader warm-up failed', e);
    } finally {
      renderer.setRenderTarget(prevTarget);
      probeTarget.dispose();
      ctx.cameraMode = saved.mode;
      s.aircraft.update(0, ctx);
      cam.position.copy(saved.pos);
      cam.quaternion.copy(saved.quat);
      cam.fov = saved.fov;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
    }
    // Finish every link now (blocks until the driver is done; behind the loading screen or a curtain).
    for (const program of renderer.info.programs ?? []) {
      try {
        (program as unknown as { getUniforms?: () => unknown }).getUniforms?.();
      } catch {
        /* a failed program reports itself when used */
      }
    }
    this.post.snapExposure();
    this.warmUpMs = performance.now() - t0;
  }

  /** Time the last shader warm-up took, ms (reported through __sim for profiling). */
  warmUpMs = 0;

  private wireEvents(): void {
    const { ctx, systems } = this;
    ctx.events.on('reset', () => {
      systems.panel.reset(ctx.state);
      this.post.snapExposure();
    });
    // The pilot "sets the altimeter from the ATIS" when the weather changes.
    ctx.events.on('weatherChanged', () => {
      ctx.controls.kollsmanHpa = ctx.weather.qnhHpa;
    });
  }

  // --------------------------------------------------------------------------------------- commands

  resetScenario(id: ScenarioId): void {
    this.physics.reset(id, this.weather);
    this.ctx.simTime = this.physics.time;
    // A deliberate restart: a reload now starts this scenario again instead of resuming the old flight,
    // until the new flight has run for a few seconds.
    this.resumeArmAt = this.physics.time + RESUME_ARM_SECONDS;
    this.persist(true);
    this.ctx.events.emit('reset', { scenario: id });
  }

  /** Snapshots are written (resume=0 and the menu preference turn them off; resume=1 forces them on). */
  private get saving(): boolean {
    return this.params.resume === true || (this.params.resume === null && this.resumeEnabled);
  }

  /**
   * Save the flight for a reload (every SAVE_INTERVAL_S while flying, and on pagehide / beforeunload / tab
   * hidden). Not while loading, before the first simulated frame, or behind a curtain (mid-reset, mid quality
   * change) unless `force` (the restart itself, which records the new scenario with resume: false).
   */
  persist(force = false): boolean {
    if (!this.saving || !this.physics || !this.ctx || this.contextLost) return false;
    if (!force && (!this.flown || !this.systems || this.holding || this.curtainBusy)) return false;
    let ok = false;
    try {
      const snap = this.captureFlight(this.physics.time >= this.resumeArmAt);
      // Schema 2: a lesson in flight rides along, so a reload resumes it at the start of the current step.
      const block = this.training?.resumeBlock() ?? null;
      if (block) snap.training = block;
      ok = saveSnapshot(this.store, snap, this.aircraftId);
    } catch (e) {
      console.warn('[sim] could not save the flight for resume', e);
    }
    if (ok) this.savesWritten++;
    return ok;
  }

  /** The flight as a resume snapshot (also a lesson checkpoint's flight part). */
  captureFlight(resume: boolean): FlightSnapshot {
    return this.physics.captureSnapshot({
      weather: this.weather,
      cameraMode: this.ctx.cameraMode,
      quality: this.ctx.quality,
      renderScale: this.params.renderScale,
      resume,
    });
  }

  /**
   * A Flight School start (SimCommands.startFrom): behind the curtain, physics.resetTo(sc), the 'reset' event
   * with the lesson id. Resolves once the curtain has lifted (or at once before boot finished). Unlike a
   * scenario restart it leaves resume armed: a reload mid-lesson resumes the lesson.
   */
  async startFrom(sc: Scenario, opts: { lessonId: string; label: string }): Promise<void> {
    const work = (): void => {
      this.physics.resetTo(sc, this.weather);
      this.ctx.simTime = this.physics.time;
      this.ctx.events.emit('reset', { scenario: sc.id, lessonId: opts.lessonId });
    };
    await this.curtained(opts.label, work);
  }

  /** A lesson checkpoint restore ("try again from the start of this phase"), behind the curtain. */
  private async restoreFlightBehindCurtain(snap: FlightSnapshot, opts: { lessonId: string; label: string }): Promise<void> {
    await this.curtained(opts.label, () => {
      Object.assign(this.weather, snap.weather);
      this.physics.restore(snap);
      this.ctx.simTime = this.physics.time;
      this.ctx.events.emit('reset', { scenario: snap.scenario, lessonId: opts.lessonId });
      this.ctx.events.emit('weatherChanged', {});
    });
  }

  /** Run `work` behind a curtain once any curtain already up has lifted (directly before boot is complete). */
  private async curtained(text: string, work: () => void): Promise<void> {
    if (!this.systems) {
      work();
      return;
    }
    while (this.curtainBusy) await nextFrame();
    await this.behindCurtain(text, work);
  }

  /**
   * Reset for the pilot (menu, Shift+R): fade out, reset (the trim solve takes 0.1-0.4 s), hold the
   * simulation while the terrain around the new position streams in, then fade back in.
   */
  resetBehindCurtain(id: ScenarioId): void {
    if (this.curtainBusy) {
      // Queued, like a quality change: it runs as soon as the current curtain lifts.
      this.pendingReset = id;
      return;
    }
    if (!this.systems) {
      this.resetScenario(id);
      return;
    }
    void this.behindCurtain('Loading scenario', () => this.resetScenario(id));
  }

  /** Run `work` hidden behind a curtain with the simulation held; lift it once the view is ready. */
  private async behindCurtain(text: string, work: () => void, warmUp = false): Promise<void> {
    this.curtainBusy = true;
    const automated = !this.params.ui;
    let curtain: Curtain | null = null;
    if (this.reuseCurtain) {
      curtain = this.reuseCurtain;
      curtain.setText(text);
    } else if (!automated) curtain = showCurtain(text);
    this.reuseCurtain = null;
    this.curtain = curtain;
    this.holding = true;
    try {
      if (curtain) await curtain.shown;
      work();
      // Let the subsystems apply the change for a couple of frames (terrain rebuild, quality polls).
      await nextFrame();
      await nextFrame();
      if (warmUp) this.warmUpShaders();
      await this.waitForScenery(CURTAIN_MAX_MS);
      this.post.snapExposure();
    } catch (e) {
      console.warn('[sim] curtain work failed', e);
    } finally {
      this.holding = false;
      this.lastFrame = -1;
      this.curtainBusy = false;
      this.curtain = null;
    }
    // Requests made while it was up: the reset first, then the quality (each behind its own curtain; the
    // current one stays up in between, so the view does not flash).
    const r = this.pendingReset;
    const q = this.pendingQuality;
    this.pendingReset = null;
    this.pendingQuality = null;
    const more = r !== null || (q !== null && q !== this.ctx.quality);
    if (more && curtain) {
      // Hand the open curtain to the next job instead of fading it out and in again.
      this.reuseCurtain = curtain;
    } else curtain?.close();
    if (r !== null) this.resetBehindCurtain(r);
    if (q && q !== this.ctx.quality) this.setQuality(q);
  }

  /** The curtain on screen (null when none or automated). */
  private curtain: Curtain | null = null;
  /** An already opaque curtain the next behindCurtain() takes over. */
  private reuseCurtain: Curtain | null = null;

  /**
   * Hold (behind a curtain) until the scenery the camera sees is complete: every terrain tile the view
   * selects at its target LOD built and in place for a few frames, and the forest impostor lists rebuilt
   * (their count stops changing). A quality change starts again from the root tiles, so a test on the
   * nearest missing tile alone passes at once with only root tiles in (the 'near-empty terrain' curtain lift).
   */
  private async waitForScenery(maxMs: number): Promise<void> {
    const t0 = performance.now();
    const terrain = this.systems.terrain;
    let settled = 0;
    let lastTrees = -1;
    let treesStable = 0;
    while (performance.now() - t0 < maxMs) {
      await nextFrame();
      const st = terrain.stats;
      settled = st.inflight === 0 && st.nearestMissing === Infinity ? settled + 1 : 0;
      treesStable = st.impostors === lastTrees ? treesStable + 1 : 0;
      lastTrees = st.impostors;
      if (settled >= CURTAIN_SETTLED_FRAMES && treesStable >= CURTAIN_TREES_STABLE_FRAMES) return;
    }
    const st = terrain.stats;
    console.warn(`[sim] curtain lifted after ${maxMs} ms with ${st.inflight} terrain tiles building (nearest missing ${Math.round(st.nearestMissing)} m)`);
  }

  private readonly onKeyWhileCurtain = (e: KeyboardEvent): void => {
    if (!this.curtainBusy || !this.curtain) return;
    // Key-downs only: releases must still reach the input module, or a held key would stick.
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  setPaused(paused: boolean): void {
    if (this.ctx.paused === paused) return;
    this.ctx.paused = paused;
    this.ctx.events.emit('paused', { paused });
  }

  setCameraMode(mode: CameraMode): void {
    this.fixedCamera = null;
    if (this.ctx.cameraMode === mode) return;
    this.ctx.cameraMode = mode;
    this.ctx.events.emit('cameraMode', { mode });
  }

  /**
   * Change the graphics quality behind a curtain with the simulation held: the change recompiles ~50
   * programs and rebuilds the terrain (0.5-1.6 s of blocked frames), which must not happen mid-flight
   * with the aircraft still flying.
   */
  setQuality(q: QualityLevel): void {
    if (this.ctx.quality === q) return;
    if (this.curtainBusy) {
      this.pendingQuality = q;
      return;
    }
    if (!this.systems) {
      this.applyQuality(q);
      return;
    }
    void this.behindCurtain('Applying graphics settings', () => this.applyQuality(q), true);
  }

  private applyQuality(q: QualityLevel): void {
    this.ctx.quality = q;
    this.applySize();
    this.ctx.events.emit('qualityChanged', { quality: q });
  }

  /** Fix the camera at an NED position (alt MSL) looking at another point (null: keep the direction). */
  setFixedCamera(pos: [number, number, number], look: [number, number, number] | null): void {
    this.fixedCamera = {
      pos: new THREE.Vector3(pos[1], pos[2], -pos[0]),
      look: look ? new THREE.Vector3(look[1], look[2], -look[0]) : null,
    };
  }

  private applySize(): void {
    const { renderer, camera, quality } = this.ctx;
    const cap = this.params.dprCap ?? DPR_CAP[quality];
    const scale = this.params.renderScale ?? DEFAULT_RENDER_SCALE[quality];
    this.ctx.renderScale = scale;
    const ratio = Math.min(window.devicePixelRatio || 1, cap) * scale;
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    camera.updateProjectionMatrix();
  }

  /**
   * Re-apply the size when the device pixel ratio changes without a resize event (window dragged to a
   * monitor with another scale, OS or browser zoom). Polled once per frame (a property read): resolution
   * media-query change events do not fire for every kind of change. A synthetic resize lets DOM overlays
   * re-derive their own ratio.
   */
  private checkPixelRatio(): void {
    const dpr = window.devicePixelRatio || 1;
    if (dpr === this.lastDpr) return;
    this.lastDpr = dpr;
    this.applySize();
    window.dispatchEvent(new Event('resize'));
  }

  private readonly onVisibility = (): void => {
    if (document.hidden) {
      this.persist();
      if (!this.ctx.paused) {
        this.hiddenPaused = true;
        this.setPaused(true);
      }
    } else if (this.hiddenPaused) {
      this.hiddenPaused = false;
      this.setPaused(false);
      this.lastFrame = -1;
    }
  };

  private readonly onContextLost = (e: Event): void => {
    e.preventDefault();
    if (this.contextLost) return;
    this.contextLost = true;
    // Stop the loop altogether (nothing can render; read-backs would only report errors). The audio module
    // silences itself on the same event.
    cancelAnimationFrame(this.rafId);
    if (this.ctx) this.setPaused(true);
    showContextLost();
  };

  /**
   * The GPU is back, but every texture, render target and baked resource (LUTs, livery, terrain maps) is
   * gone: reload the page with the same parameters rather than run half-restored.
   */
  private readonly onContextRestored = (): void => {
    console.warn('[sim] WebGL context restored: reloading');
    // The reload resumes the flight (the snapshot from the moment the context was lost stands).
    location.reload();
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement)) return;
    // A lesson owns Enter, Shift+Enter, R, [, Tab and Shift+R while it runs (section 5.9).
    if (this.training?.handleKey(e)) {
      e.preventDefault();
      return;
    }
    if (e.code === 'KeyP' && !e.shiftKey) {
      this.setPaused(!this.ctx.paused);
    } else if (e.code === 'KeyA' && !e.shiftKey) {
      this.toggleAutoflight();
    } else if (e.code === 'KeyR' && e.shiftKey) {
      this.resetBehindCurtain(this.physics.scenario.id);
    } else if (e.code === 'KeyT') {
      const af = this.physics.autoflight;
      const target = af.adjustAltitude((e.shiftKey ? -100 : 100) * 0.3048);
      this.systems.ui.showToast(Number.isNaN(target) ? 'Autopilot altitude: engage the autopilot (A) first' : `Autopilot altitude ${Math.round(target / 0.3048)} ft`);
    } else if ((e.code === 'BracketLeft' || e.code === 'BracketRight') && e.shiftKey) {
      const rates = SIM_RATES;
      const now = this.ctx.timeScale;
      let i = rates.findIndex((r) => r >= now - 1e-6);
      if (i < 0) i = rates.length - 1;
      if (e.code === 'BracketRight') i = rates[i] > now + 1e-6 ? i : Math.min(rates.length - 1, i + 1);
      else i = Math.max(0, i - 1);
      this.ctx.commands.setTimeScale(rates[i]);
      this.systems.ui.showToast(`Simulation rate ${rates[i]}x`);
    } else if (e.code === 'KeyH' && !e.shiftKey) {
      const l = this.ctx.controls.lights;
      l.dome = !l.dome;
      this.systems.ui.showToast(l.dome ? 'Dome light on' : 'Dome light off');
    } else return;
    e.preventDefault();
  };

  /** The heading bug sits on the DG card: tell the autoflight how far the card is from true heading. */
  private updateDgOffset(): void {
    const dg = this.systems.panel.instruments.readings.headingDeg;
    if (!Number.isFinite(dg)) return;
    const d = (dg * Math.PI) / 180 - this.physics.state.heading;
    this.physics.autoflight.dgOffset = Math.atan2(Math.sin(d), Math.cos(d));
  }

  /** The A key and the UI's autopilot button: hold what the aircraft is doing now, or let go. */
  toggleAutoflight(): void {
    const on = !this.physics.autoflight.engaged;
    if (on && this.training && !this.training.autopilotAllowed) {
      this.systems.ui.showToast('Not in this exercise');
      return;
    }
    this.updateDgOffset();
    this.physics.setAutoflight(on);
    const phase = this.physics.autoflight.phase;
    // On the ground there is nothing to hold ('parked'): say so instead of pretending to fly.
    if (on && phase === 'parked') {
      this.physics.setAutoflight(false);
      this.systems.ui.showToast('Autopilot: available once airborne');
      return;
    }
    const alt = this.physics.autoflight.targetAltitude;
    this.systems.ui.showToast(on ? (Number.isNaN(alt) ? 'Autopilot engaged' : `Autopilot engaged: HDG bug, ALT ${Math.round(alt / 0.3048)} ft`) : 'Autopilot disengaged');
  }

  // ------------------------------------------------------------------------------------ frame loop

  private readonly frame = (now: number): void => {
    if (this.contextLost) return;
    this.rafId = requestAnimationFrame(this.frame);
    const wallDt = this.lastFrame < 0 ? 0 : Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const { ctx, systems: s, physics } = this;
    this.checkPixelRatio();

    // Simulated time requested this frame (0 while paused or held behind a curtain).
    const held = ctx.paused || this.holding || this.schoolHold;
    const dt = held ? 0 : wallDt * ctx.timeScale;
    let subsystemDt = dt;
    this.run('input', s.input, dt);
    this.updateDgOffset();
    // Overpowering the autopilot disconnects it (the autoflight would otherwise overwrite the yoke every step).
    // Not during run= fast-forwarding, and not while paused (look-around keys are not flight controls).
    if (physics.autoflight.engaged && !ctx.paused && this.fastForwardLeft <= 0 && s.input.pilotFlying()) {
      physics.setAutoflight(false);
      s.ui.showToast('Autopilot disconnected');
    }
    if (this.fastForwardLeft > 0 && !ctx.paused) {
      // run=: as many fixed steps as fit in the budget, rendering in between so terrain keeps streaming.
      const t0 = performance.now();
      let simulated = 0;
      while (this.fastForwardLeft > 0 && performance.now() - t0 < FAST_FORWARD_BUDGET_MS) {
        const chunk = Math.min(this.fastForwardLeft, 0.25);
        physics.step(chunk);
        this.fastForwardLeft -= chunk;
        simulated += chunk;
      }
      subsystemDt = Math.min(simulated, 0.1);
      this.advanceClock(simulated);
      if (this.fastForwardLeft <= 0) this.fastForwardDone();
    } else {
      physics.advance(dt, ctx.timeScale, PHYSICS_BUDGET_MS);
      // What actually elapsed (less than dt when the budget cut time acceleration short).
      subsystemDt = physics.lastAdvance;
      this.advanceClock(subsystemDt);
      this.trackTimeScale(held ? 0 : wallDt, subsystemDt, physics.budgetLimited);
    }
    ctx.simTime = physics.time;
    if (physics.lastAdvance > 0) this.flown = true;
    this.saveClock += wallDt;
    if (this.saveClock >= SAVE_INTERVAL_S) {
      this.saveClock = 0;
      this.persist();
    }

    applyPose(ctx.aircraftRoot, ctx.state.position, ctx.state.orientation);
    ctx.aircraftRoot.updateMatrixWorld(true);
    this.run('aircraft', s.aircraft, subsystemDt);
    this.updateCamera(subsystemDt);
    this.run('sky', s.sky, subsystemDt);
    this.run('terrain', s.terrain, subsystemDt);
    this.run('airport', s.airport, subsystemDt);
    try {
      s.panel.update(subsystemDt, ctx);
    } catch (e) {
      this.fail('panel', e);
    }
    // The Flight School: telemetry, runner, coach, safety, speech, UI models (needs the fresh panel readings).
    if (this.training) this.run('training', this.training, subsystemDt);
    this.run('ui', s.ui, subsystemDt);
    this.run('audio', s.audio, subsystemDt);
    try {
      this.cloudShadows.update(ctx.scene);
      // A floodlit apron: the eye adapts to the lamps, not to the moonlit landscape (0 by day / aloft).
      this.post.artificialIlluminance = s.airport.artificialIlluminance(ctx.camera.position) * SCENE_UNITS_PER_LUX;
      this.post.render(ctx, subsystemDt);
    } catch (e) {
      this.fail('post', e);
    }
    this.frames++;
    this.updateReadiness(now);
  };

  /** Local time of day runs with the simulation (and its time scale); past midnight the date advances. */
  private advanceClock(simSeconds: number): void {
    if (this.params.clock) advanceTimeOfDay(this.weather, simSeconds);
  }

  /** Achieved time scale over ~1 s windows; tells the pilot once when the CPU limits time acceleration. */
  private trackTimeScale(wallDt: number, simDt: number, limited: boolean): void {
    const ctx = this.ctx;
    if (!(wallDt > 0)) return;
    this.scaleWall += wallDt;
    this.scaleSim += simDt;
    if (this.scaleWall >= 1) {
      ctx.achievedTimeScale = +(this.scaleSim / this.scaleWall).toFixed(2);
      this.scaleWall = this.scaleSim = 0;
      this.scaleWindows++;
    }
    // Only a real shortfall of a requested acceleration counts: not at 1x or slower (the budget can cut a
    // slow frame's catch-up during loading), not before the first measured window, not while loading.
    const measured = this.scaleWindows > 0;
    const accelerating = ctx.timeScale > 1 && this.ready && this.frames > TIME_SCALE_WARMUP_FRAMES;
    const achieved = ctx.achievedTimeScale ?? ctx.timeScale;
    const short = measured && achieved < 0.8 * ctx.timeScale;
    this.limitedFor = limited && accelerating ? this.limitedFor + wallDt : 0;
    if (this.limitedFor > 2 && short && !this.limitToastShown) {
      this.limitToastShown = true;
      this.systems.ui.showToast(`Time acceleration limited to about ${Math.max(1, Math.round(achieved))}x by the CPU`);
    }
    if (ctx.timeScale <= 1) this.limitToastShown = false;
  }

  private updateCamera(dt: number, cameras: CameraSystem = this.systems.cameras): void {
    const { ctx } = this;
    const fixed = this.fixedCamera;
    if (fixed) {
      ctx.camera.position.copy(fixed.pos);
      if (fixed.look) ctx.camera.lookAt(fixed.look);
      if (this.params.fov && ctx.camera.fov !== this.params.fov) {
        ctx.camera.fov = this.params.fov;
        ctx.camera.updateProjectionMatrix();
      }
      ctx.camera.updateMatrixWorld();
      return;
    }
    this.run('cameras', cameras, dt);
  }

  private run(name: string, sys: Subsystem, dt: number): void {
    try {
      sys.update(dt, this.ctx);
    } catch (e) {
      this.fail(name, e);
    }
  }

  private fail(name: string, e: unknown): void {
    if (this.failed.has(name)) return;
    this.failed.add(name);
    const msg = `${name}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`;
    this.errors.push(msg);
    console.error(`[sim] ${name} update failed (further errors from it are suppressed)`, e);
  }

  private fastForwardDone(): void {
    this.fastForwardLeft = 0;
    if (this.params.freeze) this.setPaused(true);
    this.post.snapExposure();
    if (this.readyPhase === 'fastForward') {
      this.readyPhase = 'streaming';
      this.readyStart = performance.now();
    }
  }

  /**
   * Terrain near the camera is in: nothing is being built, or (while the aircraft moves and new tiles are
   * requested all the time) nothing the view needs within NEAR_TERRAIN m is missing.
   */
  private terrainStreamed(): boolean {
    const st = this.systems.terrain.stats;
    return st.inflight === 0 || st.nearestMissing > NEAR_TERRAIN;
  }

  /** __ready: loaded, run= done, terrain near the camera streamed in, exposure settled, a few frames drawn. */
  private updateReadiness(now: number): void {
    switch (this.readyPhase) {
      case 'streaming': {
        if (this.terrainStreamed() || now - this.readyStart > READY_TIMEOUT_MS) {
          const st = this.systems.terrain.stats;
          if (!this.terrainStreamed()) console.warn(`[sim] __ready after ${READY_TIMEOUT_MS} ms with ${st.inflight} terrain tiles still building`);
          this.post.snapExposure();
          this.readyPhase = 'settling';
          this.settleFrames = 0;
        }
        break;
      }
      case 'settling':
        // A second snap once the sky's asynchronous read-backs and the new tiles are in the picture.
        if (++this.settleFrames === 6) this.post.snapExposure();
        if (this.settleFrames >= 12 && this.terrainStreamed() && this.liveryBaked()) {
          this.readyPhase = 'ready';
          this.ready = true;
          (window as unknown as { __ready: boolean }).__ready = true;
        } else if (this.settleFrames >= 12 && now - this.readyStart > READY_TIMEOUT_MS) {
          this.readyPhase = 'ready';
          this.ready = true;
          (window as unknown as { __ready: boolean }).__ready = true;
        }
        break;
    }
  }

  // ------------------------------------------------------------------------------------ automation

  private installAutomation(): void {
    const sim = this;
    const api = {
      sim,
      get ctx() {
        return sim.ctx;
      },
      get physics() {
        return sim.physics;
      },
      get flightModel() {
        return sim.physics.fm;
      },
      get autoflight() {
        return sim.physics.autoflight;
      },
      get autopilot() {
        return sim.physics.autoflight.autopilot;
      },
      get post() {
        return sim.post;
      },
      get cloudShadows() {
        return sim.cloudShadows;
      },
      get systems() {
        return sim.systems;
      },
      get errors() {
        return sim.errors;
      },
      /** 'reversed' (reversed-Z float depth) or 'log' (logarithmic depth, gl_FragDepth). */
      get depthMode() {
        return depthModeOf(sim.ctx.renderer);
      },
      /** Duration of the last shader warm-up (boot or quality change), ms. */
      get warmUpMs() {
        return sim.warmUpMs;
      },
      /** Advance the simulation `seconds` right now (exact fixed steps, the clock too); returns summary(). */
      step(seconds: number) {
        sim.physics.step(seconds);
        sim.advanceClock(sim.physics.lastAdvance);
        sim.ctx.simTime = sim.physics.time;
        return api.summary();
      },
      reset(id: ScenarioId) {
        // A scenario reset ends a lesson in progress ('abandoned', logged), as the menu's buttons do.
        sim.training?.end();
        sim.resetScenario(id);
        return api.summary();
      },
      /** The Flight School (section 5.10). */
      training: {
        start: (id: string, opts: { phase?: string; brief?: boolean; standard?: 'easa' | 'faa' } = {}) => sim.training?.start(id, opts),
        state: () => sim.training?.state() ?? null,
        input: (kind: Parameters<TrainingSystem['input']>[0]) => sim.training?.input(kind),
        skipStep: () => sim.training?.input('skipStep'),
        end: () => sim.training?.end(),
        result: () => sim.training?.runner?.result() ?? null,
        transcript: () => [...(sim.training?.speech.transcript ?? [])],
        profile: () => sim.training?.profile() ?? null,
        export: (includeTraces = true) => sim.training?.exportFile(includeTraces, false) ?? null,
        import: (json: string, mode: 'replace' | 'merge' = 'replace') => sim.training?.importJson(json, mode) ?? 'no Flight School',
        command: (cmd: Parameters<TrainingSystem['command']>[0]) => sim.training?.command(cmd),
        get runner() {
          return sim.training?.runner ?? null;
        },
        get store() {
          return sim.training?.store ?? null;
        },
        get system() {
          return sim.training;
        },
      },
      setAutoflight(on: boolean, useScenarioPlan = true) {
        sim.physics.setAutoflight(on, useScenarioPlan);
        return sim.physics.autoflight.phase;
      },
      pause(paused = true) {
        sim.setPaused(paused);
      },
      setCamera(mode: CameraMode) {
        sim.setCameraMode(mode);
      },
      setFixedCamera(pos: [number, number, number], look: [number, number, number] | null = null) {
        sim.setFixedCamera(pos, look);
      },
      setWeather(w: Partial<WeatherSettings>) {
        Object.assign(sim.weather, w);
        sim.ctx.events.emit('weatherChanged', {});
      },
      /** Resume on reload: what boot did, and save / read / clear the stored snapshot. */
      resume: {
        get decision() {
          const d = sim.bootDecision;
          return d && (d.kind === 'resume' ? { kind: d.kind, ageMs: d.ageMs, scenario: d.snapshot.scenario } : d);
        },
        get savesWritten() {
          return sim.savesWritten;
        },
        save: () => sim.persist(),
        stored: () => loadSnapshot(sim.store, sim.aircraftId),
        clear: () => clearSnapshot(sim.store, sim.aircraftId),
      },
      /** JSON-friendly snapshot of the aircraft (SI units plus knots/feet for convenience). */
      summary() {
        const s = sim.physics.state;
        const g = s.gear;
        return {
          aircraft: sim.physics.definition.id,
          scenario: sim.physics.scenario.id,
          time: +s.time.toFixed(3),
          north: +s.position.x.toFixed(2),
          east: +s.position.y.toFixed(2),
          altitudeMSL: +s.altitudeMSL.toFixed(2),
          altitudeAGL: +s.altitudeAGL.toFixed(2),
          altitudeFt: Math.round(s.altitudeMSL / 0.3048),
          headingDeg: +((s.heading * 180) / Math.PI).toFixed(1),
          pitchDeg: +((s.pitch * 180) / Math.PI).toFixed(2),
          rollDeg: +((s.roll * 180) / Math.PI).toFixed(2),
          kias: +(s.ias / 0.514444).toFixed(1),
          groundSpeed: +s.groundSpeed.toFixed(2),
          verticalSpeedFpm: Math.round(s.verticalSpeed / 0.00508),
          rpm: Math.round(s.engine.rpm),
          engines: s.engines.map((e) => ({ rpm: Math.round(e.rpm), propRpm: Math.round(e.propRpm), running: e.running })),
          gear: { lever: g.lever, extension: g.extension.map((x) => +x.toFixed(3)), locked: [...g.locked], inTransit: g.inTransit },
          engineSelection: sim.ctx.engineSelection ?? 'all',
          onGround: s.onGround,
          crashed: s.crashed,
          crashReason: s.crashReason,
          autoflight: sim.physics.autoflight.phase,
          paused: sim.ctx.paused,
          timeOfDay: +sim.weather.timeOfDay.toFixed(4),
          timeScale: sim.ctx.timeScale,
          achievedTimeScale: sim.ctx.achievedTimeScale,
          frames: sim.frames,
        };
      },
    };
    (window as unknown as { __sim: typeof api }).__sim = api;
  }
}
