// Stick shaker and stick pusher (PC-12 stall-warning and identification system). An AOA-vane trip schedule
// against flap deflection: the shaker runs above shakerAlphaDeg, the pusher drives the elevator nose-down by
// pushElevator above pusherAlphaDeg, with the inhibits a real system has (just after lift-off, at low load
// factor, with a dead bus, while the pilot holds the interrupt).
//
// SCAFFOLD: the definition and the call contract are fixed; the body is a no-op until the PC-12 package (P1)
// implements it. The flight model constructs one only for a type whose ControlSystemDef has `stickPusher`, so
// no existing type runs this code.

export interface StickPusherDef {
  /** Trip schedule against flap deflection, deg (ascending): shaker and pusher BODY angle of attack, deg. */
  flapDeg: readonly number[];
  shakerAlphaDeg: readonly number[];
  pusherAlphaDeg: readonly number[];
  /** Trip AOA shift per psi of torque, deg/psi (47E sect. 7-21: torque is an input; ESTIMATE). Absent: 0. */
  torqueBias?: number;
  /** psi per POWER-TURBINE N m (PC-12: PC12_GEAR_RATIO x PC12_PSI_PER_NM), to read the torque input. Needed with torqueBias. */
  psiPerPtNm?: number;
  /** Nose-down elevator command the pusher adds, as a fraction of full down travel, and its ramp time, s. */
  pushElevator: number;
  rampSeconds: number;
  /** Inhibits: seconds after lift-off; below this load factor, g; below this bus voltage, V. */
  liftoffInhibitSeconds: number;
  minLoadFactor: number;
  minBusVolts: number;
}

/** What one step of the system reads; all from the previous step's state (the vane lags by one step). */
export interface StickPusherInput {
  /** Body angle of attack, deg (AircraftState.alpha). */
  alphaDeg: number;
  /** Flap deflection, deg (SurfaceState.flaps). */
  flapDeg: number;
  /** Normal load factor, g (AircraftState.gLoad). */
  loadFactor: number;
  /** Bus voltage, V. */
  busVolts: number;
  /** Any wheel on the ground. */
  weightOnWheels: boolean;
  /** Power-turbine torque of engine 0, N m (EngineState.torque); x psiPerPtNm = the torque gauge psi. */
  ptTorqueNm: number;
  /** ControlInputs.pusherInterrupt. */
  interrupt: boolean;
  dt: number;
}

export class StickPusher {
  private shakerOn = false;
  private pusherOn = false;

  constructor(readonly def: StickPusherDef) {}

  reset(): void {
    this.shakerOn = false;
    this.pusherOn = false;
  }

  /**
   * One step: returns the elevator command ([-1, 1], + = yoke back) the control system receives in place of
   * the pilot's `yoke`. SCAFFOLD: returns `yoke` unchanged and never trips (P1 implements the schedule).
   */
  step(_i: StickPusherInput, yoke: number): number {
    return yoke;
  }

  /** Shaker running. */
  get shaker(): boolean {
    return this.shakerOn;
  }

  /** Pusher pushing. */
  get pusher(): boolean {
    return this.pusherOn;
  }
}
