// Pilot input: keyboard virtual yoke, mouse yoke and game controllers -> ctx.controls.
//
// The keyboard yoke and rudder hold position (FSX/MSFS style): a held arrow or rudder key moves the control at
// a rate that starts fine and accelerates, releasing it leaves the control where it is, and Numpad 5 / 5
// centres aileron, elevator and rudder. See virtualYoke.ts for the rates and the assists.
//
// Keyboard events only record which actions are held or were pressed; all control changes happen in
// update() so the flight model sees one consistent set of inputs per frame. Continuous controls are
// integrated with the frame dt (0 while paused, so nothing drifts during a pause); discrete actions such
// as pause and camera changes still work while paused.
//
// One key map serves every aircraft type; the type's InputProfile says which levers and switches exist (the
// keys of the others do nothing). On a twin the engine keys (throttle, propeller, mixture, magnetos or engine
// master, starter, fuel pump, fuel selector, carburettor heat, cowl flaps, feather) act on the engine(s)
// selected with 8 / 9 / 0; engineControls.ts has the rules for the levers of two engines. In the air the keys
// that can shut an engine down want ONE engine selected (guard()).

import { clamp } from '../core/math';
import type { CameraMode, SimContext, Subsystem } from '../core/context';
import { PROP_FEATHER_GATE, clearEngineControl, engineControl, setEngineControl } from '../core/types';
import type { AircraftState, ControlInputs, EngineControlKey, FuelSelector, MagnetoPosition } from '../core/types';
import { C172S_INPUT } from '../aircraft/c172s/input';
import { INPUT_ACTIONS, actionForKey, keyLabelForAction, profileHasAction, type InputAction } from './bindings';
import type { AxisControl } from './devices';
import { TakeoverDetector } from './axisFilter';
import {
  MIXTURE_GUARD,
  moveSplitLevers,
  readEngineControl,
  rejoinLevers,
  scalarShared,
  stepLever,
  stepThird,
  writeEngineControl,
  type EngineLever,
  type EngineTarget,
} from './engineControls';
import { GamepadManager } from './gamepads';
import { Activity, LeverOwner, mixCentring, mouseYokeDeflection, mouseYokeNearCentre } from './mixer';
import { MouseYokeOverlay } from './mouseYokeOverlay';
import type { InputProfile } from './profile';
import {
  GroundSteeringAssist,
  PILOT_DIFFERENTIAL_BRAKE,
  RollTrimAssist,
  RotationGuard,
  differentialBrake,
  groundElevatorTuning,
  leverRate,
  nextFlapDetent,
  stepBrake,
  stepCentre,
  stepKeyAxis,
  wrapDegrees,
  type KeyAxisTuning,
} from './virtualYoke';

/** View actions the input system forwards to the camera (CameraSystem implements this). */
export interface ViewControl {
  recentre(): void;
  /** Positive = zoom in. One step is one key press or wheel notch. */
  zoom(steps: number): void;
  togglePointerLock(): void;
  /** Turn the view by a mouse-drag-equivalent amount, pixels (+x = right, +y = down). Optional. */
  lookBy?(dx: number, dy: number): void;
}

export interface InputSystemOptions {
  /** Receives recentre / zoom / mouse-look actions from keys and controller buttons. */
  view?: ViewControl;
  /** Where keyboard events are listened for. Default: window. */
  keyTarget?: Window | HTMLElement;
  /** Hooks into the application shell (UI). All optional; see InputShell. */
  shell?: InputShell;
  /**
   * The type flown: its levers and switches, flap detents, fuel selector cycle and the tuning of the keyboard
   * assists. Default: the Cessna 172S.
   */
  profile?: InputProfile;
}

/** Application-shell services the input system uses when available (the UI implements them). */
export interface InputShell {
  /**
   * A controller's Start / pause button: toggle the pause menu the way the Escape key does (open it and
   * pause; or close it and resume; or dismiss the crash dialog). Without this hook the input system sends
   * the page a synthetic Escape key press, which the UI handles exactly that way.
   */
  menuButton?(): void;
  /** Show a short message to the pilot (e.g. "Mouse yoke on"). Without it only the on-screen overlay speaks. */
  toast?(text: string): void;
}

/** Pilot-assist options for keyboard / mouse flying. */
export interface InputAssists {
  /**
   * Auto-rudder on the ground while the keyboard rudder is centred (not touched since the scenario started or
   * since Numpad 5 / 5): holds the heading, like the pilot's feet on the pedals. The first rudder key press
   * takes the pedals over from it without a bump (its rudder becomes the held keyboard rudder); centring
   * hands them back. Ignored while hardware pedals or a twist stick own the rudder. Default true. When false
   * (and the rudder is centred with no rudder axis in use) the feet are off the pedals on the ground: the
   * rudder floats and the nosewheel follows it (ControlInputs.feetOffRudder), as in the real aircraft.
   */
  groundSteering: boolean;
  /**
   * Roll trim while the keyboard ailerons are centred (hands off the yoke): holds the small steady aileron
   * the aircraft needs (propeller torque in the climb) with the wings within 6 degrees of level. The first
   * roll key press takes it over without a bump; centring hands it back. Ignored while hardware or the mouse
   * yoke owns the ailerons. Default true.
   */
  rollTrim: boolean;
}

/** What the UI needs to draw a small yoke-position indicator. Values are the commanded controls. */
export interface YokeIndicator {
  /** Mouse-yoke mode is on (the UI should show the indicator and a centre mark). */
  mouseYoke: boolean;
  /** [-1, 1], + = right. */
  aileron: number;
  /** [-1, 1], + = yoke back (draw it below centre). */
  elevator: number;
  rudder: number;
  /** Which input currently drives pitch and roll. */
  source: 'keyboard' | 'mouse' | 'hardware';
  /**
   * The hold-position keyboard yoke or rudder is set away from centre (the UI keeps the control-position
   * widget up while it is, so the pilot can see where the keys left the controls).
   */
  keyboardOffCentre: boolean;
  /** Keyboard elevator relative to its centre (+ = held back); for the UI's trim suggestion. */
  keyboardElevator: number;
  /**
   * Mouse yoke switched on but not yet in control: it takes over when the pointer passes through the
   * centre mark (so switching it on never slams the yoke to wherever the pointer happened to be).
   */
  mouseArmed?: boolean;
}

const CAMERA_CYCLE: readonly CameraMode[] = ['cockpit', 'chase', 'orbit', 'flyby', 'tower'];

/** Held-key lever rates, fraction of travel per second at full rate. Trim: full travel in ~8 s like the wheel. */
const THROTTLE_RATE = 0.5;
const MIXTURE_RATE = 0.35;
const PROPELLER_RATE = 0.35;
const TRIM_RATE = 0.25;
/** Knob rates at full speed (after a second of holding), per second; a tap turns one detent. */
const BUG_RATE = 60; // degrees
const KOLLSMAN_RATE = 12; // hPa
const BUG_TAP = 1;
const KOLLSMAN_TAP = 1;
/** Holding a knob key starts turning continuously after this long, s. */
const KNOB_REPEAT_DELAY = 0.35;
/** Keyboard look-around speed, mouse-drag pixels per second (about 80 degrees/s in the cockpit). */
const LOOK_RATE = 400;
/** Keyboard deflection shown as "off centre" by the control-position widget. */
const OFF_CENTRE = 0.005;
/**
 * Ground speed above which Numpad 5 hands the held rudder to the auto-rudder instead of centring it, m/s
 * (InputProfile.assists.handoverSpeed; this is the Cessna 172S figure, like the two g stops below).
 */
