// The aircraft contract: one AircraftDefinition (flight model, systems and sim profile; node-safe, no DOM) and
// one AircraftPresentation (3D model data, panel, UI text, audio, training type data) per type, under
// src/aircraft/<id>/. Components are constructed from the definition; the Cessna 172S is every component's
// default.
//
// Plain data unless marked FACTORY (returns objects with class instances or closures) or CLOSURES (contains
// functions). Only plain-data parts may cross a postMessage. This file re-exports the area definition modules
// with `export type *`, so exported type names must be unique across all of them.

import type { Vec3 } from '../core/math';
import type { AircraftId, AircraftState, ControlInputs, ControlPatch } from '../core/types';
import type { AircraftAeroDefinition } from '../physics/aero/definition';
import type { GearConfig } from '../physics/gear/gearConfig';
import type { PowerplantDef } from '../physics/propulsion/defs';
import type { AirframeVisualDef } from '../render/aircraft/airframe/types';
import type { InstrumentSystemsDef, PanelDef } from '../instruments/panelDef';
import type { InputProfile } from '../input/profile';
import type { AudioProfile } from '../audio/profile';
import type { AircraftTypeDef } from '../training/types';

export type { AircraftId } from '../core/types';
export type * from '../physics/aero/definition';
export type * from '../physics/gear/gearConfig';
export type * from '../physics/propulsion/defs';
export type * from '../render/aircraft/airframe/types';
export type * from '../instruments/panelDef';
export type * from '../input/profile';
export type * from '../audio/profile';

/** Static facts the menu and the URL parser need without loading a definition. */
export interface AircraftSummary {
  id: AircraftId;
  /** 'Cessna 172S Skyhawk SP' (loading screen, briefing). */
  name: string;
  /** 'Cessna 172S' (menu brand, toasts). */
  shortName: string;
  /** One line for the chooser: 'Four-seat high-wing trainer, 180 hp'. */
  blurb: string;
  engineCount: 1 | 2;
  /** False until the type's Stage D is accepted: hidden from the chooser, URL still works (dev). */
  available: boolean;
}

/** Flight model, systems and sim profile of one type. Node-safe. */
export interface AircraftDefinition {
  id: AircraftId;
  name: string;
  shortName: string;
  /** Exact variant modelled, e.g. 'PA-34-200 Seneca I (1974, 4200 lb)'. */
  variant: string;
  icaoType: string;
  engineCount: 1 | 2;
  /** True while the directory still holds the Stage A placeholder (a C172S under this id). */
  placeholder?: boolean;
  /** Overrides of the generic defaultControls() for this type. Plain data. */
  controlDefaults: Readonly<ControlPatch>;
  /** What is deliberately simplified or not modelled on this type, one line each (README, chooser tooltip, reviewers). */
  notModelled?: readonly string[];
  geometry: AircraftGeometry;
  mass: MassDef;
  limits: LimitsDef;
  controls: ControlSystemDef;
  airData: AirDataDef;
  autopilot: AutopilotGains;
  reference: ReferenceSpeeds;
  /** Plain data. */
  powerplant: PowerplantDef;
  /** FACTORY: builds the strip model. Called once per AeroModel (two per flight model). */
  aero(): AircraftAeroDefinition;
  /** FACTORY: spring objects and damping closures. Called once per flight model. */
  gear(): GearConfig;
  sim: SimProfile;
  input: InputProfile;
}

/** What only the browser needs. CLOSURES in panel, instrumentSystems and ui; `visual` and `audio` are plain. */
export interface AircraftPresentation {
  id: AircraftId;
  visual: AirframeVisualDef;
  panel: PanelDef;
  instrumentSystems: InstrumentSystemsDef;
  ui: UiProfile;
  audio: AudioProfile;
  /** Data-only Flight School type (D5). JSON round-trips. */
  training: AircraftTypeDef;
}

