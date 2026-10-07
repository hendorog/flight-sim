// THE FLIGHT SCHOOL CONTRACT (docs/instructor-spec.md sections 2 and 3). Frozen after review: every
// training module codes against these types; a change goes through the lead.
//
// Conventions
//   - Everything here is plain JSON-serialisable data unless it is an interface with methods (ports and
//     engine contracts at the end). Validation, resume and export rely on that.
//   - Lesson data is written in pilot units: kt (KIAS unless named otherwise), ft, fpm, degrees, NM and
//     seconds of SIM time. Only the telemetry layer converts from the SI flight-model state.
//   - Section 2 types appear exactly as specified. Where the spec is silent, additions are marked
//     "(contract addition)" with the reason, and are optional fields wherever they touch section 2 types.
//   - Later steps (avionics, ATC, more aircraft) extend this contract by declaration merging
//     (`TrainingEventMap`) and namespaced signal ids (`SignalId`), never by editing the engine.

import type { ScenarioId } from '../core/context';
import type { AircraftState, ControlInputs, Environment, WeatherSettings } from '../core/types';
import type { InstrumentReadings } from '../instruments/dynamics/instrumentSet';
import type { FlightSnapshot } from '../sim/resume';
import type { AutoflightPlan } from '../sim/scenarios';
import type { AreaId, GroundSpot, StartOptions, StartSpec } from '../sim/starts';

export type { AreaId, GroundSpot, StartOptions, StartSpec } from '../sim/starts';
export type { ScenarioId };

// =============================================================================================================
// 2.1 Aircraft type
// =============================================================================================================

export type AircraftTypeId = 'c172s' | (string & {});
/** V-speeds, KIAS (POH values for the C172S in src/training/aircraft/c172s.ts). */
export type VSpeedId =
  | 'Vs0' | 'Vs1' | 'Vr' | 'Vx' | 'Vy' | 'Vcc' | 'Vglide' | 'Va' | 'Vfe10' | 'VfeFull' | 'Vno' | 'Vne'
  | 'Vapp' | 'VappFlapsUp' | 'Vref' | 'VshortField' | 'Vcruise' | 'Vslow' | 'VsteepTurn' | 'Vdescent'
  | 'Vdownwind' | 'Vtaxi';
/** Type-specific numbers lessons refer to by name (`{ setting: 'cruiseRpm' }`). */
export type AircraftSettingId =
  | 'patternAglFt' | 'cruiseRpm' | 'descentRpm' | 'circuitRpm' | 'runupRpm' | 'magDropMaxRpm' | 'magDiffMaxRpm'
  | 'approachFlapLever' | 'takeoffFlapLever' | 'shortFieldFlapLever' | 'maxDemoCrosswindKt';
export type ChecklistId =
  | 'beforeStart' | 'engineStart' | 'afterStart' | 'runup' | 'beforeTakeoff' | 'afterTakeoff' | 'hasell'
  | 'downwind' | 'final' | 'afterLanding' | 'shutdown' | 'engineFailure' | 'forcedLandingSecurity'
  | 'nightLights' | (string & {});

export interface ChecklistItem {
  id: string;
  challenge: string;             // 'Mixture'
  response: string;              // 'Rich'
  check?: Pred;                  // verified from state; absent = confirmed by Enter
  critical?: boolean;            // missing it caps the checklist grade at 1 (fuel selector, mixture, flaps for take-off)
  lookout?: boolean;             // satisfied by a clearing turn: step.turnDeg magnitude >= 90 within the step
  // ---- (contract addition, owner playtest: "the controls are not pointed out ... state whether something needs
  //      to be on or off and why") Guided checklists. All optional: the engine infers what it can from `check`.
  /**
   * The cockpit control (or instrument) this item is about: the UI points it out (callout) and the camera glances
   * at it. null: nothing in the cockpit to point at (the propeller area, the lookout). Absent: inferred.
   */
  control?: PointTarget | null;
  /**
   * The required state; satisfied when it holds (no Enter needed). null: it cannot be seen from the aircraft
   * state, so Enter confirms it. Absent: `check`.
   */
  state?: Pred | null;
  /**
   * Key that operates it: an InputAction id ('avionics'), a literal key label ('Shift+O'), or a pair picked by
   * which side of the required band the control is on (throttle F3 below, F2 above). null: no key (an
   * instrument, an Enter item). Absent: inferred from `control` and the state.
   */
  key?: string | null | ChecklistKeyPair;
  /** Why, spoken the first time the item is read in a run (15 words or fewer). */
  why?: CueRef;
  /** The required state as shown on the callout ('OFF', 'BOTH', '1,000 RPM'). Absent: from `response`. */
  stateLabel?: string;
}
/** ChecklistItem.key for a band (an rpm, a lever position): `raise` below it, `lower` above it (InputAction ids). */
export interface ChecklistKeyPair { raise: string; lower: string }
export interface ChecklistDef { id: ChecklistId; title: string; items: ChecklistItem[] }

export interface AircraftTypeDef {
  id: AircraftTypeId;
  name: string;                  // 'Cessna 172S Skyhawk SP'
  icaoType: string;              // 'C172'
  registration: string;          // fictitious 'N172FS' (FAA) / 'G-FSCK' (EASA); chosen by authority
  classRating: 'SEP' | 'MEP';    // (multi-aircraft addition) widened: 'MEP' iff two engines
  vspeeds: Record<VSpeedId, number>;           // KIAS
  settings: Record<AircraftSettingId, number>;
  flapDetentsDeg: number[];                    // [0, 10, 20, 30]
  flapLeverForDeg: Record<number, number>;     // detent deg -> ControlInputs.flaps lever value
  limits: { gPos: number; gNeg: number; maxDemoCrosswindKt: number };
  checklists: Record<ChecklistId, ChecklistDef>;
  envelope: SafetyEnvelope;                    // defaults for the safety monitor (section 3.8)
  demoTuning?: Partial<{ maxBankDeg: number; rollRateDps: number }>;
  // ---- (multi-aircraft addition, contract 3.9) Data-only members of the other types. All optional: absent on
  //      the C172S, whose numbers stay where lessons read them. Plain JSON like the rest of the def.
  /** Speeds a type has beyond the 22 every lesson relies on (twins, retractables), KIAS. */
  vspeedsExt?: Partial<Record<ExtVSpeedId, number>>;
  /** Numbers beyond the 11 settings (manifold pressure, % load, redline). */
  settingsExt?: Partial<Record<ExtSettingId, number>>;
  /** Fictitious registration by authority. Absent: `registration` (the C172S's pair is in career/logbook.ts). */
  registrations?: Partial<Record<AuthorityId, string>>;
  /** What the aeroplane has, for instructor wording and lint. Absent: the C172S's. */
  systems?: AircraftSystemsDef;
  /** Whether the Flight School teaches in this type. Absent: as SCHOOL_AIRCRAFT says (training/aircraft/registry.ts). */
  school?: SchoolSupport;
  /** Geometry the telemetry and event detectors need. Absent: the C172S values used today. */
  geometry?: { restAglFt: number; noseXM: number; mainsBody: { x: number; z: number } };
  /** Per-type wording of the cockpit's controls (engine/controls.ts CONTROL_INFO / INSTRUMENT_INFO). */
  controls?: Partial<Record<PointTarget, { label?: string; where?: string; action?: string | null }>>;
}

/** (multi-aircraft addition) V-speeds outside `VSpeedId`: never required, and no lesson names them yet. */
export type ExtVSpeedId =
  | 'Vmca' | 'Vsse' | 'Vyse' | 'Vxse' | 'Vlo' | 'Vlr' | 'Vle' | 'VfeApp'
  | 'VrShort' | 'VslowCruise' | 'VflapRetract';
/** (multi-aircraft addition) Settings outside `AircraftSettingId`. */
export type ExtSettingId =
  | 'redlineRpm' | 'idleRpm' | 'groundIdleMaxRpm' | 'approachRpm' | 'cruiseMapInHg' | 'climbMapInHg' | 'cruiseLoadPct';

