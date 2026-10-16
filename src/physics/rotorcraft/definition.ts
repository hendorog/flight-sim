import type { Vec3 } from '../../core/math';
import type { SurfaceType } from '../../core/types';
import type { ManifoldPlacard, SpeedPlacard, SpeedCorrections } from './limits';
import type { BladeConingDefinition } from './coning';

/** SI units; rotor rotation is +1 about its upward thrust axis (CCW viewed from above). */
export interface RotorDefinition {
  radius: number; rootCutout: number; chord: number; blades: number;
  /** Pitch at 75% radius and linear root-to-tip twist, radians. */
  minPitch: number; maxPitch: number; twist: number;
  liftSlope: number; maxCl: number; profileCd: number; inducedDrag: number;
  inertia: number; hub: Vec3;
  /** Nonuniform-wake induced-velocity correction; one is ideal uniform momentum theory. */
  inducedFactor?: number;
  /**
   * Tail rotor only: relax the induced velocity with the uniform Pitt-Peters time constant (inflowTimeConstant, about
   * 5 ms for a small, fast tail rotor in the hover) instead of the legacy fixed 0.08 s. Absent: the legacy lag (every
   * type before the MD 500E; their arithmetic is untouched).
   */
  pittPetersInflow?: boolean;
}
/**
 * Turboshaft fuel control and power-turbine governor (MD 500E / Allison 250-C20B). Declared at the scaffold; the
 * turboshaft package (T2) implements it in src/physics/rotorcraft/turboshaft.ts as
 *   stepTurboshaft(dt, c, engine, out, busVolts): void
 * which flightModel calls IN PLACE OF Rotorcraft.throttle() when `systems.turboshaft` is present (throttle()
 * itself stays byte-identical). It writes out.throttle (the PLA-equivalent lever the existing TurbineEngine
 * reads: with fcu.lowIdleNg = fcu.highIdleNg = plaNg.groundIdle the lever law ngDemand = idle + (maxNg - idle) x
 * throttle inverts exactly), out.mixture (0 below grip.cutoffBelow, else 1), out.magnetos (3 while
 * auto-reignition is armed, else c.magnetos), out.engines = [{}] (a fresh array, so no per-engine override masks
 * the scalars), and fills RotorcraftState.turboshaft. The fcu numbers are read from
 * engine.def.turbine.gasGenerator.fcu, never duplicated here: plaNg.groundIdle === fcu.lowIdleNg ===
 * fcu.highIdleNg and plaNg.fullOpen === fcu.maxNg (consistency rule).
 */
export interface TurboshaftControlDef {
  /** Twist grip as ControlInputs.throttle fractions: CUTOFF below cutoffBelow; the GROUND IDLE stop; 1 = FULL OPEN. */
  grip: { cutoffBelow: number; groundIdle: number };
  /** Gas-producer (N1) demand the grip's PLA schedule allows at the ground-idle stop and at full open, fraction of N1 100 %. */
  plaNg: { groundIdle: number; fullOpen: number };
  /** Hydromechanical power-turbine governor (no bus power). Fractions of N2 100 % (engine ratedRpm). */
  governor: {
    /** Beep limits, e.g. [0.975, 1.045]. */
    setRange: readonly [number, number];
    /** Set point after reset, e.g. 1.03. */
    setDefault: number;
    /** Set-point change per second while beeping, fraction. */
    beepRate: number;
    /** Steady N2 fall per unit Ng-demand rise (proportional droop). */
    droop: number;
    /** Droop compensator: Ng demand per unit collective POSITION (feed-forward; RFM 4-22 over-compensation). */
    anticipation: number;
    /**
     * N1 at which the compensator's datum sits with the collective fully down: the steady N2 equals the beep set
     * point there (flat pitch at 103 % N2, so the RFM 4-18 run-up beep check reads the set point). Absent:
     * plaNg.groundIdle.
     */
    datumNg?: number;
    /** Ng demand per unit N2 error, and its integral gain, 1/s. */
    gain: number; integralGain: number;
    /** Rate lead on N2, s. */
    lead: number;
  };
  /** ENGINE OUT warning (RFM 3-3): N1 below n1Below, or Nr below nrBelow x referenceRpm. No collective inhibit. */
  engineOut: { n1Below: number; nrBelow: number };
  /** Torquemeter: psi per output-shaft N m (gearRatio 1: the power-turbine torque). */
  psiPerNm: number;
  /** RFM 2-5 limits that replace the power/MAP-based powerLimitExceeded. */
  limits: {
    mcpPsi: number; mcpPsiAboveTot: { psi: number; totC: number };
    takeoffPsi: number; takeoffSeconds: number;
    /** [psi for 15 s, psi for 3 s]. */
    transientPsi: readonly [number, number];
    totC: { mcp: number; takeoff: number; transient6s: number; start1s: number };
    n1Pct: { continuous: number; transient15s: number };
    /** Steady N2 avoid band, %. */
    n2AvoidPct: readonly [number, number];
  };
}