// ---------------------------------------------------------------------------------------------- geometry, mass, limits
/**
 * The geometric facts physics and the 3D model must agree on: today's core/c172.ts object, generalised.
 * C172S_GEOMETRY spreads `C172.wing`, `.hTail`, `.vTail`, `.fuselage`, `.gear` and adds the new discriminants
 * (`mount`, `allMoving`, `retractable`), `propellers` (from `C172.prop`), `restHeight` 1.25 and `bounds`.
 */
export interface AircraftGeometry {
  wing: {
    mount: 'high' | 'low';
    span: number; area: number; meanChord: number;
    /** Constant chord `rootChord` to `taperStartY`, linear to `tipChord` at the tip (taperStartY = 0: straight taper; = span/2: rectangular). */
    rootChord: number; tipChord: number; taperStartY: number;
    /**
     * Chord and quarter-chord x at span stations, ascending in y from 0 (centre line, extrapolated) to the last
     * station of the main panel; linear between; two stations with the same y are a step (DA42 at the nacelle).
     * When present it IS the planform (the type's aero.ts and visual.ts take theirs from it); rootChord and
     * tipChord then repeat its first and last chord and taperStartY is 0. Absent: the three numbers above (C172S).
     */
    breaks?: readonly { y: number; chord: number; qcX: number }[];
    /** Root quarter-chord point; z is the wing chord plane at the root. */
    quarterChord: { x: number; z: number };
    dihedral: number; rootIncidence: number; tipIncidence: number;
    /**
     * Fuselage half-width where the exposed panel begins: HALF THE FUSELAGE WIDTH at the wing (C172S 1.06 / 2).
     * The root rib may lie further out; the flap's innerY carries that (C152: rootY 0.51, flap from 0.562).
     */
    rootY: number;
    flap: {
      innerY: number; outerY: number; chordFraction: number; maxDeflection: number;
      /**
       * The pieces when there is more than one a side or their chord fractions differ (DA42: centre wing and
       * outer wing, the nacelle between). innerY / outerY are then the envelope. Absent: one piece.
       */
      segments?: readonly { innerY: number; outerY: number; chordFraction: number }[];
    };
    aileron: { innerY: number; outerY: number; chordFraction: number; maxUp: number; maxDown: number };
    /** Lift strut attach points, right side (high-wing Cessnas). */
    strut?: { fuselage: Vec3; wing: Vec3 };
    /**
     * Upturned tip / winglet. It starts at `rootY` (absent: span / 2) and is measured along itself; `span` stays
     * the published span (DA42: the winglet starts at the tip rib, inside the published span).
     */
    winglet?: { height: number; cant: number; rootChord: number; tipChord: number; sweep: number; rootY?: number };
  };
  hTail: {
    /** 'tTail': mounted on the fin tip; quarterChord.z is then the fin-tip junction. */
    mount: 'fuselage' | 'tTail';
    /** true: stabilator (the whole surface is `SurfaceState.elevator`). */
    allMoving: boolean;
    span: number; area: number; rootChord: number; tipChord: number;
    /** ROOT (centre-line) quarter-chord point. */
    quarterChord: { x: number; z: number };
    /** Quarter-chord x at the tip of a swept tailplane. Absent: quarterChord.x (straight quarter-chord line, C172S). */
    tipQuarterChordX?: number;
    incidence: number;
    /** Elevator (or, with allMoving, stabilator) travel; chordFraction is the elevator's (1 when allMoving). */
    elevator: { chordFraction: number; maxUp: number; maxDown: number };
  };
  vTail: {
    area: number; height: number; rootChord: number; tipChord: number;
    base: { x: number; z: number }; tip: { x: number; z: number };
    /**
     * maxDeflection: travel to the LEFT (and to the right when maxRight is absent). DA42: 27 deg left, 29 deg right.
     * On a swept hinge line every control deflection (rudder, elevator, aileron, flap) is STREAMWISE, i.e.
     * measured parallel to the waterline; the rigging figure (perpendicular to the hinge) goes in the comment.
     */
    rudder: { chordFraction: number; maxDeflection: number; maxRight?: number };
  };
  /**
   * tailX is the AFT-MOST point of the aircraft (noseX - tailX = length = the overall length), which may be a
   * rudder overhanging the tailcone: a type whose tailcone ends earlier says so in its geometry comment, and its
   * aero.ts body ends at the tailcone (C152: tailX -5.24, tailcone end -4.76).
   */
  fuselage: { length: number; noseX: number; tailX: number; maxWidth: number; maxHeight: number; pilotEye: Vec3 };
  /** Tyre contact points, struts fully extended, gear DOWN. maxNoseSteer: nosewheel angle at full pedal; castering nosewheel: the swivel stop. */
  gear: {
    nose: Vec3; leftMain: Vec3; rightMain: Vec3;
    noseWheelRadius: number; mainWheelRadius: number; maxNoseSteer: number;
    retractable: boolean;
  };
  /** One per engine, left to right. */
  propellers: readonly { hub: Vec3; diameter: number; blades: number; rotation: 1 | -1 }[];
  /**
   * Height of the reference point above level ground at rest, design loading, gear down, m (C172S: 1.25).
   * A test asserts |LandingGear.restingPose(...).height - restHeight| < 0.03.
   */
  restHeight: number;
  /** Camera / TAA fit: bounding radius about the reference point and zoom-to-fit size (about span + 2), m. */
  bounds: { radius: number; fitSize: number };
}