export const HANDOVER_SPEED = C172S_INPUT.assists.handoverSpeed;
/**
 * Soft load-factor stops for the keyboard elevator only: a held yoke must not overstress the aircraft or
 * throw it into negative g. Beyond these the held keyboard deflection is eased back (a pilot feels the stick
 * force and the seat of the pants), and it stays where it was eased to; hardware and the mouse yoke are
 * never limited.
 */
export const KEY_G_PULL = C172S_INPUT.assists.gStops.pull;
export const KEY_G_PUSH = C172S_INPUT.assists.gStops.push;
/** How fast the soft g stops ease the held keyboard elevator, travel per second per g beyond the stop. */
const G_STOP_RATE = 0.6;
/** Throttle rate from a self-centring stick at full deflection, 1/s. */
const THROTTLE_STICK_RATE = 0.6;
/** Immediate change on the first press of a lever key, so single taps are useful. */
const LEVER_TAP = 0.02;

const LEVER_ACTIONS: readonly InputAction[] = [
  'throttleUp',
  'throttleDown',
  'mixtureLean',
  'mixtureRich',
  'trimNoseUp',
  'trimNoseDown',
  'propIncrease',
  'propDecrease',
  'rudderTrimLeft',
  'rudderTrimRight',
  'headingBugRight',
  'headingBugLeft',
  'kollsmanUp',
  'kollsmanDown',
  'obsUp',
  'obsDown',
  'pitchUp',
  'pitchDown',
  'rollLeft',
  'rollRight',
  'rudderLeft',
  'rudderRight',
];

/** The positions the Cessna 172S fuel selector key cycles through. */
export const FUEL_SELECTOR_CYCLE: readonly FuelSelector[] = C172S_INPUT.fuelSelectorCycle;
const PANEL_LIGHT_STEPS = [0, 0.3, 0.6, 1];

function isTextEntry(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
}

export class InputSystem implements Subsystem {
  /** Connected controllers; exposed for a calibration / binding screen. */
  readonly gamepads = new GamepadManager();
  /** Keyboard-flying assists; may be changed at any time (e.g. from a settings screen). */
  readonly assists: InputAssists = { groundSteering: true, rollTrim: true };

  private readonly view: ViewControl | undefined;
  private readonly keyTarget: Window | HTMLElement | undefined;
  private readonly profile: InputProfile;
  /** The elevator key tuning of the type on the mains. */
  private readonly groundElevator: KeyAxisTuning;
  /** Actions the type has no lever or switch for: their keys do nothing. */
  private readonly absent = new Set<InputAction>();
  private readonly twin: boolean;
  /** Per-engine controls that are ONE control on this type (written for all engines whatever is selected). */
  private readonly common: readonly EngineControlKey[];
  /** Which engine(s) the engine keys act on. */
  private selection: 'all' | 0 | 1 = 'all';
  private ctx!: SimContext;
  private element: HTMLElement | null = null;

  /** Keys currently down: code -> action chosen at key-down time (Shift may be released first). */
  private readonly keysDown = new Map<string, InputAction>();
  private readonly held = new Set<InputAction>();
  private readonly pressedQueue: InputAction[] = [];
  /** The engine each queued press is for (a click on one engine's switch); undefined = the selected engine(s). */
  private readonly pressedEngine: (number | undefined)[] = [];
  /** Momentary controls held by a click (hold()): action -> its engine, or undefined = the selected engine(s). */
  private readonly clicked = new Map<InputAction, number | undefined>();
  /** Time each lever action has been held, s. */
  private readonly heldTime = new Map<InputAction, number>();

  /** Hold-position keyboard deflections, relative to `neutral`. */
  private kbAileron = 0;
  private kbElevator = 0;
  private kbRudder = 0;
  /**
   * Centre of the keyboard controls: the flight model's trimmed aileron, elevator and rudder at the last
   * scenario reset, so centring returns to trimmed flight rather than to an untrimmed zero (the trimmed
   * aileron/rudder are tiny but the spiral mode is slow to forgive them).
   */
  private readonly neutral = { aileron: 0, elevator: 0, rudder: 0 };
  /**
   * The keyboard aileron / rudder is centred and untouched (since the reset or the last recentre): the roll
   * trim and the ground auto-rudder act only then. The first key press hands the axis to the pilot.
   */
  private ailCentred = true;
  private rudCentred = true;
  /** Numpad 5 / 5 was pressed: the keyboard controls are gliding back to centre. */
  private centring = { aileron: false, elevator: false, rudder: false };
  /**
   * What this system wrote to ctx.controls last frame per axis while the keyboard was the only source (null
   * otherwise). If the value differs at the next frame the autopilot wrote it: the keyboard yoke then follows
   * it (the pilot's hand resting on the moving yoke), so the widget is right and a disconnect is bumpless.
   */
  private readonly written: Record<'aileron' | 'elevator' | 'rudder', number | null> = { aileron: null, elevator: null, rudder: null };
  /** Hardware pedals (or a twist stick) owned the rudder at the last update. */
  private rudderHardware = false;
  private readonly steering: GroundSteeringAssist;
  private readonly rollTrim: RollTrimAssist;
  private readonly rotation: RotationGuard;
  private kbBrakeLeft = 0;
  private kbBrakeRight = 0;
  /** How much of its brake the steering assist applies (castering types): off while the pilot steers with a toe brake. */
  private assistBrake = 1;
  private readonly brakes = { left: 0, right: 0 };
  /** A key moved the lever in the last update (when it is let go, levers brought together rejoin). */
  private readonly leverMoved: Record<EngineLever, boolean> = { throttle: false, mixture: false, propeller: false };

  private mouseYoke = false;
  /** Mouse yoke on but waiting for the pointer to pass through the centre before it takes control. */
  private mouseArmed = false;
  private mouseNx = 0;
  private mouseNy = 0;
  /** Mouse-move events seen (a pick-up needs a real pointer position after the yoke was switched on). */
  private mouseMoves = 0;
  private mouseMovesAtArm = 0;
  private readonly mouseTakeover = { aileron: new TakeoverDetector(), elevator: new TakeoverDetector() };
  private overlay: MouseYokeOverlay | null = null;
  private shell: InputShell;

  private readonly activity: Record<'aileron' | 'elevator' | 'rudder', Activity> = {
    aileron: new Activity(),
    elevator: new Activity(),
    rudder: new Activity(),
  };
  private readonly throttleOwner = new LeverOwner();
  private readonly mixtureOwner = new LeverOwner();
  private time = 0;
  private lastWall = -1;
  /** Wall time (ms) of the last pilot flight-control input (keys held, hardware moved). */
  private lastPilotInput = -Infinity;
  private indicator: YokeIndicator = { mouseYoke: false, aileron: 0, elevator: 0, rudder: 0, source: 'keyboard', keyboardOffCentre: false, keyboardElevator: 0 };
  private unsubscribe: (() => void) | null = null;