/** (multi-aircraft addition) What the aeroplane has, as plain data. */
export interface AircraftSystemsDef {
  engines: 1 | 2;
  induction: 'carburettor' | 'injected' | 'fadecDiesel';
  carbHeat: boolean;
  primer: 'manual' | 'pump' | 'none';
  electricFuelPump: boolean;
  /** Positions of the pilot's fuel selector (per engine on a twin). */
  fuelSelector: readonly ('off' | 'on' | 'left' | 'right' | 'both' | 'crossfeed')[];
  prop: 'fixed' | 'constantSpeed' | 'constantSpeedFeathering' | 'fadec';
  mixture: boolean;
  magnetos: boolean;
  cowlFlaps: boolean;
  gear: 'fixed' | 'retractable';
  steering: 'nosewheel' | 'castering';
  flapControl: 'electric' | 'manualLever';
  /** Spoken stage names by detent, in the order of flapDetentsDeg: ['up', '10', '20', '30'] or ['up', 'take-off', 'landing']. */
  flapStageNames: readonly string[];
  inceptor: 'yoke' | 'stick';
  wing: 'high' | 'low';
}

/** (multi-aircraft addition) Whether the Flight School can teach in a type (decision D5: the C172S only). */
export interface SchoolSupport {
  /** The PPL syllabus (L01-L21, N1, challenges) may be flown in this type. */
  syllabus: boolean;
  /** Shown when `syllabus` is false ('Twin-engine training is not available yet.'). */
  reason?: string;
}

// =============================================================================================================
// 2.2 Tolerances and standards
// =============================================================================================================

export type AuthorityId = 'easa' | 'faa';
/** Grading standard of an exercise: early lessons are graded against wider `training` bands. */
export type Standard = 'training' | 'test' | 'commercial';
export type TolKey =
  | 'altitude' | 'altitudeEngineOut' | 'heading' | 'headingEngineOut' | 'speed' | 'speedClimbApproach'
  | 'slowFlightSpeed' | 'bankMedium' | 'bankSteep' | 'rollout' | 'vs' | 'touchdownZoneFt' | 'touchdownZoneShortFt'
  | 'centrelineM' | 'glidepathFt' | 'stallHeightLossFt' | 'navAltitude' | 'navHeading' | 'xtkNm' | 'etaMin'
  | 'instrAltitude' | 'instrHeading' | 'turnRate' | 'sinkFpm';
export interface Tol { minus: number; plus: number }     // allowed below / above the target
export type ToleranceTable = Record<AuthorityId, Record<Standard, Record<TolKey, Tol>>>;
/** In lesson data: a key, a key scaled, a literal symmetric number, or a literal band. */
export type TolRef = TolKey | { key: TolKey; scale: number } | number | Tol;

// =============================================================================================================
// 2.3 Telemetry signals
// =============================================================================================================

export type SignalKind = 'number' | 'angle' | 'bool' | 'enum';
export type SignalValue = number | boolean | string;
export type CoreSignalId =
  // indicated (what the student sees; grading uses these)
  | 'asiKt' | 'altFt' | 'vsiFpm' | 'hdgDeg' | 'aiPitchDeg' | 'aiBankDeg' | 'turnRate' | 'ball' | 'rpm'
  | 'oilPsi' | 'oilTempF' | 'fuelLGal' | 'fuelRGal' | 'suctionInHg' | 'ammeterA'
  // truth (safety, geometry, events)
  | 'kias' | 'tasKt' | 'gsKt' | 'altMslFt' | 'aglFt' | 'hafFt' /* height above field */ | 'vsFpm'
  | 'pitchDeg' | 'bankDeg' /* + right */ | 'hdgTrueDeg' | 'trackDeg' | 'driftDeg' /* heading - track */
  | 'aoaDeg' | 'gLoad' | 'stallWarn' | 'stallFrac' | 'onGround' | 'mainsOnGround' | 'noseOnGround' | 'crashed'
  | 'engineRunning' | 'pitchRateDps' | 'rollRateDps'
  // controls
  | 'throttle' | 'mixture' | 'flapLever' | 'flapsDeg' | 'trim' | 'elevator' | 'aileron' | 'rudder' | 'brakes'
  | 'parkingBrake' | 'mags' /* 0 off, 1 R, 2 L, 3 both */ | 'starter' | 'master' | 'alternator' | 'avionics'
  | 'fuelSel' /* 'off'|'left'|'right'|'both' */ | 'fuelPump' | 'pitotHeat' | 'lightNav' | 'lightBeacon'
  | 'lightStrobe' | 'lightLanding' | 'lightTaxi' | 'qnhErrHpa' /* kollsman - QNH */ | 'dgErrDeg' /* DG - magnetic */
  // airfield geometry (runway 07 frame; core/world.ts runwayCoords)
  | 'rwyAlongM' /* from the 07 threshold, + along 07 */ | 'rwyAcrossM' /* + right of the 07 centreline */
  | 'distAimFt' /* along-track beyond the aim point (scenarios.ts AIM_POINT) */ | 'gpDevFt' /* + above 3° path */
  | 'onRunway' | 'onPaved' | 'pastHoldLine' | 'circuitLeg' | 'downwindOffsetNm' | 'headwindKt' | 'crosswindKt'
  // derived
  | 'untrimmedS' | 'studentInput' | 'night' | 'sunElevDeg' | 'timeScale'
  // per step (reset on step entry)
  | 'step.t' | 'step.turnDeg' /* signed heading change integrated */ | 'step.altChangeFt' | 'step.maxBankAbsDeg'
  // navigation (route in the run)
  | 'nav.xtkNm' | 'nav.distNm' | 'nav.bearingDeg' | 'nav.etaErrMin' | 'nav.leg';
export type SignalId = CoreSignalId | `${string}.${string}`;   // provider-namespaced: 'xpdr.code', 'atc.clearedLand'
/** Left-hand circuit for runway 07 (rules in section 2.3; src/training/geo/circuit.ts). */
export type CircuitLeg = 'none' | 'ground' | 'upwind' | 'crosswind' | 'downwind' | 'base' | 'final' | 'deadside';

export interface SignalDef {
  id: SignalId; kind: SignalKind; unit: string;
  hyst: number;              // default comparison hysteresis, in the signal's unit
  rateTau?: number;          // time constant (s) of the filtered rate used by the coach's "correcting" test
  describe: string;
}
/** Everything a provider samples from, once per rendered frame (after panel.update). */
export interface TelemetrySources {
  state: Readonly<AircraftState>; controls: Readonly<ControlInputs>;
  readings: Readonly<InstrumentReadings> | null;   // null in headless tests: indicated signals fall back to truth
  weather: Readonly<WeatherSettings>; env: Environment; aircraft: AircraftTypeDef;
  studentInput: boolean; timeScale: number; route: NavRoute | null;
  /** (contract addition) The ground route being taxied (taxi.* signals); absent or null: none. */
  taxiRoute?: TaxiRoute | null;
}
export interface SignalProvider {
  readonly id: string;                      // 'core', 'geo', 'nav'; step 2 adds 'xpdr', 'com'
  readonly defs: readonly SignalDef[];
  sample(out: SignalFrame, src: TelemetrySources, dt: number): void;
}
export type SignalFrame = Record<string, SignalValue>;    // one object per run, mutated in place

// =============================================================================================================
// 2.4 Values and the predicate language (semantics: src/training/engine/predicates.ts)
// =============================================================================================================

/** A number in a lesson, resolved at run time. Angles wrap automatically when compared with an angle signal. */
export type Ref =
  | number
  | { var: string; add?: number }
  | { vspeed: VSpeedId; add?: number }
  | { setting: AircraftSettingId; add?: number }
  | { field: 'elevFt'; add?: number }              // aerodrome elevation (394 ft)
  | { sig: SignalId; add?: number };
/** A signal named directly, or through a run variable holding its id. */
export type SigRef = SignalId | { var: string };

/**
 * Predicates, compiled once per step into closures with their own state:
 * - `op`: `x > v` becomes true when x > v and false only when x < v - hyst (default: the signal's hyst);
 *   the other operators are symmetric.
 * - `near`: e = x - target (wrapped to ±180 for angles); true when -tol.minus <= e <= tol.plus, false when it
 *   leaves the band by more than hyst.
 * - `held`: accumulates sim time while the child is true; a drop-out of at most graceS (default 0.25 s)
 *   pauses the timer instead of zeroing it.
 * - `ever` latches since step entry. `event` scans the training bus since the step mark, filtering `where`
 *   fields (number ranges inclusive, strings and booleans exact); true at `count` (default 1).
 * - `all` / `any` evaluate every child every tick (no short-circuit), so nested timers stay correct.
 * - A missing or NaN signal evaluates false.
 */