export interface PayloadDef {
  /** Occupants and baggage, kg, and their centroid (reference-point body axes). */
  payload: number; payloadPosition: Vec3;
  /** Fuel fraction this loading implies (maxGross on types that cannot carry full fuel and full seats). Default 1. */
  fuelFraction?: number;
}

export interface MassDef {
  /** Empty mass incl. unusable fuel and oil, kg. */
  empty: number;
  maxTakeoff: number; maxLanding: number;
  /**
   * Inertia, kg m^2, of the aircraft at `inertiaLoading`:
   *  about 'referencePoint' (C172S: the loading is assumed to balance there, which also places the empty CG), or
   *  about 'cg' (new types: Roskam estimates at a stated loading; then `emptyCg` is required).
   */
  inertia: { about: 'referencePoint' | 'cg'; Ixx: number; Iyy: number; Izz: number; Ixz: number };
  inertiaLoading: PayloadDef;
  /** Empty-aircraft CG, reference-point body axes. Absent: derived from `inertiaLoading` balancing at the reference point. */
  emptyCg?: Vec3;
  /** Half the lateral spacing of the two seats the payload is split over, m. */
  seatY: number;
  /** Named loadings: 'typical' = the flight model default; 'forward' = at the forward limit (stall tests); 'aft'; 'maxGross' = MTOW. */
  loadings: { typical: PayloadDef; forward: PayloadDef; aft: PayloadDef; maxGross: PayloadDef };
}

export interface OverspeedRule {
  /** 'none': not monitored (C172S, as today). 'warn': HUD chip while above the limit x (1 + margin) for longer than `time` s. No structural consequence this round. */
  consequence: 'none' | 'warn';
  margin: number; time: number;
}

export interface LimitsDef {
  /** Limit load factors flaps up; ultimate = limit x ultimateFactor (C172S: 3.8, -1.52, 1.5). */
  loadFactorPositive: number; loadFactorNegative: number; ultimateFactor: number;
  /** Limit load factors with any flap extended. Absent: the flaps-up limits (C172S, as today). */
  loadFactorPositiveFlaps?: number; loadFactorNegativeFlaps?: number;
  /** Structural failure above this CAS, m/s (C172S: Vne KIAS / 0.9, taken as CAS). */
  diveSpeedCas: number;
  /** Response time of the wing structure, s (0.03). */
  structureTime: number;
  /** Flap limit speed per detent, m/s CAS, same order as controls.flaps.detents (index 0 = clean = Infinity). */
  vfeCas: readonly number[];
  /** Retractable gear: extended limit, extend limit, retract limit, m/s CAS. */
  vleCas?: number; vloExtendCas?: number; vloRetractCas?: number;
  flapOverspeed: OverspeedRule;
  gearOverspeed: OverspeedRule;
}