  constructor(opts: InputSystemOptions = {}) {
    this.view = opts.view;
    this.keyTarget = opts.keyTarget;
    this.shell = opts.shell ?? {};
    this.profile = opts.profile ?? C172S_INPUT;
    for (const a of INPUT_ACTIONS) if (!profileHasAction(this.profile, a)) this.absent.add(a);
    this.twin = this.profile.engines > 1;
    this.common = this.profile.commonControls ?? [];
    const assists = this.profile.assists;
    this.groundElevator = groundElevatorTuning(assists.axes.elevator, assists.groundElevatorRate);
    this.steering = new GroundSteeringAssist(assists.steering);
    this.rollTrim = new RollTrimAssist(assists.rollTrim);
    this.rotation = new RotationGuard(assists.rotation);
  }

  /** Which engine(s) the engine keys act on (0 = left). One engine: always 'all'. After every reset: 'all'. */
  get engineSelection(): 'all' | 0 | 1 {
    return this.selection;
  }

  /** Connect (or replace) the application-shell hooks after construction. */
  setShell(shell: InputShell): void {
    this.shell = shell;
  }

  init(ctx: SimContext): void {
    this.ctx = ctx;
    this.element = ctx.renderer.domElement;
    const target = this.keyTarget ?? window;
    target.addEventListener('keydown', this.onKeyDown as EventListener);
    target.addEventListener('keyup', this.onKeyUp as EventListener);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('mousemove', this.onMouseMove);
    this.overlay = new MouseYokeOverlay(document.body);
    this.attach(ctx);
  }

  /**
   * Connect to the context without DOM listeners (node tests and scripted pilots drive keyDown/keyUp).
   * init() calls this.
   */
  attach(ctx: SimContext): void {
    this.ctx = ctx;
    this.unsubscribe?.();
    this.unsubscribe = ctx.events.on('reset', () => this.onReset(ctx));
    this.onReset(ctx);
  }

  /** A scenario reset: the flight model has written its trimmed controls into ctx.controls. */
  private onReset(ctx: SimContext): void {
    const c = ctx.controls;
    this.neutral.aileron = c.aileron;
    this.neutral.elevator = c.elevator;
    this.neutral.rudder = c.rudder;
    this.kbAileron = this.kbElevator = this.kbRudder = 0;
    this.ailCentred = this.rudCentred = true;
    this.centring = { aileron: false, elevator: false, rudder: false };
    this.written.aileron = this.written.elevator = this.written.rudder = null;
    this.kbBrakeLeft = this.kbBrakeRight = 0;
    this.assistBrake = 1;
    this.steering.reset();
    this.rollTrim.reset();
    this.rotation.reset();
    this.selection = 'all';
  }

  /** Press a key (KeyboardEvent.code) as if it came from the keyboard; returns the bound action or null. */
  keyDown(code: string, shift = false): InputAction | null {
    const action = actionForKey(code, shift);
    if (!action || this.absent.has(action) || this.keysDown.has(code)) return action;
    this.keysDown.set(code, action);
    this.pressedQueue.push(action);
    this.pressedEngine.push(undefined);
    return action;
  }

  /** Release a key pressed with keyDown() or on the keyboard. */
  keyUp(code: string): boolean {
    return this.keysDown.delete(code);
  }

  /** Release every key and every click-held control (focus loss). */
  releaseAll(): void {
    this.keysDown.clear();
    this.clicked.clear();
  }

  /**
   * Hold (down) or release a control from a click, as if its key were held: the starter from the panel's key
   * switch, the DG's align knob, a guarded knob. `engine` given = that engine regardless of the keyboard's
   * engine selection, and without the airborne guard (with one engine it makes no difference).
   */
  hold(action: InputAction, down: boolean, engine?: number): void {
    if (this.absent.has(action)) return;
    if (!down) {
      this.clicked.delete(action);
      return;
    }
    if (this.clicked.has(action)) return;
    const e = this.twin ? engine : undefined;
    this.clicked.set(action, e);
    this.pressedQueue.push(action);
    this.pressedEngine.push(e);
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    const target = this.keyTarget ?? window;
    target.removeEventListener('keydown', this.onKeyDown as EventListener);
    target.removeEventListener('keyup', this.onKeyUp as EventListener);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.overlay?.dispose();
    this.overlay = null;
  }

  getYokeIndicator(): YokeIndicator {
    return this.indicator;
  }

  isMouseYoke(): boolean {
    return this.mouseYoke;
  }

  /**
   * Switch the mouse yoke on or off. Switching it on arms it: it takes control only once the pointer
   * passes through the centre of the view (screen centre = yoke centre), as a hardware yoke is picked up.
   */
  setMouseYoke(on: boolean): void {
    if (on === this.mouseYoke) return;
    this.mouseYoke = on;
    this.mouseArmed = on;
    this.mouseMovesAtArm = this.mouseMoves;
    this.mouseTakeover.aileron.reset();
    this.mouseTakeover.elevator.reset();
    this.overlay?.announce(on);
    this.shell.toast?.(on ? 'Mouse yoke on: centre the pointer to take control (screen centre = yoke centre)' : 'Mouse yoke off');
  }