export interface RotorcraftDefinition {
  /** Installation metadata. Absent retains the legacy teetering hub. Articulated selects the
   * reduced harmonic offset-hinge solver; per-blade transients/ground resonance remain unmodelled. */
  hubModel?: { kind: 'teetering' } | { kind: 'articulated'; flapHingeOffset: number; lagHingeOffset: number;
    lagDamper: 'elastomeric' | 'friction';
    /** Physical blade pose; harmonic load coordinates remain independent of gravity/stops. */
    coning?: BladeConingDefinition };
  main: RotorDefinition;
  tail: RotorDefinition;
  nominalRpm: number;
  /** Tachometer 100%, distinct from the governed operating speed. */
  referenceRpm: number;
  airspeedLimits: SpeedPlacard;
  airspeedCorrections?: SpeedCorrections;
  manifoldLimits?: ManifoldPlacard;
  rotation: 1 | -1;
  /** Tail rotation relative to main azimuth about the renderer's local axis; legacy is -1. */
  tailRotation?: 1 | -1;
  engineRatio: number; tailRatio: number; transmissionEfficiency: number;
  cyclicLimit: number;
  /**
   * Asymmetric cyclic travel (MD 500E TCDS rigging: forward 17.75, aft 8.15, left 8.15, right 7 deg), rad. Absent:
   * cyclicLimit each way (every type before the MD 500). Declared at the scaffold; T2 implements it.
   */
  cyclicLimits?: { forward: number; aft: number; left: number; right: number };
  /**
   * Forward tilt of the main-rotor shaft from the body's -z axis, rad (MD 500E: 3 deg, RFM Fig 6-3). The main rotor's
   * flow, flapping, forces and moments are solved in the shaft frame and turned back to the body. Absent: 0 (every
   * type before the MD 500; their arithmetic is untouched).
   */
  shaftTilt?: number;
  /**
   * The main rotor's blade elements see the fuselage's yaw rate: the governed rotor speed is held relative to the
   * fuselage, so the air sees Omega - rotation x r (shaft axes). This is the main-rotor yaw damping (and the thrust
   * change with yaw rate, Heffley CR-3144 OH-6A Z_r = 0.45 m/s^2 per rad/s). Absent: Omega alone (every type before
   * the MD 500E).
   */
  yawInRotorSpeed?: boolean;
  /**
   * Control-system flexibility: the blade angle reached is this fraction of the linkage's commanded angle, measured
   * from the rigging neutral (cyclic: the zero-cyclic swashplate; pedals: the centre of the tail-rotor pitch range).
   * Heffley CR-3144 Fig II-2 (OH-6A, full-scale wind-tunnel tests): pitch 0.75, roll 0.75, yaw 0.67. Absent: 1.
   */
  controlFlex?: { longitudinal: number; lateral: number; pedal: number };
  teeterLimit: number;
  /** Inputs command position; optional spring trim reports forces but drives no force-feedback hardware. */
  controlSystem: { cyclic: 'mechanical' | 'hydraulic'; collective: 'mechanical' | 'hydraulic'; pedals: 'mechanical';
    /** Installation label; the optional springTrim parameters enable its actuator/force model. */
    trim?: 'electric-spring' | 'none';
    /** Normalized anchor travel/s and force at unit spring deflection (N); measured data preferred. */
    springTrim?: { rate: number; force: number } };
  systems: { clutchSeconds: number; beltTorque: number; correlator: number; governorRate: number;
    /** False for a manual-throttle installation; absence retains the legacy governor. */
    governorInstalled?: boolean;
    /** Fractions of tachometer reference RPM, not governed RPM. */
    governorEngage: number; lowRpmWarning: number; powerCheckMinRpm: number;
    /** Collective switch deadband, normalized travel. */
    hornCollectiveMin: number;
    governorGain?: number; governorIntegralGain?: number;
    /** Estimated RPM prediction horizon of the governor's rate feedback, seconds. */
    governorLead?: number;
    continuousPower: number; takeoffPower: number; takeoffSeconds: number;
    /**
     * 'belt' (S269/Robinson actuator clutch; the default) or 'freewheel' (sprag clutch only, MD 500E). On
     * 'freewheel' the clutch/belt/correlator/governor fields above are ignored except lowRpmWarning and
     * hornCollectiveMin (-1: no collective inhibit); clutchEngagement is always 1, there is no clutch light, and
     * the coupling cap is transmissionTorqueLimit. Declared at the scaffold; T2 implements it.
     */
    drive?: 'belt' | 'freewheel';
    /**
     * Freewheel coupling cap, N m at the ENGINE OUTPUT SHAFT (the side beltTorque is applied on in drive()), used
     * with drive 'freewheel' in place of beltTorque. Set well above the transient torque so it never binds in
     * normal use: the transmission rating is a pilot limit (powerLimitExceeded), not a slipping clutch.
     */
    transmissionTorqueLimit?: number;
    /** Turboshaft fuel control and N2 governor (MD 500E). Absent: piston engine with throttle()/correlator. */
    turboshaft?: TurboshaftControlDef };
  /** Main transmission rotor-driven oil pump and lumped thermal model, SI except psi/rpm. */
  transmission?: { pressurePsi: number; pumpRpm: number; pressureSeconds: number;
    heatCapacity: number; cooling: number };
  stabilizer: { centre: Vec3; area: number; liftSlope: number; incidence: number; maxCl: number; wash: number;
    /** Single right-hand surface: positive cant raises its tip. Absent retains horizontal surface. */
    dihedral?: number };
  fins: { centre: Vec3; area: number; liftSlope: number; incidence: number; maxCl: number;
    /**
     * The part of the fin inside the tail rotor's stream tube (a fin beside the disc: MD 500E): `areaFraction` of
     * the area meets the rotor's induced flow at `velocityRatio` x the disc's induced velocity, across the fin (the
     * blockage that costs anti-torque thrust, and the yaw damping the fin adds as a yaw rate changes that flow).
     * Absent: the whole fin sees the free stream only (every type before the MD 500E).
     */
    tailRotorFlow?: { areaFraction: number; velocityRatio: number } }[];
  /** Fuselage destabilising moment derivatives, Nm/(Pa rad). */
  fuselageMoment: { pitch: number; yaw: number };
  /** Equivalent flat plate areas along FRD axes, m². */
  dragArea: Vec3;
  /** Local fuselage downwash / disc induced velocity; actuator-disc near/far wake spans 1–2. */
  fuselageWash?: number;
  /** Aerodynamic drag application point relative to reference point. */
  dragCentre: Vec3;
  tailProtection?: { stinger: readonly Vec3[]; radius: number; fin: readonly Vec3[];
    stiffness: number; damping: number; maxSink: number; maxCompression: number };
  /** Collision/low-speed pose data; never used by the airborne load solver. */
  groundRotor?: { blade: BladeConingDefinition; stopFriction: number;
    tailcone: { front: Vec3; rear: Vec3; frontRadius: number; rearRadius: number };
    cabin: { centre: Vec3; radii: Vec3 } };
  skids: { halfTrack: number; front: number; rear: number; z: number; stiffness: number; damping: number; friction: number; maxSink: number;
    /** Body z of the FRONT contacts when they differ from the rear ones (`z`), m (MD 500E: the 4.7 deg nose-up
     * ground attitude). Absent: all four at `z`. */
    frontZ?: number;
    suspension?: 'cross-tube' | 'oleo';
    /** Per contact, N, N/m, m. Bilinear compression plasticity; spread is m lateral/m stroke. */
    flexure?: { yieldForce: number; hardening: number; maxStroke: number; spread: number };
    /** Effective vertical strut quantities after mount leverage. P0 is absolute Pa; gasLength=V0/A.
     * A compliant foot acts in series; the extension stop carries gas preload before breakaway. */
    oleo?: { pressure: readonly [number, number]; area: number; gasLength: number; exponent: number;
      contactStiffness: number; maxStroke: number; orifice: number; rebound: number;
      reliefForce: number; reliefDamping: number };
    terrain?: { tubeRadius: number; toe: number; heel: number; toeRise: number;
      edgeStiffness: number; edgeDamping: number;
      /** Soil bearing stiffness N/m per contact and passive lateral stress Pa. */
      soil: Partial<Record<SurfaceType, { bearing: number; passive: number }>> };
    /** Shoe/terrain contact, distinct from tyre coefficients. Lateral includes soil ploughing by the tube. */
    surfaces?: Partial<Record<SurfaceType, { static: number; sliding: number; lateral: number }>> };
}
export interface RotorcraftState {
  /** Ground-only physical teeter coordinate. Separate from the unchanged aerodynamic harmonics.
   * Blade zero is body right at azimuth zero; angle is positive up. */
  contactRotor?: { angle: number; rate: number; frictionWork: number; stopWork: number };
  /** Physical per-blade pose, radians; optional hub coning data adds weight and droop stops
   * around the reduced solver's harmonic flap. `coning` below remains aerodynamic. Lag stays zero until a
   * validated body/shaft coupling exists. Blade zero starts body right at azimuth zero. */
  articulated?: { blades: { flap: number; lag: number; pitch: number }[] };
  /** Optional installation systems; absent on legacy rotorcraft. Never substitutes for clutchLight. */
  transmission?: { oilPressurePsi: number; oilTemperatureC: number; tailChips: boolean };
  clutchDisengaged?: boolean;
  springTrim?: { pitch: number; roll: number; pitchForce: number; rollForce: number };
  /**
   * Turboshaft installations only (systems.turboshaft). NEVER created by emptyRotorcraftState() and deleted at the
   * top of Rotorcraft.reset() on other types, so the legacy digests (s269Legacy, contactAirborne) are unchanged.
   * N1 and TOT are NOT duplicated: read EngineState.ng and EngineState.itt.
   *
   * What the existing systems fields mean on a 'freewheel' type: clutchEngagement = 1, clutchLight = false,
   * clutchDisengaged absent, governorActive = (governorMode === 'governed'), lowRpmLight/lowRpmHorn =
   * engineOutLight/engineOutHorn, governorThrottle = the PTG output throttle, powerLimitExceeded from the psi,
   * TOT and N1 bands of TurboshaftControlDef.limits (not from power or MAP).
   */
  turboshaft?: {
    /** Beep set point, % of N2 100 % (persisted). */
    n2SetPct: number;
    /** Governor integrator, Ng-demand fraction (persisted). */
    ptgIntegral: number;
    /**
     * N2 of the last governor step (fraction of ratedRpm) and its filtered rate (1/s), the rate term's memory
     * (persisted, so a resume mid-transient matches the uninterrupted flight). Absent after a reset: seeded from the
     * shaft at the next step with no rate.
     */
    n2Last?: number;
    n2Rate?: number;
    grip: 'cutoff' | 'groundIdle' | 'between' | 'fullOpen';
    /** 'manual': grip below full open, or ControlInputs.rotorGovernor === false (governor failure). */
    governorMode: 'governed' | 'manual';
    /** Engine output shaft speed, % of ratedRpm (6016 rpm). */
    n2Pct: number;
    /** Rotor speed, % of referenceRpm (477.7 rpm). */
    nrPct: number;
    /** Torquemeter reading, psi. */
    torquePsi: number;
    /** Nr x engineRatio above N2 by more than 1 %: the rotor overrunning the freewheel (autorotation, shutdown). */
    needlesSplit: boolean;
    /** N1 < 55 % or Nr < 468 rpm; needs bus power (ENG OUT circuit breaker). */
    engineOutLight: boolean;
    /** Same condition, horn (no collective inhibit). */
    engineOutHorn: boolean;
    /** RE-IGN P RST: latched when auto-reignition fired; cleared by lampTestId 'reign'. */
    reignitionLight: boolean;
    overTorque: boolean; overTemp: boolean; avoidRange: boolean;
    /** The low-rotor half of the warning is armed (Nr has reached the threshold since it was last below 70 %). Absent = false. */
    lowRotorArmed?: boolean;
  };
  omega: number; azimuth: number; inflow: number; tailInflow: number;
  flapForward: number; flapRight: number; governorThrottle: number;
  thrust: number; tailThrust: number; torque: number; driveTorque: number;
  rotorRpm: number; lowRpm: boolean; vortexRing: number; stalledFraction: number;
  coning: number; retreatingFlap: number; teeterAngle: number; mastBump: boolean;
  /** Latched ground-contact report. A light stinger touch is reported without stopping the simulation. */
  tailContact: 'none' | 'stinger-touch' | 'stinger-impact' | 'fin-strike' | 'rotor-strike';
  /** Last pilot positions allow correlator/governor state to resume without a throttle step. */
  previousCollective: number; previousThrottle: number; governorIntegral: number;
  takeoffPowerSeconds: number; powerLimitExceeded: boolean;
  vneKias: number; airspeedLimitExceeded: boolean;
  /** Departure mass in kg, retained through fuel burn/resume; refreshed on the ground. Zero before reset. */
  takeoffMass: number;
  /** Systems outputs read by the panel, annunciators and audio (contract between physics and presentation).
   * clutchEngagement: belt/clutch engagement 0 (slack) .. 1 (fully tensioned).
   * clutchLight: CLUTCH caution, lit while the clutch actuator is moving.
   * governorActive: governor switched on AND active (engine above its engagement RPM).
   * lowRpmLight: powered LOW RPM indication, independent of collective position.
   * lowRpmHorn: audible warning below the type's threshold with collective not fully down. */
  clutchEngagement: number; clutchLight: boolean; governorActive: boolean; lowRpmHorn: boolean; lowRpmLight: boolean;
}
/**
 * Cyclic blade-pitch command of the stick, rad: `aft` (+ = disc aft, ControlInputs.elevator +) and `right`
 * (+ = disc right, aileron +). With `cyclicLimits` the stick's travel is linear from the forward to the aft stop
 * (elevator -1 .. +1) and from the left to the right stop, so its centre sits half the difference away from the
 * rigging neutral; without it, cyclicLimit each way.
 */