// ---------------------------------------------------------------------------------------------- control system, air data, autopilot, reference speeds
/** How the pilot's pitch trim acts. In every kind the yoke/stick is an offset from the hands-off position. */
export type PitchTrimDef =
  /** Trim tab on a fixed-tailplane elevator (C172S, C152, DA42): elevator floats at -floatRatio x tab + alphaFloat. */
  | { kind: 'tab'; tabDown: number; tabUp: number; floatRatio: number }
  /**
   * Stabilator with a geared anti-servo tab that is also the trim tab (PA-34). Tab angle = gearing x elevator +
   * trim offset; trim offset range tabDown (nose-up) / tabUp. The surface floats at -floatRatio x offset +
   * alphaFloat, with floatRatio about 1 / gearing.
   */
  | { kind: 'antiServoTab'; tabDown: number; tabUp: number; floatRatio: number; gearing: number }
  /**
   * Spring bias in the elevator circuit, no tab (PA-38, DA20). The spring alone would hold the elevator at
   * delta_s = trim x (springUp | springDown); hands-off the elevator sits at
   *   (delta_s + (q / springQ) x alphaFloat(tailAlpha)) / (1 + q / springQ).
   * springUp is the TE-up (negative) deflection at full nose-up trim, springDown the TE-down one, rad.
   */
  | { kind: 'spring'; springUp: number; springDown: number; springQ: number };

export type FlapDriveDef =
  /** Bus-powered motor: moves toward the lever at `rate` rad/s while busVoltage > minVolts (C172S: 3 deg/s, 20 V). */
  | { kind: 'electric'; rate: number; minVolts: number }
  /** Hand lever: follows the lever at `rate` rad/s (about 1 rad/s), no electrical dependency. */
  | { kind: 'manual'; rate: number };

/** Coupling of pedals, rudder and nosewheel on the ground. */
export type SteeringLinkDef =
  /** Pedals steer the nosewheel through a bungee; a loaded nose tyre restrains a feet-off rudder (C172S, C152). */
  | { kind: 'bungee'; restraintQ: number; refLoad: number }
  /** Pedals steer the nosewheel rigidly (PA-38, PA-34, DA42): same model, stronger restraint. */
  | { kind: 'direct'; restraintQ: number; refLoad: number }
  /** Free-castering nosewheel (DA20): pedals do not steer; a feet-off rudder floats freely on the ground too. */
  | { kind: 'castering' };

export interface ControlSystemDef {
  elevator: {
    maxUp: number; maxDown: number;
    /** Hands-off float per rad of tail angle of attack, -Ch_alpha / Ch_delta (C172S 0.45); its alpha limit and the q at which it is half developed. */
    alphaFloat: number; floatAlphaLimit: number; floatQHalf: number;
  };
  aileron: { maxUp: number; maxDown: number; /** rigging as equivalent yoke input (C172S 0.0094; twins and every test-bed twin: 0) */ rigging: number };
  rudder: {
    /** Travel to the left (SurfaceState.rudder positive), and to the right when `maxRight` is absent, rad. */
    maxDeflection: number;
    /** Travel to the right when it differs (DA42: 29 deg against 27 deg left). Pedal -1 .. +1 maps each side to its own travel. */
    maxRight?: number;
    /** Ground-adjustable tab: rudder offset with pedals neutral, rad (C172S -1.5 deg). Twins: 0. */
    tabOffset: number;
    alphaFloat: number; floatLimit: number;
    /**
     * Cockpit rudder trim: rudder offset at rudderTrim = +1 (nose right, i.e. a NEGATIVE SurfaceState.rudder offset is applied), the tab angle shown at +1, and the lever rate, 1/s.
     * tabDeflectionLeft: the tab angle shown at rudderTrim = -1 when the tab travels differently each way (PA-34, DA42). Absent: tabDeflection.
     */
    trim?: { authority: number; tabDeflection: number; tabDeflectionLeft?: number; rate: number };
  };
  pitchTrim: PitchTrimDef;
  /** Trim actuation rate, rad/s of tab (or of spring datum). */
  trimRate: number;
  /** Absent: by hand (a wheel; works with a dead bus). 'electric': the pitch trim moves only while busVoltage > minVolts (DA20). */
  trimDrive?: { kind: 'electric'; minVolts: number };
  flaps: {
    maxDeflection: number;
    /** Detent deflections, rad, ascending, first = 0. Lever value of detent i = detents[i] / maxDeflection. */
    detents: readonly number[];
    drive: FlapDriveDef;
  };
  /** Dynamic pressure at which linkage stretch would halve the deflection, Pa (push-rod systems: larger). */
  stretchQ: { elevator: number; aileron: number; rudder: number };
  /** Surface rate limit, rad/s. */
  surfaceRate: number;
  steering: SteeringLinkDef;
}