  // ---------------------------------------------------------------- events

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.altKey || e.metaKey || isTextEntry(e.target)) return;
    const action = actionForKey(e.code, e.shiftKey);
    if (!action || this.absent.has(action)) return;
    e.preventDefault();
    if (e.repeat) return;
    this.keyDown(e.code, e.shiftKey);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (this.keysDown.delete(e.code)) e.preventDefault();
  };

  private readonly onBlur = (): void => {
    this.releaseAll();
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    const el = this.element;
    // Captured mouse-look or a right-drag look must not also move the mouse yoke.
    if (!el || document.pointerLockElement || e.buttons & 2) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    this.mouseNx = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
    this.mouseNy = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
    this.mouseMoves++;
  };

  // ---------------------------------------------------------------- per frame

  update(dt: number, ctx: SimContext): void {
    this.time += dt;
    const now = performance.now();
    const wallDt = this.lastWall < 0 ? 0 : Math.min(0.1, (now - this.lastWall) / 1000);
    this.lastWall = now;
    this.gamepads.poll(now);

    this.held.clear();
    for (const a of this.keysDown.values()) this.held.add(a);
    for (const a of this.gamepads.held) if (!this.absent.has(a)) this.held.add(a);
    if (this.clicked.size > 0) for (const a of this.clicked.keys()) this.held.add(a);

    for (let i = 0; i < this.pressedQueue.length; i++) this.onPressed(this.pressedQueue[i], ctx, false, this.pressedEngine[i]);
    for (const a of this.gamepads.pressed) this.onPressed(a, ctx, true);
    this.pressedQueue.length = 0;
    this.pressedEngine.length = 0;

    for (const a of LEVER_ACTIONS) this.heldTime.set(a, this.held.has(a) ? (this.heldTime.get(a) ?? 0) + dt : 0);

    this.updateFlightControls(dt, ctx);
    this.updateLevers(dt, ctx.controls, ctx.state);
    this.updateKnobs(dt, ctx.controls);
    this.updateBrakes(dt, ctx.controls, ctx.state);
    this.updateStarter(ctx.controls, ctx.state);
    ctx.controls.dgAlign = this.held.has('dgAlign');
    if (this.twin) ctx.engineSelection = this.selection;

    // Look around from the keyboard (wall-clock, so it also works while paused).
    const lx = this.dir('lookLeft', 'lookRight');
    const ly = this.dir('lookUp', 'lookDown');
    if ((lx !== 0 || ly !== 0) && wallDt > 0) this.view?.lookBy?.(lx * LOOK_RATE * wallDt, ly * LOOK_RATE * wallDt);

    const yokeKeys = ['pitchUp', 'pitchDown', 'rollLeft', 'rollRight', 'rudderLeft', 'rudderRight'] as const;
    if (yokeKeys.some((a) => this.held.has(a)) || this.hardwareTakeover() || this.mouseTakingOver) this.lastPilotInput = now;

    this.overlay?.update(this.mouseYoke, this.mouseArmed, this.indicator.aileron, this.indicator.elevator, this.viewRect);
  }

  private readonly viewRect = (): DOMRect | null => this.element?.getBoundingClientRect() ?? null;

  /** A hardware yoke, stick or pedal axis is being deliberately worked (not merely resting off centre). */
  private hardwareTakeover(): boolean {
    for (const r of this.gamepads.readings) {
      if (r.takeover && (r.control === 'aileron' || r.control === 'elevator' || r.control === 'rudder')) return true;
    }
    return false;
  }

  /** Set in updateFlightControls: the mouse yoke (in control) was moved well away from where it rested. */
  private mouseTakingOver = false;

  /**
   * True if the pilot worked the flight controls in the last update or within `withinMs` of now: a yoke or
   * rudder key held, or a hardware axis or the mouse yoke moved well away from where it had been resting.
   * A yoke merely resting off centre (spring-centred consumer yokes and gamepad sticks often rest a few
   * percent off) does not count. The shell uses it to disconnect the autopilot when the pilot takes over,
   * as a real autopilot does when the pilot overpowers it.
   */
  pilotFlying(withinMs = 100): boolean {
    return performance.now() - this.lastPilotInput <= withinMs;
  }

  private heldFor(a: InputAction): number {
    return this.heldTime.get(a) ?? 0;
  }

  private dir(neg: InputAction, pos: InputAction): number {
    return (this.held.has(pos) ? 1 : 0) - (this.held.has(neg) ? 1 : 0);
  }

  /** Value of the most deflected in-use hardware axis for a centring control, or null. */
  private hardwareCentring(control: 'aileron' | 'elevator' | 'rudder'): number | null {
    let best = 0;
    let active = false;
    for (const r of this.gamepads.readings) {
      if (r.control !== control) continue;
      active = active || r.value !== 0 || r.moved;
      if (Math.abs(r.value) > Math.abs(best)) best = r.value;
    }
    const act = this.activity[control];
    act.sample(active, this.time);
    return act.isActive(this.time) ? best : null;
  }

  private updateFlightControls(dt: number, ctx: SimContext): void {
    const s = ctx.state;
    const ias = s.ias;
    const c = ctx.controls;
    const n = this.neutral;
    const tuning = this.profile.assists;

    // Mouse yoke: armed until the pointer passes through the centre, then in control.
    let mouse: { aileron: number; elevator: number } | null = null;
    this.mouseTakingOver = false;
    if (this.mouseYoke) {
      if (this.mouseArmed && this.mouseMoves > this.mouseMovesAtArm && mouseYokeNearCentre(this.mouseNx, this.mouseNy)) {
        this.mouseArmed = false;
        this.overlay?.pickedUp();
      }
      if (!this.mouseArmed) {
        mouse = mouseYokeDeflection(this.mouseNx, this.mouseNy);
        const a = this.mouseTakeover.aileron.update(mouse.aileron, dt);
        const e = this.mouseTakeover.elevator.update(mouse.elevator, dt);
        this.mouseTakingOver = a || e;
      }
    }
    const hwAil = this.hardwareCentring('aileron');
    const hwEle = this.hardwareCentring('elevator');
    const hwRud = this.hardwareCentring('rudder');
    const kbAil = hwAil === null && mouse === null;
    const kbEle = hwEle === null && mouse === null;
    const kbRud = hwRud === null;
    this.rudderHardware = !kbRud;

    // Someone else (the autopilot) moved a control the keyboard alone was holding: the keyboard yoke follows
    // it, as the pilot's hand resting on a yoke the autopilot moves, so nothing jumps when it disconnects.
    if (kbAil && this.external('aileron', c.aileron)) {
      this.kbAileron = c.aileron - n.aileron;
      this.rollTrim.reset();
      this.ailCentred = false;
      this.centring.aileron = false;
    }
    if (kbEle && this.external('elevator', c.elevator)) {
      this.kbElevator = c.elevator - n.elevator;
      this.centring.elevator = false;
    }
    if (kbRud && this.external('rudder', c.rudder)) {
      this.kbRudder = c.rudder - n.rudder;
      this.steering.reset();
      this.rudCentred = false;
      this.centring.rudder = false;
    }

    // Keys: move the held position; with no key down it stays (or glides to centre after Numpad 5 / 5).
    const roll = this.dir('rollLeft', 'rollRight');
    if (roll !== 0) {
      if (this.ailCentred) {
        // The pilot's hand takes the yoke from the roll trim without a bump.
        this.kbAileron += this.rollTrim.value;
        this.rollTrim.reset();
        this.ailCentred = false;
      }
      this.centring.aileron = false;
      this.kbAileron = stepKeyAxis(this.kbAileron, roll, ias, dt, tuning.axes.aileron, this.heldFor(roll > 0 ? 'rollRight' : 'rollLeft'));
    } else if (this.centring.aileron) {
      this.kbAileron = stepCentre(this.kbAileron, dt);
      if (this.kbAileron === 0) {
        this.centring.aileron = false;
        this.ailCentred = true;
      }
    }

    const pitch = this.dir('pitchDown', 'pitchUp');
    const kbElevatorBefore = this.kbElevator;
    const onMains = s.wheels[1].onGround || s.wheels[2].onGround;
    if (pitch !== 0) {
      this.centring.elevator = false;
      const elevator = onMains ? this.groundElevator : tuning.axes.elevator;
      this.kbElevator = stepKeyAxis(this.kbElevator, pitch, ias, dt, elevator, this.heldFor(pitch > 0 ? 'pitchUp' : 'pitchDown'));
    } else if (this.centring.elevator) {
      this.kbElevator = stepCentre(this.kbElevator, dt);
      if (this.kbElevator === 0) this.centring.elevator = false;
    }
    this.kbElevator = this.rotation.step(this.kbElevator, kbElevatorBefore, s.angularVelocity.y, s.pitch, onMains, dt, this.held.has('pitchUp'));
    if (dt > 0) {
      // Soft load-factor stops: ease the held keyboard elevator back while beyond them.
      const g = tuning.gStops;
      if (this.kbElevator > 0.02 && s.gLoad > g.pull) this.kbElevator = Math.max(0.02, this.kbElevator - (s.gLoad - g.pull) * G_STOP_RATE * dt);
      else if (this.kbElevator < -0.02 && s.gLoad < g.push) this.kbElevator = Math.min(-0.02, this.kbElevator + (g.push - s.gLoad) * G_STOP_RATE * dt);
    }

    const yaw = this.dir('rudderLeft', 'rudderRight');
    if (yaw !== 0) {
      if (this.rudCentred) {
        // The pilot's feet take the pedals from the auto-rudder without a bump.
        this.kbRudder += this.steering.value;
        this.steering.reset();
        this.rudCentred = false;
      }
      this.centring.rudder = false;
      this.kbRudder = stepKeyAxis(this.kbRudder, yaw, ias, dt, tuning.axes.rudder, this.heldFor(yaw > 0 ? 'rudderRight' : 'rudderLeft'));
    } else if (this.centring.rudder) {
      this.kbRudder = stepCentre(this.kbRudder, dt);
      if (this.kbRudder === 0) {
        this.centring.rudder = false;
        this.rudCentred = true;
      }
    }
    // The flight model's travel is [-1, 1] about zero, not about the trimmed centre.
    this.kbAileron = clamp(this.kbAileron, -1 - n.aileron, 1 - n.aileron);
    this.kbElevator = clamp(this.kbElevator, -1 - n.elevator, 1 - n.elevator);
    this.kbRudder = clamp(this.kbRudder, -1 - n.rudder, 1 - n.rudder);

    // Ground auto-rudder: the pilot's feet while the keyboard rudder is centred (keyboard rudder only).
    const onGround = s.wheels[0].onGround || s.wheels[1].onGround || s.wheels[2].onGround;
    const rudderFree = kbRud && this.rudCentred && !this.centring.rudder && yaw === 0;
    let assist = 0;
    if (this.assists.groundSteering && rudderFree) {
      const differentialBrake = Math.abs(this.kbBrakeLeft - this.kbBrakeRight) > PILOT_DIFFERENTIAL_BRAKE;
      assist = this.steering.step(s.heading, s.angularVelocity.z, onGround, s.groundSpeed, differentialBrake, dt);
    } else this.steering.reset();

    // Feet off the pedals on the ground: nobody holds them (no rudder axis in use, the keyboard rudder centred,
    // and the auto-rudder, which stands in for the keyboard pilot's feet, switched off). The flight model then
    // lets the rudder float with the fin's local flow and the nosewheel follow it through the bungee, so a
    // hands- and feet-off take-off roll drifts gently left as in the real aircraft (ControlInputs.feetOffRudder;
    // the shell never frees it while the autoflight flies). In the air the feet stay on the pedals at their
    // trimmed neutral: the rudder-tab rigging is set for fixed pedals, and a floating rudder there would add
    // ~1.4 deg of sideslip and a slow heading drift in hands-off cruise.
    c.feetOffRudder = onGround && rudderFree && !this.assists.groundSteering;

    // Roll trim: the pilot's hand holding off a steady roll tendency while the keyboard ailerons are centred.
    let rollBias = 0;
    if (this.assists.rollTrim && kbAil && this.ailCentred && !this.centring.aileron) {
      const airborne = !onGround;
      rollBias = this.rollTrim.step(s.angularVelocity.x, s.roll, airborne, false, dt);
    } else this.rollTrim.reset();

    c.aileron = mixCentring(n.aileron + this.kbAileron + rollBias, mouse?.aileron ?? null, hwAil);
    c.elevator = mixCentring(n.elevator + this.kbElevator, mouse?.elevator ?? null, hwEle);
    c.rudder = mixCentring(n.rudder + this.kbRudder + assist, null, hwRud);
    this.written.aileron = kbAil ? c.aileron : null;
    this.written.elevator = kbEle ? c.elevator : null;
    this.written.rudder = kbRud ? c.rudder : null;

    const i = this.indicator;
    i.mouseYoke = this.mouseYoke;
    i.mouseArmed = this.mouseYoke && this.mouseArmed;
    i.aileron = c.aileron;
    i.elevator = c.elevator;
    i.rudder = c.rudder;
    i.source = hwAil !== null || hwEle !== null ? 'hardware' : mouse ? 'mouse' : 'keyboard';
    i.keyboardOffCentre =
      (kbAil && Math.abs(this.kbAileron) > OFF_CENTRE) || (kbEle && Math.abs(this.kbElevator) > OFF_CENTRE) || (kbRud && Math.abs(this.kbRudder) > OFF_CENTRE);
    i.keyboardElevator = kbEle ? this.kbElevator : 0;
  }

  /** The control differs from what the keyboard wrote to it last frame (another writer moved it). */
  private external(axis: 'aileron' | 'elevator' | 'rudder', now: number): boolean {
    const w = this.written[axis];
    return w !== null && Math.abs(now - w) > 1e-6;
  }

  /**
   * Numpad 5 / 5: centre the keyboard aileron, elevator and rudder (they glide back in at most 0.25 s). On
   * the take-off or landing roll with the auto-rudder on, the held rudder is handed to the auto-rudder instead
   * (it holds the present heading, starting from that rudder), so centring does not swerve the aircraft.
   */
  centreControls(ctx: SimContext = this.ctx): void {
    this.centring.aileron = this.centring.elevator = true;
    const s = ctx.state;
    const onGround = s.wheels[0].onGround || s.wheels[1].onGround || s.wheels[2].onGround;
    const handover = this.assists.groundSteering && onGround && s.groundSpeed > this.profile.assists.handoverSpeed && !this.rudderHardware;
    if (handover && !this.rudCentred && Math.abs(this.kbRudder) <= this.steering.limit) {
      this.steering.handover(this.kbRudder);
      this.kbRudder = 0;
      this.rudCentred = true;
      this.centring.rudder = false;
    } else this.centring.rudder = true;
  }

  private hardwareLever(control: AxisControl): { value: number; moved: boolean } | null {
    let found: { value: number; moved: boolean } | null = null;
    for (const r of this.gamepads.readings) {
      if (r.control !== control) continue;
      if (!found || r.moved) found = r;
    }
    return found;
  }

  // ---------------------------------------------------------------- engines

  /** The engine(s) a key for `k` acts on: `engine` if the press names one (a click), else the selection. */
  private target(k: EngineControlKey, engine?: number): EngineTarget {
    return !this.twin || this.common.includes(k) ? 'all' : (engine ?? this.selection);
  }

  /** The engine(s) a held lever key pair acts on (a click-held one may name its engine). */
  private leverTarget(k: EngineLever, up: InputAction, down: InputAction): EngineTarget {
    return this.twin ? this.target(k, this.clicked.get(up) ?? this.clicked.get(down)) : 'all';
  }

  private airborne(s: AircraftState): boolean {
    return !(s.wheels[0].onGround || s.wheels[1].onGround || s.wheels[2].onGround);
  }

  /**
   * The guard of a twin in the air on the keys that can shut down or secure an engine (feather, magnetos OFF,
   * ENGINE MASTER off, mixture to idle cut-off, fuel selector OFF): they want ONE engine selected. True (and the
   * pilot is told) when a key for `k` must do nothing: both engines selected and no weight on any wheel. On the
   * ground both engines selected is a normal shut-down; a single has no guard.
   */
  private guard(s: AircraftState, k: EngineControlKey, engine?: number): boolean {
    if (!this.guarded(s, k, engine)) return false;
    this.shell.toast?.(`Select an engine first (${keyLabelForAction('engineSelect1')} left, ${keyLabelForAction('engineSelect2')} right)`);
    return true;
  }

  private guarded(s: AircraftState, k: EngineControlKey, engine?: number): boolean {
    return this.twin && this.target(k, engine) === 'all' && !this.common.includes(k) && this.airborne(s);
  }

  private selectEngine(selection: 'all' | 0 | 1): void {
    this.selection = selection;
    this.shell.toast?.(selection === 'all' ? 'Both engines selected' : selection === 0 ? 'Left engine selected' : 'Right engine selected');
  }

  /** Magneto switch position, or on an ENGINE MASTER type the master off (0) / on, for the selected engine(s). */
  private setIgnition(ctx: SimContext, position: MagnetoPosition, engine?: number): void {
    const master = this.profile.ignition === 'engineMaster';
    const k = master ? 'engineMaster' : 'magnetos';
    if (position === 0 && this.guard(ctx.state, k, engine)) return;
    if (master) writeEngineControl(ctx.controls, this.target(k, engine), 'engineMaster', position !== 0);
    else writeEngineControl(ctx.controls, this.target(k, engine), 'magnetos', position);
  }

  /** Where a mixture key stops for `target`: above idle cut-off behind the airborne guard, else at the stop. */
  private mixtureFloor(s: AircraftState, target: EngineTarget): number {
    return target === 'all' && this.guarded(s, 'mixture') ? MIXTURE_GUARD : 0;
  }

  /**
   * A key for one engine moves that engine's OWN lever: another engine still follows the scalar. (Once the
   * other engine has its own position the selected one is the only follower, and its key moves the scalar.)
   */
  private ownLever(c: ControlInputs, k: EngineLever, target: EngineTarget): target is number {
    return target !== 'all' && c.engines.length > 1 && scalarShared(c, target, k);
  }

  /**
   * Move a lever of the engine(s) of `target` by `inc` (a tap, or a frame of a held key). `floor` / `lift`: see
   * stepLever. With one engine this is the scalar between its two stops.
   */
  private moveLever(c: ControlInputs, k: EngineLever, inc: number, target: EngineTarget, floor: number, lift: boolean): void {
    if (this.ownLever(c, k, target)) {
      if (inc !== 0) setEngineControl(c, target, k, stepLever(engineControl(c, target, k), inc, floor, lift));
      return;
    }
    const after = floor > 0 ? stepLever(c[k], inc, floor, lift) : clamp(c[k] + inc, 0, 1);
    if (inc !== 0 && c.engines.length > 1) {
      if (target === 'all') moveSplitLevers(c, k, inc, floor, after);
      else clearEngineControl(c, k, target);
    }
    c[k] = after;
  }

  /** A lever key was let go: levers the pilot brought together are one lever again. */
  private leverHeld(c: ControlInputs, k: EngineLever, moving: boolean): void {
    if (this.leverMoved[k] && !moving && c.engines.length > 1) rejoinLevers(c, k);
    this.leverMoved[k] = moving;
  }

  private updateLevers(dt: number, c: ControlInputs, s: AircraftState): void {
    const rate = (a: InputAction, base: number): number => (this.held.has(a) ? leverRate(base, this.heldTime.get(a) ?? 0) : 0);

    // Throttle: keys and a rate stick (gamepad) nudge the lever; an absolute lever axis owns it once moved (it
    // is the lever of all engines: an engine whose lever has left the scalar keeps its own position).
    const kbThrottle = rate('throttleUp', THROTTLE_RATE) - rate('throttleDown', THROTTLE_RATE);
    let stick = 0;
    for (const r of this.gamepads.readings) if (r.control === 'throttleRate') stick += r.value;
    const hwThrottle = this.hardwareLever('throttle');
    const nudging = kbThrottle !== 0 || stick !== 0;
    const throttleInc = (kbThrottle + stick * THROTTLE_STICK_RATE) * dt;
    const throttleTarget = this.leverTarget('throttle', 'throttleUp', 'throttleDown');
    const ownThrottle = this.ownLever(c, 'throttle', throttleTarget);
    if (ownThrottle) this.moveLever(c, 'throttle', throttleInc, throttleTarget, 0, false);
    if (this.throttleOwner.update(nudging && !ownThrottle, hwThrottle?.moved ?? false) === 'hardware' && hwThrottle) c.throttle = hwThrottle.value;
    else this.moveLever(c, 'throttle', ownThrottle ? 0 : throttleInc, ownThrottle ? 'all' : throttleTarget, 0, false);
    this.leverHeld(c, 'throttle', nudging && dt > 0);

    const kbMixture = rate('mixtureRich', MIXTURE_RATE) - rate('mixtureLean', MIXTURE_RATE);
    const hwMixture = this.hardwareLever('mixture');
    const mixtureTarget = this.leverTarget('mixture', 'mixtureRich', 'mixtureLean');
    const ownMixture = this.ownLever(c, 'mixture', mixtureTarget);
    if (ownMixture) this.moveLever(c, 'mixture', kbMixture * dt, mixtureTarget, 0, false);
    if (this.mixtureOwner.update(kbMixture !== 0 && !ownMixture, hwMixture?.moved ?? false) === 'hardware' && hwMixture) c.mixture = hwMixture.value;
    else this.moveLever(c, 'mixture', ownMixture ? 0 : kbMixture * dt, ownMixture ? 'all' : mixtureTarget, this.mixtureFloor(s, mixtureTarget), false);
    this.leverHeld(c, 'mixture', kbMixture !== 0 && dt > 0);

    if (this.profile.has.propeller) {
      // Propeller lever: down to the feather gate and no further (Shift+F feathers); up from feather starts at the gate.
      const kbPropeller = rate('propIncrease', PROPELLER_RATE) - rate('propDecrease', PROPELLER_RATE);
      if (kbPropeller !== 0) this.moveLever(c, 'propeller', kbPropeller * dt, this.leverTarget('propeller', 'propIncrease', 'propDecrease'), PROP_FEATHER_GATE, true);
      this.leverHeld(c, 'propeller', kbPropeller !== 0 && dt > 0);
    }

    const trim = rate('trimNoseUp', TRIM_RATE) - rate('trimNoseDown', TRIM_RATE);
    c.elevatorTrim = clamp(c.elevatorTrim + trim * dt, -1, 1);
    if (this.profile.has.rudderTrim) {
      const rudderTrim = rate('rudderTrimRight', TRIM_RATE) - rate('rudderTrimLeft', TRIM_RATE);
      c.rudderTrim = clamp(c.rudderTrim + rudderTrim * dt, -1, 1);
    }
  }

  /**
   * The starter, held. With two engines only one starter turns at a time: the selected engine's, or with both
   * selected the left engine's until it runs and then the right one's (the scalar stays off).
   */
  private updateStarter(c: ControlInputs, s: AircraftState): void {
    const held = this.held.has('starter');
    if (c.engines.length < 2) {
      c.starter = held;
      return;
    }
    let engine = -1;
    if (held) {
      const target = this.target('starter', this.clicked.get('starter'));
      if (target !== 'all') engine = target;
      else {
        for (let i = 0; i < c.engines.length && engine < 0; i++) if (!s.engines[i]?.running) engine = i;
      }
    }
    c.starter = false;
    for (let i = 0; i < c.engines.length; i++) {
      if (i === engine) setEngineControl(c, i, 'starter', true);
      else if (engineControl(c, i, 'starter')) clearEngineControl(c, 'starter', i);
    }
  }

  /** Instrument knobs: heading bug, Kollsman window, OBS (a tap turns one detent, holding accelerates). */
  private updateKnobs(dt: number, c: ControlInputs): void {
    // Like a key's auto-repeat: a tap turns exactly one detent, holding starts turning after a moment.
    const rate = (a: InputAction, base: number): number => {
      const t = this.heldFor(a) - KNOB_REPEAT_DELAY;
      return this.held.has(a) && t > 0 ? leverRate(base, t) : 0;
    };
    const bug = rate('headingBugRight', BUG_RATE) - rate('headingBugLeft', BUG_RATE);
    if (bug !== 0) c.headingBugDeg = wrapDegrees(c.headingBugDeg + bug * dt);
    const obs = rate('obsUp', BUG_RATE) - rate('obsDown', BUG_RATE);
    if (obs !== 0) c.obsDeg = wrapDegrees(c.obsDeg + obs * dt);
    const kollsman = rate('kollsmanUp', KOLLSMAN_RATE) - rate('kollsmanDown', KOLLSMAN_RATE);
    // The C172 altimeter's Kollsman window covers 946-1050 hPa (27.9-31.0 inHg).
    if (kollsman !== 0) c.kollsmanHpa = clamp(c.kollsmanHpa + kollsman * dt, 946, 1050);
  }

  private updateBrakes(dt: number, c: ControlInputs, s: AircraftState): void {
    const both = this.held.has('brakes');
    this.kbBrakeLeft = stepBrake(this.kbBrakeLeft, both || this.held.has('brakeLeft'), dt);
    this.kbBrakeRight = stepBrake(this.kbBrakeRight, both || this.held.has('brakeRight'), dt);
    // Toe brakes from all sources combine by maximum: pedals rest at zero, so there is nothing to arbitrate.
    let left = this.kbBrakeLeft;
    let right = this.kbBrakeRight;
    for (const r of this.gamepads.readings) {
      if (r.control === 'brakeLeft' || r.control === 'brakes') left = Math.max(left, r.value);
      if (r.control === 'brakeRight' || r.control === 'brakes') right = Math.max(right, r.value);
    }
    if (this.steering.steersWithBrakes && !this.airborne(s)) {
      // Castering nosewheel: the brakes steer. The demand is the auto-rudder's, or the same law on the keyboard
      // rudder, plus the toe brake of a foot on a keyboard pedal pushed past half travel (hardware pedals have
      // their own toe brakes); it works on the pilot's symmetric brake, and what he applies on one side only
      // stays on top. A toe brake on one side is the pilot steering: the assist, frozen meanwhile, takes its brake
      // off as a foot leaves a pedal and puts it back as one goes on when he lets go (stepBrake's rates).
      const pilotSteers = Math.abs(this.kbBrakeLeft - this.kbBrakeRight) > PILOT_DIFFERENTIAL_BRAKE;
      this.assistBrake = stepBrake(this.assistBrake, !pilotSteers, dt);
      const pedal = this.rudderHardware ? 0 : this.steering.rudderBrake(this.kbRudder, s.ias) + this.steering.pedalBrake(c.rudder, s.ias);
      const demand = clamp(this.assistBrake * this.steering.brakeDemand(s.ias) + pedal, -1, 1);
      const base = Math.min(left, right);
      const b = differentialBrake(base, demand, this.brakes);
      left = clamp(left - base + b.left, 0, 1);
      right = clamp(right - base + b.right, 0, 1);
    }
    c.brakeLeft = left;
    c.brakeRight = right;
  }

  /**
   * Discrete actions, applied once per press. `engine`: the press is for that engine (a click on its switch),
   * not for the selected one(s).
   */
  private onPressed(a: InputAction, ctx: SimContext, fromController: boolean, engine?: number): void {
    if (this.absent.has(a)) return;
    const c = ctx.controls;
    switch (a) {
      case 'throttleUp':
        this.moveLever(c, 'throttle', LEVER_TAP, this.target('throttle', engine), 0, false);
        break;
      case 'throttleDown':
        this.moveLever(c, 'throttle', -LEVER_TAP, this.target('throttle', engine), 0, false);
        break;
      case 'throttleIdle':
      case 'throttleFull': {
        // Both engines selected: the levers are brought together, whatever their split.
        const target = this.target('throttle', engine);
        if (!this.ownLever(c, 'throttle', target)) this.throttleOwner.owner = 'keyboard';
        writeEngineControl(c, target, 'throttle', a === 'throttleIdle' ? 0 : 1);
        break;
      }
      case 'mixtureLean': {
        const target = this.target('mixture', engine);
        const floor = this.mixtureFloor(ctx.state, target);
        // Already at the guard's stop: the key does nothing, and says why.
        if (floor > 0 && c.mixture <= floor) this.guard(ctx.state, 'mixture', engine);
        this.moveLever(c, 'mixture', -LEVER_TAP, target, floor, false);
        break;
      }
      case 'mixtureRich': {
        const target = this.target('mixture', engine);
        this.moveLever(c, 'mixture', LEVER_TAP, target, this.mixtureFloor(ctx.state, target), false);
        break;
      }
      case 'propDecrease':
        this.moveLever(c, 'propeller', -LEVER_TAP, this.target('propeller', engine), PROP_FEATHER_GATE, true);
        break;
      case 'propIncrease':
        this.moveLever(c, 'propeller', LEVER_TAP, this.target('propeller', engine), PROP_FEATHER_GATE, true);
        break;
      case 'propFeather':
        // Through the gate to feather. Not a toggle: the way back is the propeller lever forward.
        if (!this.guard(ctx.state, 'propeller', engine)) writeEngineControl(c, this.target('propeller', engine), 'propeller', 0);
        break;
      case 'carbHeat':
        if (this.profile.has.carbHeat) {
          const target = this.target('carbHeat', engine);
          writeEngineControl(c, target, 'carbHeat', readEngineControl(c, target, 'carbHeat') > 0.5 ? 0 : 1);
        } else {
          const target = this.target('alternateAir', engine);
          writeEngineControl(c, target, 'alternateAir', !readEngineControl(c, target, 'alternateAir'));
        }
        break;
      case 'cowlFlapsOpen':
      case 'cowlFlapsClose': {
        const target = this.target('cowlFlaps', engine);
        writeEngineControl(c, target, 'cowlFlaps', stepThird(readEngineControl(c, target, 'cowlFlaps'), a === 'cowlFlapsOpen' ? 1 : -1));
        break;
      }
      case 'engineSelect1':
        this.selectEngine(0);
        break;
      case 'engineSelect2':
        this.selectEngine(1);
        break;
      case 'engineSelectAll':
        this.selectEngine('all');
        break;
      case 'gearDown':
        c.gearLever = 'down';
        break;
      case 'gearUp':
        c.gearLever = 'up';
        break;
      case 'gearEmergency':
        c.gearEmergency = true; // the knob latches out
        break;
      case 'rudderTrimLeft':
        c.rudderTrim = clamp(c.rudderTrim - LEVER_TAP / 2, -1, 1);
        break;
      case 'rudderTrimRight':
        c.rudderTrim = clamp(c.rudderTrim + LEVER_TAP / 2, -1, 1);
        break;
      case 'trimNoseUp':
        c.elevatorTrim = clamp(c.elevatorTrim + LEVER_TAP / 2, -1, 1);
        break;
      case 'trimNoseDown':
        c.elevatorTrim = clamp(c.elevatorTrim - LEVER_TAP / 2, -1, 1);
        break;
      case 'flapsUp':
        c.flaps = nextFlapDetent(c.flaps, -1, this.profile.flapDetents);
        break;
      case 'flapsDown':
        c.flaps = nextFlapDetent(c.flaps, 1, this.profile.flapDetents);
        break;
      case 'parkingBrake':
        c.parkingBrake = !c.parkingBrake;
        break;
      case 'starter':
        // The key switch passes through BOTH on its way to START (toggle magnetos and ENGINE MASTER stay put).
        if (this.profile.ignition === 'key') writeEngineControl(c, this.target('magnetos', engine), 'magnetos', 3);
        break;
      case 'magnetoOff':
        this.setIgnition(ctx, 0, engine);
        break;
      case 'magnetoRight':
        this.setIgnition(ctx, 1, engine);
        break;
      case 'magnetoLeft':
        this.setIgnition(ctx, 2, engine);
        break;
      case 'magnetoBoth':
        this.setIgnition(ctx, 3, engine);
        break;
      case 'landingLight':
        c.lights.landing = !c.lights.landing;
        break;
      case 'taxiLight':
        c.lights.taxi = !c.lights.taxi;
        break;
      case 'navLights':
        c.lights.nav = !c.lights.nav;
        break;
      case 'strobes':
        c.lights.strobe = !c.lights.strobe;
        break;
      case 'beacon':
        c.lights.beacon = !c.lights.beacon;
        break;
      case 'masterSwitch': {
        // The split rocker: switching the master on turns both halves on; off turns both off.
        const on = !c.masterBattery;
        c.masterBattery = on;
        c.alternator = on;
        break;
      }
      case 'alternator':
        // The ALT half can only be on with the BAT half (they are interlocked).
        c.alternator = !c.alternator;
        if (c.alternator) c.masterBattery = true;
        break;
      case 'avionics':
        c.avionics = !c.avionics;
        break;
      case 'pitotHeat':
        c.pitotHeat = !c.pitotHeat;
        break;
      case 'fuelPump': {
        const target = this.target('fuelPump', engine);
        writeEngineControl(c, target, 'fuelPump', !readEngineControl(c, target, 'fuelPump'));
        break;
      }
      case 'fuelSelector': {
        const cycle = this.profile.fuelSelectorCycle;
        const target = this.target('fuelSelector', engine);
        const next = cycle[(cycle.indexOf(readEngineControl(c, target, 'fuelSelector')) + 1) % cycle.length];
        if (next === 'off' && this.guard(ctx.state, 'fuelSelector', engine)) break;
        writeEngineControl(c, target, 'fuelSelector', next);
        break;
      }
      case 'panelLights': {
        const i = PANEL_LIGHT_STEPS.findIndex((v) => v > c.lights.panel + 0.01);
        c.lights.panel = i < 0 ? 0 : PANEL_LIGHT_STEPS[i];
        break;
      }
      case 'headingBugRight':
        c.headingBugDeg = wrapDegrees(Math.round(c.headingBugDeg) + BUG_TAP);
        break;
      case 'headingBugLeft':
        c.headingBugDeg = wrapDegrees(Math.round(c.headingBugDeg) - BUG_TAP);
        break;
      case 'obsUp':
        c.obsDeg = wrapDegrees(Math.round(c.obsDeg) + BUG_TAP);
        break;
      case 'obsDown':
        c.obsDeg = wrapDegrees(Math.round(c.obsDeg) - BUG_TAP);
        break;
      case 'kollsmanUp':
        c.kollsmanHpa = clamp(Math.round(c.kollsmanHpa) + KOLLSMAN_TAP, 946, 1050);
        break;
      case 'kollsmanDown':
        c.kollsmanHpa = clamp(Math.round(c.kollsmanHpa) - KOLLSMAN_TAP, 946, 1050);
        break;
      case 'mouseYoke':
        this.setMouseYoke(!this.mouseYoke);
        break;
      case 'cameraNext':
      case 'cameraPrev': {
        const i = CAMERA_CYCLE.indexOf(ctx.cameraMode);
        const n = CAMERA_CYCLE.length;
        ctx.commands.setCameraMode(CAMERA_CYCLE[(i + (a === 'cameraNext' ? 1 : n - 1)) % n]);
        break;
      }
      case 'viewRecentre':
        this.view?.recentre();
        break;
      case 'centreControls':
        this.centreControls(ctx);
        break;
      case 'zoomIn':
        this.view?.zoom(1);
        break;
      case 'zoomOut':
        this.view?.zoom(-1);
        break;
      case 'mouseLook':
        this.view?.togglePointerLock();
        break;
      case 'pause':
        // A controller's Start button is the game-controller Escape: it must go through the UI, which knows
        // whether a modal (pause menu, crash dialog) is open. Toggling the pause directly would resume the
        // simulation behind an open menu that swallows every key. (The keyboard Pause key never gets here
        // while a modal is open: the UI captures keys first.)
        if (fromController) this.pressMenuButton(ctx);
        else ctx.commands.setPaused(!ctx.paused);
        break;
      default:
        break; // held actions (yoke, rudder, brakes, trim) are handled continuously
    }
  }

  private pressMenuButton(ctx: SimContext): void {
    if (this.shell.menuButton) {
      this.shell.menuButton();
      return;
    }
    if (typeof window !== 'undefined' && typeof KeyboardEvent !== 'undefined') {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape', key: 'Escape', bubbles: true, cancelable: true }));
    } else ctx.commands.setPaused(!ctx.paused);
  }
}