export type Pred =
  | { sig: SigRef; op: '<' | '<=' | '>' | '>='; v: Ref; hyst?: number }
  | { sig: SigRef; eq: number | string | boolean }
  | { sig: SigRef; near: Ref; tol: TolRef; hyst?: number }       // angle-aware band
  | { all: Pred[] } | { any: Pred[] } | { not: Pred }
  | { held: Pred; s: number; graceS?: number }                  // true for s continuous sim seconds
  | { ever: Pred }                                              // latched since step entry
  | { event: TrainingEventName; where?: Record<string, [number, number] | string | boolean>; count?: number }
  | { elapsed: number }                                         // step time >= N s
  | { turned: number }                                          // |step.turnDeg| >= N
  | { authority: 'student' | 'instructor' }
  | { speechIdle: true }
  | { leg: CircuitLeg | CircuitLeg[] }
  | { exerciseGrade: string; atLeast: Grade }
  | { const: boolean };

// =============================================================================================================
// 2.5 Training events
// =============================================================================================================

export interface TrainingEventMap {
  'touchdown': { wheel: 'nose' | 'left' | 'right'; sinkFpm: number };       // every wheel contact (SimEvents)
  'mainsTouchdown': TouchdownData;                                          // first main contact of a landing
  'landing': LandingData;                                                   // LandingDetector summary
  'liftoff': { kias: number; rwyAlongM: number };
  'stopped': {};                                                            // gs < 1 kt for 2 s on the ground
  'stallWarnOn': { kias: number }; 'stallWarnOff': {};
  'stallBreak': { kias: number; altFt: number };   // stallFrac >= 0.5, or stallWarn with pitch rate < -4°/s
  'goAround': { aglFt: number };                   // throttle >= 0.9 below 500 ft AGL near the runway, then vs > 0 within 5 s
  'crash': { reason: string };
  'thresholdCrossed': { heightFt: number; kias: number };
  'rolloutComplete': { hdgErrDeg: number };        // |bank| < 3° for 2 s after a task's turn
  'student.ack': {}; 'student.handback': {}; 'student.sayAgain': {}; 'student.showMe': {};
  'authority': { to: 'student' | 'instructor'; reason: 'plan' | 'intervention' | 'handback' };
  /** `kind` (contract addition): 'safety' (envelope, default when absent) or 'limit' (a TaskLimit, `limitId`). */
  'intervention': { rule: string; kind?: 'safety' | 'limit'; limitId?: string };
  'checklist.item': { checklist: ChecklistId; item: string; ok: boolean };
  'checklist.done': { checklist: ChecklistId; missed: string[] };
  'fault': { id: string; severity: 'minor' | 'major' | 'critical' };
  'hint': { topic: string; rung: 1 | 2 | 3 };
  'demo.done': { result: 'done' | 'aborted' | 'timeout' };
  'step.enter': { phase: string; step: string };
  'step.exit': { phase: string; step: string; result: 'success' | 'fail' | 'timeout' | 'skipped' };
  'speech.start': { id: string; actor: ActorId }; 'speech.end': { id: string; result: 'done' | 'interrupted' | 'dropped' };
}
export type TrainingEventName = keyof TrainingEventMap;
/** Step-exact state at the first main-wheel contact (built inside SimPhysics.stepOnce's touchdown event). */
export interface TouchdownData {
  sinkFpm: number; kias: number; firstWheel: 'nose' | 'left' | 'right'; distAimFt: number; rwyAcrossM: number;
  driftDeg: number; bankDeg: number; pitchDeg: number; onRunway: boolean;
}
export interface LandingData extends TouchdownData {
  kiasAt50Ft: number; gpDevFtAt300: number; bounces: number; maxBounceFt: number; floatS: number;
  rolloutMaxAcrossM: number; fullStop: boolean; crashed: boolean;
}

// =============================================================================================================
// 2.6 Cues (what the instructor says)
// =============================================================================================================

export type ActorId = 'instructor' | 'examiner' | 'student' | 'tower' | 'ground' | 'atis' | 'system';
export type Channel = 'cabin' | 'radio';
/** Lower number = more important. (A real enum at run time under isolatedModules; import it as a value.) */
export const enum Priority { Safety = 0, Instruction = 1, Coach = 2, Praise = 3 }
export type CueId = string;                    // key into src/training/content/lines.ts
/**
 * Templates in text/speak: `{name:format}`; name is a variable, a signal, `vspeed.Vy`, `setting.cruiseRpm` or
 * `tol.altitude`; formats alt, hdg, kt, fpm, deg, rpm, dev:alt, side, dir, nm, min, qnh (section 3.7.3).
 * Every line is at most 20 words.
 */
export interface InlineCue {
  text: string | string[];                     // caption text with templates; an array gives variants
  speak?: string | string[];                   // synthesiser text when it differs (same templates)
  actor?: ActorId;                             // default: the lesson persona
  channel?: Channel;                           // default from actor ('tower' -> radio)
  priority?: Priority;                         // default Instruction
  interrupt?: boolean;                         // may cut lower-priority speech
  ttlS?: number;                               // drop if not started within (default: Safety 2, Instruction 8, Coach 3, Praise 3)
  key?: string; cooldownS?: number;            // dedupe / cooldown
}
export type CueRef = CueId | InlineCue | { id: CueId; vars: Record<string, Ref> };

// =============================================================================================================
// 2.7 Demonstration scripts (the copilot)
// =============================================================================================================

export interface DemoAp {                     // pilot units; the copilot converts to AutopilotSettings (SI)
  lateral?: 'off' | 'wingLeveler' | 'heading' | 'bank';
  vertical?: 'off' | 'pitch' | 'verticalSpeed' | 'altitude' | 'airspeed';
  hdgDeg?: Ref; bankDeg?: Ref; maxBankDeg?: number; pitchDeg?: Ref; vsFpm?: Ref; altFt?: Ref; kias?: Ref;
  autothrottle?: boolean; yawDamper?: boolean; autoTrim?: boolean;
}
export type DemoControl = 'throttle' | 'flapsDeg' | 'mixture' | 'trim' | 'elevator' | 'aileron' | 'rudder' | 'brakes';
/** Move a control linearly to `to` over `overS` sim seconds. */
export interface Ramp { to: Ref; overS: number }
/** `timeoutS` is mandatory on every `until` segment: a demo can never hang. */
export type DemoSegment =
  | { kind: 'ap'; ap: DemoAp; set?: Partial<Record<DemoControl, number | Ramp>>; say?: CueRef; until: Pred; timeoutS: number }
  | { kind: 'autoflight'; plan: AutoflightPlan; say?: CueRef; until: Pred; timeoutS: number }   // reuses sim/autoflight.ts
  | { kind: 'raw'; hold: Partial<Record<'elevator' | 'aileron' | 'rudder' | 'throttle', number>>; ap?: DemoAp; forS: number; say?: CueRef }
  | { kind: 'pulse'; control: 'elevator' | 'aileron' | 'rudder'; amount: number; holdS: number; say?: CueRef }
  | { kind: 'pause'; s: number; say?: CueRef };
/** `abortWhen` (and the global safety envelope) switch to the recovery script. */
export interface DemoScript { id: string; segments: DemoSegment[]; abortWhen?: Pred }

// =============================================================================================================
// 2.8 Starts and weather (StartSpec, StartOptions, GroundSpot, AreaId live in src/sim/starts.ts, re-exported above)
// =============================================================================================================

export type WeatherPresetId = 'calm' | 'smooth' | 'light' | 'xwind10' | 'xwind15' | 'gusty' | 'hazy' | 'night' | 'imc';
/**
 * A preset plus optional overrides and ranges. Ranges are sampled with a seeded PRNG
 * (seed = hash(lessonId, attemptNumber)); v1 winds stay within 040-160° so runway 07 is into wind.
 */
export interface WeatherSpec {
  preset: WeatherPresetId;
  override?: Partial<WeatherSettings>;
  windDirDeg?: [number, number]; windKt?: [number, number]; gustKt?: [number, number]; turbulence?: [number, number];
}