export interface AirDataDef {
  /** POH airspeed calibration rows, knots, per flap deflection (degrees, ascending, first = 0). Empty = IAS equals CAS. */
  calibration: readonly { flapDeg: number; cas: readonly number[]; ias: readonly number[] }[];
  /** Mass the calibration was flown at (for the CAS -> lift-coefficient conversion), kg, and the wing area. */
  referenceMass: number;
  /** Airspeed indicator comes alive between these two speeds, kt (C172S: 18, 35). */
  asiAliveKt: readonly [number, number];
}

/** The constants of physics/autopilot.ts:64-88 and its defaults, per type. Gains are per unit of normalised control. */
export interface AutopilotGains {
  qRef: number;
  pitchKp: number; pitchKi: number; pitchKq: number;
  rollKp: number; rollKd: number; rollKi: number;
  headingK: number; altitudeK: number;
  vsKp: number; vsKi: number; speedKp: number; speedKi: number;
  throttleKp: number; throttleKi: number;
  ballKp: number; ballKi: number; yawKr: number;
  /** Rudder integrator clamp (C172S 0.6; twins 1.0 so an engine-out can be held). */
  rudderLimit: number;
  trimRate: number; pitchLimit: number;
  /** Yoke travel equivalent to one unit of trim wheel (C172S: floatRatio x tabDown / elevator.maxUp). */
  trimEquivalence: number;
  /** Defaults of AutopilotSettings for this type. */
  defaults: { airspeed: number; verticalSpeed: number; maxBank: number };
}

/** THE table of pilot speeds, KIAS, used by the HUD, scenarios, autoflight, input assists and the training def. */
export interface ReferenceSpeeds {
  vs0: number; vs1: number; vr: number; vx: number; vy: number; vglide: number; va: number;
  /** Limit per flap detent beyond clean (same order as detents[1..]). */
  vfe: readonly number[];
  vno: number; vne: number;
  /** Approach with approach flap, and final with landing flap. */
  vapp: number; vref: number;
  vcruise: number; vdownwind: number;
  /** Twins. vmca: flaps up (the red radial). */
  vmca?: number; vyse?: number; vsse?: number;
  /** Retractables. */
  vle?: number; vloExtend?: number; vloRetract?: number;
  /** Best glide ratio (for hints and tests). */
  glideRatio: number;
}

// ---------------------------------------------------------------------------------------------- sim and UI profiles
export type PresetId = 'cold' | 'groundRunning' | 'linedUp' | 'airborne' | 'approach';
export type AutoflightPhaseId = 'takeoff' | 'climb' | 'cruise' | 'approach' | 'rollout';