export function cyclicAngles(d: Pick<RotorcraftDefinition, 'cyclicLimit' | 'cyclicLimits' | 'controlFlex'>,
  c: { elevator: number; aileron: number }): { aft: number; right: number } {
  const l = d.cyclicLimits;
  if (!l) return { aft: c.elevator * d.cyclicLimit, right: c.aileron * d.cyclicLimit };
  const aft = c.elevator * (l.forward + l.aft) / 2 - (l.forward - l.aft) / 2;
  const right = c.aileron * (l.left + l.right) / 2 + (l.right - l.left) / 2;
  const flex = d.controlFlex;
  return flex ? { aft: aft * flex.longitudinal, right: right * flex.lateral } : { aft, right };
}
/** Snapshots own every nested state; legacy scalar serialization remains identical. */
export function cloneRotorcraftState(s: RotorcraftState): RotorcraftState {
  return { ...s, ...(s.transmission ? { transmission: { ...s.transmission } } : {}),
    ...(s.contactRotor ? { contactRotor: { ...s.contactRotor } } : {}),
    ...(s.springTrim ? { springTrim: { ...s.springTrim } } : {}),
    ...(s.turboshaft ? { turboshaft: { ...s.turboshaft } } : {}),
    ...(s.articulated ? { articulated: { blades: s.articulated.blades.map(b => ({ ...b })) } } : {}) };
}
export function emptyRotorcraftState(): RotorcraftState {
  return { omega: 0, azimuth: 0, inflow: 0, tailInflow: 0, flapForward: 0, flapRight: 0,
    governorThrottle: 0, thrust: 0, tailThrust: 0, torque: 0, driveTorque: 0,
    rotorRpm: 0, lowRpm: false, vortexRing: 0, stalledFraction: 0,
    coning: 0, retreatingFlap: 0, teeterAngle: 0, mastBump: false, tailContact: 'none',
    previousCollective: 0, previousThrottle: 0, governorIntegral: 0,
    takeoffPowerSeconds: 0, powerLimitExceeded: false,
    vneKias: 0, airspeedLimitExceeded: false, takeoffMass: 0,
    clutchEngagement: 0, clutchLight: false, governorActive: false, lowRpmHorn: false, lowRpmLight: false };
}