// =============================================================================================================
// 2.9 Lessons, phases and steps
// =============================================================================================================

export type Grade = 1 | 2 | 3 | 4;   // 1 Not yet, 2 Satisfactory (competent), 3 Good, 4 Excellent
export type SkillId =
  | 'effectsOfControls' | 'groundOps' | 'straightLevel' | 'climb' | 'descent' | 'turns' | 'slowFlight' | 'stalls'
  | 'takeoff' | 'circuit' | 'approach' | 'landing' | 'goAround' | 'efato' | 'glideApproach' | 'steepTurn'
  | 'forcedLanding' | 'shortField' | 'crosswind' | 'instrument' | 'unusualAttitude' | 'navigation' | 'night'
  | 'checks' | 'airmanship' | 'radio' | 'transponder';
/** full: all coach rules; reduced: priority 0-2, 10 s gap; minimal: 0-1, 15 s gap; silent: safety only. */
export type CoachLevel = 'full' | 'reduced' | 'minimal' | 'silent';
export type InstrumentId = 'asi' | 'ai' | 'alt' | 'tc' | 'dg' | 'vsi' | 'tach' | 'ball' | 'flaps' | 'fuel' | 'oil';

export interface Lesson {
  id: string;                         // 'L04'
  version: number;                    // bump on content change; records keep the version flown
  number: number; title: string;
  syllabusRef: { easa: string; faa: string };       // 'Ex 7 & 8', 'ACS VI.B-C'
  stage: 'handling' | 'circuits' | 'advanced' | 'navigation' | 'test' | 'rating';
  kind: 'dual' | 'solo' | 'check' | 'test';         // check: instructor, coach silent, gate; test: examiner
  persona: 'instructor' | 'examiner';
  requires: string[];                 // lesson ids that must be Competent
  requiresEndorsements?: EndorsementId[];
  requiredFor?: AuthorityId[];        // N1: ['faa'] -> a prerequisite of L20 only under FAA
  aircraft: AircraftTypeId[] | 'any';
  estMinutes: number;
  start: StartSpec; startOptions?: StartOptions;
  weather: WeatherSpec;
  rules: LessonRules;
  briefing: Briefing;
  vars?: Record<string, Ref>;
  route?: NavRoute;                   // navigation lessons
  exercises: ExerciseDef[];
  flow: PhaseDef[];                   // the first phase is the entry
  awards?: Award[];
  debriefTips?: Record<string, string>;   // `${criterionId}.${pattern}` -> tip
  /**
   * (contract addition) The debrief's "Next time" look-ahead line (section 3.4, debrief item 5). The spec
   * names the line but gives the Lesson no field for it; absent -> the debrief uses a generic line.
   */
  lookAhead?: string;
}
export interface LessonRules {
  coachLevel: CoachLevel;             // phases may lower it
  autopilot: 'forbidden' | 'allowed';
  maxTimeScale: number;               // default 1; phases may raise it (nav cruise 4)
  instructorSaves: boolean;           // false for solo, check and test kinds (forced)
  envelope?: Partial<SafetyEnvelope>;
  maxDurationS: number;               // 'running out of time' at this sim time; outcome 'incomplete'
  hood?: boolean;                     // instrument view restriction available in this lesson
}
export interface Briefing {
  aim: string;
  points: string[];                   // 3-5
  numbers: { label: string; value: Ref; unit: 'kt' | 'ft' | 'deg' | 'rpm' | 'fpm' | 'nm' | '' }[];
  tolerances: TolKey[];               // rendered for the lesson's standard and the test standard
  airmanship: string[];
  keys: string[];                     // InputAction or training key ids, shown with their bindings
  diagram?: { kind: 'circuit' | 'turn' | 'climb' | 'glide' | 'stall' | 'landingZone' | 'pfl'; bankDeg?: number };
  more?: string;                      // theory text behind a disclosure
  spoken: CueRef;                     // 30-45 s summary
}
export interface ExerciseDef {
  id: string; title: string; skill: SkillId;
  mode: 'demo' | 'practice' | 'assessed';
  standard: Standard;
  required: boolean;                  // counts toward lesson competency
  weight: number;                     // for the overall-impression line only
  testSection?: 1 | 2 | 3 | 4 | 5;    // skill test section
}
export type EndorsementId = 'firstSolo' | 'soloAreaSolo' | 'crosswind15' | 'night' | 'ppl' | (string & {});
export interface Award { id: EndorsementId; when: 'competent' | 'testPass'; title: string }

export interface PhaseDef {
  id: string; title: string;
  steps: StepDef[];
  checkpoint?: boolean;               // default true when the phase contains a task step
  repeat?: { max: number; until?: Pred };     // re-run the phase until `until` holds at phase end
  retryFrom?: StartSpec;              // reposition used by "try again" instead of the checkpoint
  coachLevel?: CoachLevel;
  maxTimeScale?: number;
  lowLevel?: boolean;                 // disables the minimum-height envelope rule (circuits, landings, PFL)
}

/** Fields shared by every step kind (not exported by name in the spec; exported here for the DSL builders). */
export interface StepBase {
  id: string;
  when?: Pred;                        // entry condition; the step waits as 'pending' until true
  whenPrompt?: { afterS: number; cue: CueRef; everyS?: number };
  timeoutS?: number; onTimeout?: Outcome;      // default: 'fail' for task, 'next' otherwise
  pf?: 'student' | 'instructor';      // the runner performs the handover before the step starts
}
/**
 * How a step exits: next advances (phase end evaluates repeat.until); retry re-enters (counting attempts,
 * then fail -> next); goto jumps to a step id or 'phase:<id>'; demo+thenRetry runs the demo, hands back and
 * re-enters; instructorTakes runs authority.take('plan').
 */
export type Outcome = 'next' | 'retry' | 'fail' | 'end' | { goto: string /* step id or 'phase:<id>' */ }
  | { demo: string; thenRetry: true } | 'instructorTakes';

/**
 * (contract addition) Point at a control or instrument while a step runs: the UI shows a callout at it (name,
 * the state wanted, the key) and the camera glances at it if it is off screen. `pointState` is the state shown
 * ('ON', '1,000 RPM'); `pointWhen` ends the callout once it holds (else it ends with the step).
 */