export interface AutoflightProfile {
  takeoff: {
    flapsDeg: number; rotateKias: number;
    /** Pitch target rises from [0] to [1] degrees over rotateBlendKt after rotateKias. */
    rotatePitchDeg: readonly [number, number]; rotateBlendKt: number;
    elevatorBias: number; pitchGain: number; pitchRateGain: number;
    aileronAliveKias: number;
    /** Height above restHeight at which the autopilot takes over (and 'climb' controls are applied), m. */
    handoverM: number;
  };
  climb: {
    kias: number; vsLimit: number;
    /** Throttle / power lever held through the climb phase. Absent: 1 (today). DA42: 0.92. */
    throttle?: number;
  };
  hold: { minKias: number; maxBankDeg: number; vsLimit: number };
  flare: { minHeightM: number; timeS: number; pitchRiseDeg: number; maxPitchDeg: number };
  /** Nose-holding elevator on the roll-out: clamp((kias - noseHoldKias[0]) / (noseHoldKias[1] - noseHoldKias[0]), 0, noseHoldMax). */
  rollout: { brake: number; noseHoldKias: readonly [number, number]; noseHoldMax: number };
  /** Ground steering of the scripted pilot: rudder (pedal-steered nosewheel) or differential brake blending to rudder. */
  steering: { kind: 'rudder' } | { kind: 'differentialBrake'; rudderEffectiveKias: number; brakeGain: number };
  /**
   * Centreline law (today 4, 1.5, look-ahead 60 m): rudder = clamp(headingGain x (heading error toward a point
   * lookAheadM ahead on the centreline) - yawRateGain x yaw rate, -1, 1). yawRateGain: rudder per rad/s of yaw
   * rate; the lateral offset enters only through the look-ahead distance.
   */
  centreline: { headingGain: number; yawRateGain: number; lookAheadM: number };
  /** Controls applied (applyControls) when a phase is entered: gear, propeller levers, carb heat, pump, cowl flaps. Plain data. */
  phaseControls: Partial<Record<AutoflightPhaseId, ControlPatch>>;
}

export interface SimProfile {
  scenario: {
    finalKias: number; finalFlapsDeg: number; baseFlapsDeg: number;
    cruiseKias: number; cruiseAltFt: number;
    downwindKias: number; downwindFlapsDeg: number;
    afterTakeoffKias: number;
    /** TAS floor for the trim that precedes a restore, m/s (C172S 25), and its fallback (50). */
    restoreMinTas: number; restoreFallbackTas: number;
  };
  /** Switch and lever presets layered on the trimmed controls (today's COLD / GROUND_RUNNING / ... literals). */
  presets: Record<PresetId, ControlPatch>;
  autoflight: AutoflightProfile;
  /** Trim used for the take-off trim setting: Vy climb at full power (C172S: vy, flaps 0). */
  takeoffTrim: { kias: number; flapsDeg: number };
}

/** CLOSURES. */
export interface UiProfile {
  controlName: 'yoke' | 'stick';
  /** Start-up card: [action, key hint] rows. */
  startupSteps: readonly (readonly [string, string])[];
  /** Why the starter would not work, or null. `engine` = index. */
  starterAdvice(c: ControlInputs, engine: number): string | null;
  /**
   * Discrete controls announced by toast when they change: "<label> <read>", one toast per switch. One generic
   * rule is not of that form and needs no member here: the two halves of a split master switch, ids
   * 'masterBattery' and 'alternator', are announced once as "Master switch ON / OFF" when they end up alike.
   */
  switches: readonly { id: string; label: string; read(c: ControlInputs): string }[];
  hud: {
    /**
     * Lever bars (THR / PROP / MIX / LOAD ...), value 0..1. style 'fill' (default): bar filled from the left.
     * 'mixture': the same in the mixture colour. 'marker': a mark at `read` along the bar with a centre line (trim).
     */
    levers: readonly { label: string; read(c: ControlInputs, s: AircraftState): number; text?(c: ControlInputs, s: AircraftState): string;
                       style?: 'fill' | 'mixture' | 'marker' }[];
    /** Numeric read-outs (RPM, MP, LOAD % per engine). */
    readouts: readonly { label: string; text(s: AircraftState): string }[];
  };
  /** Hints card rows that depend on the type: [what, keys]. */
  hints: readonly (readonly [string, string])[];
}