export interface PointFields { point?: PointTarget; pointState?: string; pointWhen?: Pred }
export interface SayStep extends StepBase, PointFields { kind: 'say'; cue: CueRef; wait?: boolean }
export interface WaitStep extends StepBase, PointFields { kind: 'wait'; until: Pred; cue?: CueRef; prompt?: CueRef }
export interface CaptureStep extends StepBase { kind: 'capture'; vars: Record<string, Ref | SigRef> }
export interface SetupStep extends StepBase {
  kind: 'setup'; reposition?: StartSpec; weather?: WeatherSpec; controls?: Partial<ControlInputs>;
  holds?: Holds | null; hood?: boolean; timeScaleMax?: number; cue?: CueRef;
  /**
   * (release addition) Move the elevator trim by this much (-1..1 travel, + nose up) from where it is now,
   * without a reposition: puts the aircraft out of trim for a trimming exercise. Ignored with `reposition`.
   */
  trimDelta?: number;
}
export interface HandoverStep extends StepBase { kind: 'handover'; to: 'student' | 'instructor'; ackTimeoutS?: number }
export interface DemoStep extends StepBase { kind: 'demo'; script: string | DemoScript; followMeThrough?: boolean; intro?: CueRef; highlight?: InstrumentId[] }
export interface ChecklistStep extends StepBase { kind: 'checklist'; checklist: ChecklistId; mode: 'challengeResponse' | 'flow' | 'silent'; exercise?: string }
/** Evaluated once at entry: the first matching case, else `else` (step id or 'phase:<id>'). */
export interface BranchStep extends StepBase { kind: 'branch'; cases: { when: Pred; goto: string }[]; else: string }
export interface EndStep extends StepBase { kind: 'end'; cue?: CueRef }
export interface TaskStep extends StepBase, PointFields {
  kind: 'task';
  exercise: string;                   // ExerciseDef id this task scores
  brief: CueRef;                      // spoken on entry
  prompt?: CueRef;                    // Say again (default: brief, re-rendered with live values)
  card: TaskCard;
  goal: Pred;                         // success: goal true and step time >= minS
  minS?: number;
  criteria: Criterion[];
  coach?: (CoachPresetId | CoachRule)[];
  faults?: FaultRule[];
  holds?: Holds;
  highlight?: InstrumentId[];
  on?: { event: TrainingEventName; where?: Record<string, [number, number] | string | boolean>; cue?: CueRef; goto: string }[];
  attempts?: number;                  // with onFail 'retry'
  onSuccess?: { cue?: CueRef; next?: Outcome };
  onFail?: { cue?: CueRef; next?: Outcome };
  /** (contract addition) Running instructor feedback for this task (ab initio commentary). */
  feedback?: TaskFeedback;
  /** (contract addition) Lesson limits: exceeding one triggers a limit intervention (take control, restore, hand back). */
  limits?: TaskLimit[];
  /**
   * (contract addition) Taxi guidance for this task: a ground route over the taxiway centrelines to `to`,
   * position-based instructor calls, the taxi HUD and the taxi coach rules. Absent: inferred for a task whose
   * card title names a holding point ("Taxi to holding point A1") in a lesson on the ground.
   */
  taxi?: TaxiGuidance;
}
/** (contract addition) TaskStep.taxi. */
export interface TaxiGuidance {
  /** Destination: a holding point (hold short of runway 07/25 on connector A1..A4) or the parking spot. */
  to: TaxiDestination;
  /** Directional calls by the instructor (default true in dual lessons). */
  calls?: boolean;
  /** Taxi coach rules: speed > 15 kt, off the centreline > 3 m, the brake test (default true in dual lessons). */
  coach?: boolean;
  /** The route briefed by the guide when it starts ("Our route: ..."); false when a say step has briefed it. */
  brief?: boolean;
}
/** (contract addition) Instructor feedback while a task is in progress. */
export interface TaskFeedback {
  /** Spoken when the task becomes active (after 'brief'), e.g. "Go ahead: raise the nose five degrees." Optional. */
  start?: CueRef;
  /** Progress remarks: each fires once when 'when' first holds (and 'minT' s into the task), in list order, with a
   *  minimum gap of 2 s between them; priority Coach. e.g. "That's it, the nose is coming up." */
  milestones?: { id: string; when: Pred; cue: CueRef; minT?: number }[];
  /** Spoken immediately when the goal is met (before onSuccess), e.g. "Good. That's the primary effect of elevator." */
  success?: CueRef;
  /** Encouragement while the goal is not yet met after 'afterS' (default 12) s of silence, repeated at most
   *  every 'everyS' (default 15) s, e.g. "Keep going: a little more back pressure."
   *  (contract addition) `missing`: what is still to do, in order; the nudge then names the first entry whose
   *  `when` holds instead of repeating itself ({missing} in the cue is its text; its `cue`, when given, is said
   *  instead). A reminder never repeats the previous one's wording; after two the instructor offers help ([). */
  nudge?: { cue: CueRef; afterS?: number; everyS?: number; missing?: MissingItem[] };
}
/** (contract addition) One thing the student still has to do (TaskFeedback.nudge.missing). */
export interface MissingItem {
  /** True while it is still missing ("the mixture is still lean"). */
  when: Pred;
  /** Short noun phrase for {missing}: 'the mixture'. */
  text: string;
  /** Said instead of the nudge while this is the first missing item: "The mixture is still lean: push it fully in, the red knob." */
  cue?: CueRef;
  point?: PointTarget;
}
/** (contract addition) A lesson limit for this task. Exceeding it (for 'forS', default 1.5 s) triggers a LIMIT
 *  INTERVENTION: the instructor takes control, restores straight and level, then hands back and the task restarts. */
export interface TaskLimit {
  id: string; sig: SignalId; min?: Ref; max?: Ref; forS?: number;
  /** What she says when taking control, e.g. "I have control. That's a bit much bank for now." */
  cue: CueRef;
}
export interface TaskCard { title: string; targets: { label: string; sig: SignalId; value: Ref; tol?: TolRef; unit: string }[] }
/** Instructor holds a lever (simulated engine failure etc.); written every physics step until `release`. */
export interface Holds { throttle?: number; flapsDeg?: number; mixture?: number; release?: Pred; cue?: CueRef }
export type StepDef = SayStep | WaitStep | CaptureStep | SetupStep | HandoverStep | DemoStep | ChecklistStep
  | BranchStep | EndStep | TaskStep;

// =============================================================================================================
// 2.10 Criteria, coaching and faults
// =============================================================================================================

export interface Criterion {
  id: string; label: string;                      // 'Climb speed'
  kind: 'hold'      // continuous sampling while the task is active, after settleS, while activeWhen
      | 'peak'      // worst value in the task
      | 'final'     // value at task exit
      | 'atEvent'   // one sample at an event (field of the payload, or a signal at that moment)
      | 'check'     // pred must become true (by task exit, or within `withinS` of entry)
      | 'binary';   // fails if `failIf` ever holds
  sig?: SignalId; target?: Ref; tol?: TolRef;     // hold, peak, final, atEvent
  peakOf?: 'abs' | 'max' | 'min';                 // peak: default 'abs' deviation
  event?: TrainingEventName; field?: string;      // atEvent
  pred?: Pred; withinS?: number;                  // check
  failIf?: Pred;                                  // binary
  settleS?: number; activeWhen?: Pred;
  required: boolean;                              // in the exercise grade
  safety?: boolean;                               // failing it fails the exercise outright (grade 1) and is listed first
  chart?: boolean;                                // plot in the debrief (default true for hold)
  advice?: { high?: string; low?: string; fail?: string };
}
export type CoachPresetId =
  | 'speed' | 'altitude' | 'heading' | 'bank' | 'ball' | 'trim' | 'levelOff' | 'vs' | 'flapLimit' | 'stallWarning'
  | 'rpmRedline' | 'approachSpeed' | 'centreline' | 'glidepath' | 'flare' | 'crosswindDrift' | 'circuitHeight'
  | 'downwindSpacing' | 'lookout';
export interface CoachRule {
  id: string; topic: string;
  when: Pred;                       // the problem
  afterS: number;                   // must persist (no flicker coaching)
  correcting?: { sig: SignalId; target: Ref };   // suppress while the error is shrinking (section 3.6)
  say: [CueRef, CueRef?, CueRef?];  // escalation: hint, specific, technique
  praise?: CueRef;
  priority: 0 | 1 | 2 | 3;          // 0 safety, 1 energy and path, 2 attitude and balance, 3 refinement
  minLevel: CoachLevel;             // dropped below this coach level (safety rules: 'silent')
  offerDemo?: boolean;              // third rung offers "Show me" ([)
  /** (contract addition) The control the remark names: the UI points it out while the remark is said. */
  point?: PointTarget;
}
export interface FaultRule { id: string; when: Pred; severity: 'minor' | 'major' | 'critical'; cue?: CueRef; once?: boolean; action?: 'note' | 'endTask' | 'takeover' }

// =============================================================================================================
// 2.11 Results, profile and logbook
// =============================================================================================================

export type Pattern = 'ok' | 'biasHigh' | 'biasLow' | 'oscillation' | 'drift' | 'late';
export interface CriterionResult {
  id: string; label: string; kind: Criterion['kind']; required: boolean; safety: boolean;
  target?: number; tol?: Tol; testTol?: Tol;
  grade: Grade; testGrade: Grade;
  within: number;                    // 0..1 (hold)
  maxN: number;                      // worst normalised error (|e| / side tolerance)
  worst?: { value: number; dev: number; atS: number };
  excursions: number; longestOutS: number; pattern: Pattern;
  detail: string;                    // 'Within ±150 ft for 91 %; worst 210 ft low at 3:12'
}
export interface ExerciseResult {
  exerciseId: string; title: string; mode: ExerciseDef['mode']; standard: Standard;
  grade: Grade | null; testGrade: Grade | null;      // null: demo or insufficient data
  criteria: CriterionResult[]; attempts: number; interventions: number; faults: FaultRecord[];
  /** (contract addition) Lesson-limit interventions on this exercise (TaskLimit): prevent a grade 4, never fail
   *  the lesson by themselves. Absent = 0. */
  limitInterventions?: number;
  /** (contract addition) Limit ids that triggered those interventions, in order. */
  limitIds?: string[];
}
export interface FaultRecord {
  id: string; severity: 'minor' | 'major' | 'critical'; atS: number;
  /** (contract addition, round 7) What happened, for the debrief: 'Flap extended at 97 KIAS (limit 85 KIAS)'. */
  detail?: string;
  /** (contract addition) The worst value reached in the episode (flapOverspeed: KIAS). */
  value?: number;
  /** (contract addition) Skill test: the item it happened in fails (grade 1), and so its section, without the
   *  whole-test fail of a critical fault. */
  failsItem?: boolean;
}
/** Sim-time totals of one flight (block, airborne, night, instrument in seconds). */
export interface FlightTimes {
  blockS: number; airborneS: number; nightS: number; instrumentS: number;
  landingsDay: number; landingsNight: number; takeoffs: number;
}
export interface LessonResult {
  lessonId: string; lessonVersion: number; attemptId: string; authority: AuthorityId;
  startedAt: string; endedAt: string;                 // ISO wall time
  outcome: 'competent' | 'notYet' | 'incomplete' | 'abandoned' | 'crashed' | 'testPass' | 'testPartial' | 'testFail';
  stars: 0 | 1 | 2 | 3;
  exercises: ExerciseResult[];
  interventions: number; handbacks: number; phaseRetries: number;
  /** (contract addition) Lesson-limit interventions in the run (not safety interventions). Absent = 0. */
  limitInterventions?: number;
  flags: { calmAir: boolean; kbdAssists: boolean; instructorSaves: boolean; inputDevice: 'keyboard' | 'mouse' | 'hardware' };
  weatherLine: string;                                // 'Wind 090/7, turbulence light'
  flight: FlightTimes;
  debrief: { strength: string; main: string; next: string; spoken: string[] };
  traceId: string | null;
  /**
   * (contract addition) Safe assessed landings flown in this run (L10 "each safe assessed landing increments
   * records.safeLandings"; the L13 gate needs >= 3). Absent = 0.
   */
  safeLandings?: number;
}

export interface LogbookEntry {
  id: string;                     // uuid
  date: string;                   // wall-clock ISO date
  aircraftType: string; registration: string;
  from: 'KFBL'; to: 'KFBL';
  role: 'dual' | 'solo' | 'pic' | 'test';
  times: FlightTimes;
  lessonId: string | null; lessonVersion: number | null;
  exercise: string;               // 'Ex 7 & 8 Climbing and descending'
  outcome: LessonResult['outcome'] | 'freeFlight'; stars: number | null;
  remarks: string;                // editable
  signedBy: string | null;        // 'K. Mercer FI(A)' for dual; null solo
  stamp?: 'FIRST SOLO' | 'SKILL TEST PASS' | 'NIGHT';
  traceId?: string;
}
export interface LessonProgress {
  status: 'locked' | 'available' | 'competent';
  attempts: number; bestStars: number; lastOutcome: LessonResult['outcome'] | null;
  exercises: Record<string, { best: Grade; last: Grade; competentAt?: string }>;
  bestTraceId?: string; completedAt?: string; lessonVersion: number;
}
export interface TrainingSettings {
  authority: AuthorityId; talkativeness: 'quiet' | 'normal' | 'chatty';
  voice: { instructor: string | null; examiner: string | null; rate: number; volume: number; captions: boolean; captionsOnly: boolean };
  instructorSaves: boolean; liveBars: boolean; autoAck: boolean; logFreeFlights: boolean;
  /** (contract addition) The cockpit camera glances at a control the instructor names when it is off screen. Absent = on. */
  glance?: boolean;
}
/** The career file (`fs.training.v1`). Totals are always derived from the logbook, never stored. */
export interface TrainingSave {
  format: 'fs-training'; schema: 1; createdAt: string; updatedAt: string; appBuild: string;
  profile: { studentName: string; instructorName: string; licenceNo: string /* 'FBL-0421' */; experienced: boolean };
  settings: TrainingSettings;
  progress: Record<string, LessonProgress>;
  skills: Partial<Record<SkillId, { last5: Grade[] }>>;
  endorsements: { id: EndorsementId; at: string; lessonId: string | null }[];
  logbook: LogbookEntry[];
  results: Record<string, LessonResult[]>;           // last 3 per lesson, traces stored separately
  bests: Record<string, ChallengeBest[]>;            // challenge id -> top 5
  testHistory: { at: string; outcome: 'testPass' | 'testPartial' | 'testFail'; failedSections: number[] }[];
  /**
   * (contract addition) Career counters the spec names but section 2.11 does not store:
   * `safeLandings` (L10 assessed safe landings, the L13 gate). Optional so schema-1 files stay valid.
   */
  records?: { safeLandings: number };
}
export interface ChallengeBest { score: number; at: string; authority: AuthorityId; flags: LessonResult['flags']; traceId?: string }

// =============================================================================================================
// 3. Engine contracts (section 3). Data and port interfaces shared by several modules; the classes that
//    implement them live in their modules and re-export the relevant types.
// =============================================================================================================

// ---- 3.8 Safety envelope (src/training/engine/safety.ts) --------------------------------------------------

export interface SafetyEnvelope {
  maxBankDeg: number;            // 60 (L07: 60, steep turns: 65)
  maxPitchUpDeg: number;         // 25
  maxPitchDownDeg: number;       // -25
  maxKias: number;               // Vno + 11 = 140
  maxG: number; minG: number;    // 3.3 / 0.0
  minAglFt: number;              // 1000 outside lowLevel phases (upper-air lessons set 1500)
  lowAndSlow: { aglFt: number; belowKias: Ref };      // 300 ft, Vs1 + 5: immediate
  maxSinkFpmBelow200: number;    // 1000
  stallAllowed: boolean;         // false except L06/L07 above 2,000 ft AGL
  runwayExcursionM: number;      // |rwyAcrossM| > 13 on the ground above 15 kt
}

// ---- Training bus and predicate evaluation (modules 1 and 5) ----------------------------------------------

/** One event on the training bus. `seq` increases monotonically within a run; `simT` is run sim time, s. */
export interface TrainingEventRecord<K extends TrainingEventName = TrainingEventName> {
  seq: number; type: K; data: TrainingEventMap[K]; simT: number;
}
/** Read side of the training bus that predicates scan (`event` predicates look at events since a mark). */
export interface TrainingEventLog {
  /** The seq the next emitted event will get: store it on step entry, then scan with since(). */
  mark(): number;
  /** Events with seq >= mark, oldest first. */
  since(mark: number): readonly TrainingEventRecord[];
}

/** Everything a compiled predicate, a Ref or a TolRef needs at evaluation time. Built by the runner per tick. */
export interface EvalContext {
  /** The run's signal frame (mutated in place by Telemetry.sample). */
  readonly frame: Readonly<SignalFrame>;
  /** Signal definitions (kind 'angle' -> wrapped comparisons; default hysteresis). Undefined: unknown id. */
  signalDef(id: SignalId): SignalDef | undefined;
  /** Run variables (capture steps, lesson vars), in pilot units. */
  readonly vars: Readonly<Record<string, number>>;
  readonly aircraft: AircraftTypeDef;
  /** Aerodrome elevation, ft (`{ field: 'elevFt' }`). */
  readonly fieldElevFt: number;
  /** TolRef resolution: the table, the run's authority and the standard of the exercise being evaluated. */
  readonly standards: ToleranceTable;
  readonly authority: AuthorityId;
  readonly standard: Standard;
  readonly events: TrainingEventLog;
  /** Bus mark taken on step entry (`event` predicates scan from here). */
  readonly stepMark: number;
  /** Sim time since step entry, s. */
  readonly stepT: number;
  /** Sim seconds since the previous evaluation (0 while paused). */
  readonly dt: number;
  /** Run sim time, s. */
  readonly simT: number;
  readonly pilot: 'student' | 'instructor';
  readonly speechIdle: boolean;
  /** Best closed grade of an exercise in this run (null: none yet). */
  exerciseGrade(id: string): Grade | null;
}
/** A predicate compiled to a closure with its own state (hysteresis latch, held timer, ever latch). */
export interface CompiledPred {
  /** Evaluate once per tick with the current context; returns the (hysteresis-filtered) value. */
  eval(ctx: EvalContext): boolean;
  /** Clear internal state (timers, latches): on step entry and on checkpoint restore. */
  reset(): void;
  /** The last value eval() returned (false before the first eval). */
  readonly value: boolean;
}

// ---- 3.10 Resume, checkpoints and the logbook timer ------------------------------------------------------

/** FlightTimer state (career/logbook.ts). Owned by FlightTimer; other modules treat it as opaque data. */
export interface FlightTimerState {
  times: FlightTimes;
  /** Block time running (engine running with movement, or lesson start if airborne or running). */
  blockOn: boolean;
  /** Counted as airborne (no wheel on the ground for 2 s). */
  airborne: boolean;
  /** Seconds since the last wheel contact (the 2 s airborne rule). */
  offGroundS: number;
  /** Seconds on the ground since the last touchdown (airborne time ends at the last touchdown). */
  onGroundS: number;
}

export interface RunSnapshot {
  lessonId: string; lessonVersion: number; attemptId: string;
  phaseId: string; phaseRepeat: number; stepId: string; stepAttempt: number;
  vars: Record<string, number>; authority: 'student' | 'instructor'; holds: Holds | null;
  exercises: Record<string, ExerciseResult[]>;     // closed attempts
  faults: FaultRecord[]; interventions: number; handbacks: number; phaseRetries: number;
  flightTimer: FlightTimerState; startedAt: string; elapsedSimS: number; weatherSeed: number;
}

/** A phase-entry checkpoint (about 4 kB): the flight, the runner and the trace position. */
export interface CheckpointBlob {
  flight: FlightSnapshot;
  runner: RunSnapshot;
  /** Number of trace samples recorded when the checkpoint was taken (a retry truncates the trace here). */
  traceOffset: number;
}

/** The `training` block of a schema-2 FlightSnapshot (validated by src/training/career/validate.ts). */
export interface TrainingResumeBlock {
  lessonId: string; lessonVersion: number; run: RunSnapshot; start: StartSpec; checkpoint: CheckpointBlob | null;
  /** (multi-aircraft addition) The type the lesson was flown in. Absent (older saves): 'c172s'. */
  aircraftId?: AircraftTypeId;
}

// ---- 3.7 Speech (src/training/speech/scheduler.ts) ---------------------------------------------------------

export interface SpeechRequest {
  id: string; actor: ActorId; channel: Channel; caption: string; speak: string;
  priority: Priority; interrupt: boolean; resumable: boolean; ttlMs: number; key?: string; cooldownMs?: number;
}
export interface Caption { id: string; actor: ActorId; channel: Channel; text: string; atWall: number; atSim: number; spoken: boolean }
/** (contract addition: named by SpeechBackend.speak but not defined in the spec) A resolved synthesiser voice. */
export interface VoiceProfile {
  /** SpeechSynthesisVoice.voiceURI, or null for the backend's default / captions only. */
  voiceURI: string | null;
  lang: string;
  rate: number;    // 0.8-1.3
  pitch: number;   // 1; 0.85 for the examiner when only one voice exists
  volume: number;  // 0..1
}
export interface SpeechBackend {
  readonly kind: 'webspeech' | 'captions';
  ready(): Promise<boolean>;
  speak(text: string, voice: VoiceProfile, cb: { onStart(): void; onEnd(): void; onError(e: string): void }): void;
  cancel(): void; pause(): void; resume(): void;
}
/** (contract addition) The line table in content/lines.ts: cue id -> line with 1-3 variants. */
export type LineTable = Readonly<Record<CueId, InlineCue>>;

// ---- 3.9 Copilot (src/training/copilot/instructorPilot.ts) -----------------------------------------------

/** Called by SimPhysics every physics step after the autoflight and before fm.step (`h` = step size, s). */
export interface StepController { readonly flying: boolean; update(h: number, s: AircraftState, c: ControlInputs): void }

// ---- Navigation route (contract addition: Lesson.route and TelemetrySources.route name NavRoute) ---------

export interface NavWaypoint {
  id: string; name: string;      // 'foothillLake', 'Foothill Lake'
  north: number; east: number;   // NED, m
  /** Passing within this distance counts as overhead, NM (default 1). */
  passRadiusNm?: number;
}
/** A closed route flown leg by leg: leg i runs from waypoints[i] to waypoints[i + 1]. */
export interface NavRoute {
  id: string; name: string;
  waypoints: NavWaypoint[];
  /** Planned cruise altitude, ft MSL. */
  altFt: number;
  /** Planned leg times from the nav log (minutes, one per leg): the ETA error reference. */
  legMinutes: number[];
  /** Planned headings from the nav log (degrees magnetic, one per leg). */
  legHeadingsDeg: number[];
}

// ---- Training areas (contract addition: src/training/geo/areas.ts) -----------------------------------------

export interface AreaDef { id: AreaId; name: string; north: number; east: number; radiusNm: number }

// ---- Ground spots resolve through src/world/airport/layout.ts; recorded here for the linter --------------

export const GROUND_SPOTS: readonly GroundSpot[] = ['parking', 'holdA1', 'holdA2', 'lineup07'];

// ---- Trace (grading/trace.ts) -------------------------------------------------------------------------------

/** 2 Hz trace channels; `authority` is 1 while the instructor has control, else 0. */
export type TraceChannel =
  | 't' | 'altFt' | 'asiKt' | 'hdgDeg' | 'aiBankDeg' | 'vsiFpm' | 'pitchDeg' | 'aglFt' | 'north' | 'east'
  | 'throttle' | 'flapsDeg' | 'gpDevFt' | 'rwyAcrossM' | 'authority';
export interface TraceBand { sig: SignalId; fromS: number; toS: number; target: number; minus: number; plus: number; taskId: string }
export interface TraceEvent { t: number; type: string; label: string }
/** A decoded trace (the stored form is Int16 per channel with scale/offset, base64; see grading/trace.ts). */
export interface TraceData {
  id: string; lessonId: string; hz: number;
  channels: Record<TraceChannel, number[]>;
  bands: TraceBand[]; events: TraceEvent[];
  /** Instructor demo spans [fromS, toS], drawn greyed. */
  demoSpans: [number, number][];
  phases: { t: number; label: string }[];
  /** True when a reload interrupted the recording ("(trace interrupted)"). */
  interrupted: boolean;
}
export interface TraceIndexEntry { id: string; kind: 'best' | 'latest' | 'challenge'; lessonId: string; at: string }

// ---- Challenges (section 4.3) --------------------------------------------------------------------------------

export type ChallengeScoring = 'spotLanding' | 'deadStick' | 'crosswindMaster' | 'precisionCircuit';
export type Medal = 'bronze' | 'silver' | 'gold';    // 60 / 80 / 92
/** A challenge is flown by the runner like a lesson (its own one-phase Lesson) and scored 0-100. */
export interface ChallengeDef {
  id: string; title: string; description: string;
  /** Lesson id whose competency unlocks it. */
  unlockedBy: string;
  lesson: Lesson;
  scoring: ChallengeScoring;
}

// ---- Career totals (career/totals.ts; derived from the logbook, never stored) ------------------------------

export interface CareerTotals {
  totalS: number; dualS: number; soloS: number; picS: number; nightS: number; instrumentS: number;
  landingsDay: number; landingsNight: number; takeoffs: number; flights: number;
}

// ---- Lesson linter (content/validate.ts) ---------------------------------------------------------------------

export interface LintIssue { lessonId: string; path: string; message: string; severity: 'error' | 'warning' }

// ---- Runner commands and the UI port (module 5 publishes, module 7 renders) -----------------------------------

/** Student and menu commands the runner accepts (LessonRunner.input). */
export type RunnerCommand = 'ack' | 'handback' | 'sayAgain' | 'showMe' | 'retryPhase' | 'restartLesson' | 'abandon' | 'skipStep';

/** Authority chip on the lesson strip (section 5.4). */
export type AuthorityChip = 'instructor' | 'followMe' | 'offered' | 'student' | 'solo' | 'skillTest';
/** One tolerance chip: green n <= 0.6, amber 0.6 < n <= 1, red n > 1. */
export interface ToleranceChip { label: string; text: string /* 'ALT +40' */; n: number; state: 'green' | 'amber' | 'red' }
export interface LessonStripModel {
  lessonId: string; lessonTitle: string;
  authority: AuthorityChip;
  /** Sub-chips for instructor holds: 'THROTTLE: INSTRUCTOR'. */
  holds: string[];
  /** "Match the throttle" bar during a handover with a hardware throttle: 0..1 progress, null when not shown. */
  matchThrottle: number | null;
  taskTitle: string;
  /** Up to 4; empty when hidden (assessed with liveBars off, or phase coach level silent). */
  chips: ToleranceChip[];
  assessed: boolean;
}
export interface CardTargetModel { label: string; unit: string; target: number; value: number; tol: Tol; n: number }
export interface CardModel {
  lessonTitle: string; phaseTitle: string; taskTitle: string;
  stepT: number;
  targets: CardTargetModel[];
  /** False in assessed tasks: the card reads "Assessment: no live feedback". */
  liveFeedback: boolean;
  captions: Caption[];                              // last 5
  checklist: { title: string; items: ChecklistItemModel[] } | null;
}
/** One checklist line on the card. The optional fields (contract addition) come from guided checklists. */
export interface ChecklistItemModel {
  id: string; label: string; state: 'pending' | 'active' | 'done' | 'missed';
  /** The control it sets, the state wanted ('OFF'), the key ('I', 'Shift+O') and why (first reading only). */
  control?: ControlId; required?: string; key?: string | null; why?: string | null;
}
export interface BriefingModel {
  lesson: Lesson; aircraft: AircraftTypeDef; authority: AuthorityId;
  /** Briefing numbers resolved against the aircraft. */
  numbers: { label: string; value: number; unit: Briefing['numbers'][number]['unit'] }[];
  /** Lesson standard and test standard bands per key; `note` marks sim-standard / examiner-practice values. */
  tolerances: { key: TolKey; lesson: Tol; test: Tol; note?: string }[];
  weatherLine: string;                              // 'Wind 090/7, CAVOK, 09:30'
  /** Practice credit only (lesson opened through lesson= or unlock= while not available). */
  practiceOnly: boolean;
}
export interface DebriefModel {
  lesson: Lesson; result: LessonResult;
  trace: TraceData | null; bestTrace: TraceData | null;
  logbookPreview: LogbookEntry | null;
  /** Phases with checkpoints in this run ("Try one exercise again"). */
  retryPhases: { phaseId: string; title: string }[];
  nextLessonId: string | null;
  /** Ceremony card shown before the debrief. */
  milestone: EndorsementId | null;
}
/** Display port the runner and TrainingSystem publish to (implemented by SchoolUi). Display only: user
 *  actions come back through SchoolUi's command callback as SchoolCommand. */
export interface TrainingUiPort {
  showBriefing(m: BriefingModel): void;
  hideBriefing(): void;
  setStrip(m: LessonStripModel | null): void;
  setCard(m: CardModel | null): void;
  showDebrief(m: DebriefModel): void;
  hideDebrief(): void;
  showCaption(c: Caption): void;
  setHighlight(ids: readonly InstrumentId[]): void;
  setFollowMeThrough(on: boolean): void;
  toast(text: string): void;
  /** (contract addition) The control the instructor is pointing at, or null. Absent: not shown. */
  setCallout?(c: CalloutModel | null): void;
  /** (contract addition) The taxi guidance HUD, or null. Absent: not shown. */
  setTaxiGuide?(m: TaxiGuideModel | null): void;
}

// ---- Cockpit controls, callouts and taxi guidance (contract addition, owner playtest of L01/L02) -------------

/** Cockpit controls the instructor can point at (positions: render/aircraft/cockpit.ts COCKPIT_CONTROLS). */
export type ControlId =
  | 'master' | 'alternator' | 'avionics' | 'fuelPump' | 'beacon' | 'landingLight' | 'taxiLight' | 'navLights'
  | 'strobes' | 'pitotHeat' | 'magnetos' | 'throttle' | 'mixture' | 'flapLever' | 'trimWheel' | 'fuelSelector'
  | 'parkingBrake' | 'yoke' | 'rudderPedals' | 'toeBrakes' | 'panelLights';
/** A control or an instrument. */
export type PointTarget = ControlId | InstrumentId;

/** What the UI shows at a control the instructor is talking about. */
export interface CalloutModel {
  /** Changes whenever a new callout begins (the UI restarts its animation and the glance). */
  id: string;
  target: PointTarget;
  /** 'Avionics switch'. */
  label: string;
  /** The state wanted ('OFF', 'BOTH', '1,000 RPM'), or null when just pointing. */
  state: string | null;
  /** The key that operates it ('I', 'Shift+O'), or null. */
  key: string | null;
  /** The key as a KeyboardEvent code, for clicking the callout. */
  keyCode: { code: string; shift: boolean } | null;
  /** Why (shown under the label), or null. */
  why: string | null;
  /** Satisfied: drawn ticked for a moment, and the glance returns. */
  done: boolean;
  /** The camera may glance at it when it is off screen (once per callout id). */
  glance: boolean;
  source: 'checklist' | 'step' | 'coach' | 'reminder' | 'showMe';
  /** Callouts waiting behind this one. */
  queued: number;
}

/** Destinations of a taxi route: a holding point of runway 07/25 or the parking spot. */
export type TaxiDestination = 'A1' | 'A2' | 'A3' | 'A4' | 'parking';
export type TaxiAction = 'left' | 'right' | 'straight' | 'holdShort' | 'stop';
/** A junction or the end of a taxi route. Positions NED, m; `sM` along the route from its start, m. */
export interface TaxiWaypoint {
  /** What happens here: turn onto `name`, or hold short / stop at it. */
  action: TaxiAction;
  /** Taxiway entered ('B1', 'A', 'A1'), 'apron' for the apron taxilane, or the destination. */
  name: string;
  north: number; east: number; sM: number;
  /** Heading change at the junction, deg (+ right). */
  turnDeg: number;
  /** Length of the leg after it, m (0 at the end). */
  legM: number;
}
/** A ground route over the taxiway centrelines (src/training/geo/taxiRoute.ts). */
export interface TaxiRoute {
  id: string;
  to: TaxiDestination;
  /** Dense centreline polyline (curves at the junctions), NED, with along-route distance. */
  points: { north: number; east: number; sM: number }[];
  /** Junctions in order, ending with the hold-short point (or the stand). */
  waypoints: TaxiWaypoint[];
  lengthM: number;
  /** The route ends holding short of a runway. */
  holdShort: boolean;
}
/** The taxi guidance HUD. */
export interface TaxiGuideModel {
  action: TaxiAction;
  /** 'B1', 'Alpha', 'A1'. */
  name: string;
  /** Along the route to the next action, m. */
  distM: number;
  /** Approaching the hold line: "HOLD SHORT". */
  holdShort: boolean;
  holdShortDistM: number | null;
  /** + right of the centreline, m. */
  xtrackM: number;
  gsKt: number;
  routeDistM: number;
  /** The actions after the next one (up to two). */
  then: { action: TaxiAction; name: string }[];
  to: TaxiDestination;
}
/** What the school screens ask TrainingSystem to do. */
export type SchoolCommand =
  | { kind: 'openHome' } | { kind: 'closeSchool' } | { kind: 'openLesson'; lessonId: string }
  | { kind: 'startFlight' } | { kind: 'listenBriefing' } | { kind: 'backFromBriefing' }
  | { kind: 'nextLesson' } | { kind: 'flyAgain' } | { kind: 'retryPhase'; phaseId: string } | { kind: 'home' }
  | { kind: 'runner'; cmd: RunnerCommand }
  | { kind: 'startChallenge'; challengeId: string }
  | { kind: 'createProfile'; studentName: string; authority: AuthorityId; experienced: boolean; voice: string | null; captionsOnly: boolean }
  | { kind: 'dismissWelcome' }
  | { kind: 'updateSettings'; settings: Partial<TrainingSettings> }
  | { kind: 'editRemarks'; entryId: string; remarks: string }
  | { kind: 'export'; includeTraces: boolean } | { kind: 'import'; json: string; mode: 'replace' | 'merge' }
  | { kind: 'resetProgress' }
  /** (multi-aircraft addition) The school's offer to change to its type (D5): commands.setAircraft, reload into the school. */
  | { kind: 'switchAircraft'; aircraftId: AircraftTypeId };

/** (contract addition) Seeded random source in [0, 1) used for variants and weather sampling. */
export type Rng = () => number;
